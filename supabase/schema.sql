-- Profils utilisateurs (Supabase Auth + table profiles)
-- Exécuter dans l'éditeur SQL Supabase après création du projet.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text not null,
  phone text not null default '',
  subscription_status text not null default 'trial'
    check (subscription_status in ('none', 'trial', 'active', 'expired', 'cancelled', 'past_due', 'free')),
  subscription_ends_at timestamptz,
  subscription_end timestamptz,
  subscription_plan text
    check (subscription_plan is null or subscription_plan in ('monthly', 'quarterly', 'biannual', 'annual')),
  free_trial_start timestamptz,
  free_trial_used boolean not null default false,
  free_trial_key text,
  stripe_customer_id text,
  stripe_subscription_id text,
  last_ai_correction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Mise à jour profil : identité / contact seulement. Les champs abonnement
-- sont protégés par le trigger protect_profiles_privileged_columns
-- (service_role + admin uniquement).
drop policy if exists "Users update own profile (limited)" on public.profiles;
drop policy if exists "Authenticated users can update is_complimentary" on public.profiles;
drop policy if exists "Users update own profile (non-sensitive)" on public.profiles;

create policy "Users update own profile (non-sensitive)"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.protect_profiles_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or (auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com' then
    return new;
  end if;

  if new.subscription_status is distinct from old.subscription_status
     or new.subscription_plan is distinct from old.subscription_plan
     or new.subscription_end is distinct from old.subscription_end
     or new.subscription_ends_at is distinct from old.subscription_ends_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.is_complimentary is distinct from old.is_complimentary
     or new.sport_access is distinct from old.sport_access
     or new.last_ai_correction_at is distinct from old.last_ai_correction_at then
    raise exception 'Modification des champs abonnement interdite'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profiles_privileged_columns on public.profiles;
create trigger protect_profiles_privileged_columns
  before update on public.profiles
  for each row execute procedure public.protect_profiles_privileged_columns();

-- Rate limit correction IA (appelé par Edge Function via service_role)
create or replace function public.claim_ai_correction_slot(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.profiles
  set last_ai_correction_at = now()
  where id = p_user_id
    and (
      last_ai_correction_at is null
      or last_ai_correction_at < now() - interval '60 seconds'
    );
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.claim_ai_correction_slot(uuid) from public;
grant execute on function public.claim_ai_correction_slot(uuid) to service_role;

-- Insertion automatique à l'inscription
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, first_name, last_name, phone,
    free_trial_start, subscription_status
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    now(),
    'trial'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Mise à jour abonnement (webhook Stripe via service role, hors navigateur)
-- Exemple : update profiles set subscription_status = 'active', subscription_ends_at = now() + interval '1 month' where id = '...';

-- Migration si la table existe déjà :
-- alter table public.profiles add column if not exists phone text not null default '';
-- alter table public.profiles add column if not exists stripe_customer_id text;
-- alter table public.profiles add column if not exists stripe_subscription_id text;
-- alter table public.profiles add column if not exists is_complimentary boolean not null default false;
-- alter table public.profiles add column if not exists free_trial_start timestamptz;
-- alter table public.profiles add column if not exists subscription_plan text;
-- alter table public.profiles add column if not exists subscription_end timestamptz;
-- update public.profiles set subscription_status = 'trial', free_trial_start = coalesce(free_trial_start, created_at)
--   where subscription_status in ('none', 'free') and free_trial_start is null;

alter table public.profiles add column if not exists is_complimentary boolean not null default false;

alter table public.profiles add column if not exists free_trial_start timestamptz;
alter table public.profiles add column if not exists subscription_plan text;
alter table public.profiles add column if not exists subscription_end timestamptz;

alter table public.profiles drop constraint if exists profiles_subscription_status_check;
alter table public.profiles add constraint profiles_subscription_status_check
  check (subscription_status in ('none', 'trial', 'active', 'expired', 'cancelled', 'past_due', 'free'));

alter table public.profiles drop constraint if exists profiles_subscription_plan_check;
alter table public.profiles add constraint profiles_subscription_plan_check
  check (subscription_plan is null or subscription_plan in ('monthly', 'quarterly', 'biannual', 'annual'));

update public.profiles
set
  subscription_status = 'trial',
  free_trial_start = coalesce(free_trial_start, created_at, now())
where subscription_status in ('none', 'free')
  and free_trial_start is null;

-- Signalements utilisateurs
create table if not exists public.problem_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  email text,
  page_url text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.problem_reports enable row level security;

create policy "Authenticated users insert problem_reports"
  on public.problem_reports for insert
  with check (auth.uid() is not null);

create policy "Users read own problem_reports"
  on public.problem_reports for select
  using (auth.uid() = user_id);

create policy "Admin read all problem_reports"
  on public.problem_reports for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

-- Questionnaire de satisfaction
create table if not exists public.satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  note integer,
  modules_utilises text,
  contenu_realiste text,
  aide_principale text,
  amelioration text,
  recommande text,
  commentaire text,
  created_at timestamptz not null default now()
);

alter table public.satisfaction_surveys enable row level security;

create policy "Authenticated users insert satisfaction_surveys"
  on public.satisfaction_surveys for insert
  with check (auth.uid() = user_id);

create policy "Admin read all satisfaction_surveys"
  on public.satisfaction_surveys for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

-- Admin : lecture de tous les profils et activation accès gratuit
create policy "Admin read all profiles"
  on public.profiles for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

create policy "Admin update profiles complimentary"
  on public.profiles for update
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

-- RLS problem_reports SELECT : auteur (auth.uid() = user_id) OU admin JWT email.
-- service_role bypass RLS. satisfaction_surveys reste lisible publiquement (choix produit).

-- Progression flashcards (abonnés)
create table if not exists public.flashcard_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_category text not null check (card_category in ('juridique', 'articles', 'sigles')),
  card_question text not null,
  status text not null check (status in ('a_revoir', 'su')),
  updated_at timestamptz not null default now(),
  unique (user_id, card_category, card_question)
);

create index if not exists flashcard_progress_user_id_idx
  on public.flashcard_progress (user_id);

alter table public.flashcard_progress enable row level security;

create policy "Users read own flashcard_progress"
  on public.flashcard_progress for select
  using (auth.uid() = user_id);

create policy "Users insert own flashcard_progress"
  on public.flashcard_progress for insert
  with check (auth.uid() = user_id);

create policy "Users update own flashcard_progress"
  on public.flashcard_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own flashcard_progress"
  on public.flashcard_progress for delete
  using (auth.uid() = user_id);

-- Fil de discussion (Communauté)
create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prenom text not null,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists community_posts_created_at_idx
  on public.community_posts (created_at desc);

alter table public.community_posts enable row level security;

create policy "Authenticated read community_posts"
  on public.community_posts for select
  to authenticated
  using (true);

create policy "Authenticated insert own community_posts"
  on public.community_posts for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Authors delete own community_posts"
  on public.community_posts for delete
  to authenticated
  using (auth.uid() = user_id);

-- Sessions d'examen (progression + classement)
create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  module text not null,
  score numeric not null check (score >= 0),
  score_max numeric not null check (score_max > 0),
  duree_secondes integer not null default 0 check (duree_secondes >= 0),
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exam_sessions' and column_name = 'total'
  ) then
    alter table public.exam_sessions rename column total to score_max;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'exam_sessions' and column_name = 'duree'
  ) then
    alter table public.exam_sessions rename column duree to duree_secondes;
  end if;
end $$;

create index if not exists exam_sessions_user_module_idx
  on public.exam_sessions (user_id, module);

create index if not exists exam_sessions_module_created_at_idx
  on public.exam_sessions (module, created_at desc);

alter table public.exam_sessions enable row level security;

create policy "Users insert own exam_sessions"
  on public.exam_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users read own exam_sessions"
  on public.exam_sessions for select
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.get_cas_pratique_leaderboard()
returns table (
  user_id uuid,
  prenom text,
  avg_score numeric,
  test_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    es.user_id,
    p.first_name as prenom,
    round(avg((es.score / es.score_max) * 100)::numeric, 1) as avg_score,
    count(*)::bigint as test_count
  from public.exam_sessions es
  join public.profiles p on p.id = es.user_id
  where es.module = 'cas-pratique'
  group by es.user_id, p.first_name
  having count(*) >= 1
  order by avg_score desc, test_count desc, p.first_name asc
  limit 10;
$$;

grant execute on function public.get_cas_pratique_leaderboard() to authenticated;

-- Questions contact intervenants (page citations)
create table if not exists public.intervenant_questions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references public.professional_quotes (id) on delete set null,
  student_name text not null,
  student_email text not null,
  message text not null,
  status text not null default 'nouveau',
  created_at timestamptz not null default now()
);

alter table public.intervenant_questions enable row level security;

create policy "Anyone can submit a question"
  on public.intervenant_questions for insert
  with check (true);
