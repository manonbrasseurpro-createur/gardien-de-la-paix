-- Profils utilisateurs (Supabase Auth + table profiles)
-- Exécuter dans l'éditeur SQL Supabase après création du projet.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  email text not null,
  phone text not null default '',
  subscription_status text not null default 'none'
    check (subscription_status in ('none', 'active', 'cancelled', 'past_due')),
  subscription_ends_at timestamptz,
  free_trial_used boolean not null default false,
  free_trial_key text,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users update own profile (limited)"
  on public.profiles for update
  using (auth.uid() = id);

-- Insertion automatique à l'inscription
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
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

alter table public.profiles add column if not exists is_complimentary boolean not null default false;

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

-- RLS pour problem_reports : lecture par manonbrasseurpro@gmail.com uniquement via service role
-- (la lecture admin se fait via anon key côté client, donc ajouter une policy SELECT permissive pour auth.uid() = owner)
-- Note : pour l'instant la lecture admin fonctionne si RLS est désactivée sur problem_reports
-- ou si une policy SELECT existe pour les utilisateurs authentifiés
-- Les policies ci-dessus restreignent la lecture SELECT à l'email admin (JWT), pas à tous les utilisateurs authentifiés.
