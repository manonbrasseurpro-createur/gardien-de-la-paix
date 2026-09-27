-- Progression rattachée au compte : détail par thème, date réelle,
-- identifiant client anti-doublon, et texte de correction IA.
-- À exécuter dans l'éditeur SQL Supabase.
-- content_events n'est pas modifié.

alter table public.exam_sessions
  add column if not exists categories jsonb;

alter table public.exam_sessions
  add column if not exists recorded_at timestamptz;

alter table public.exam_sessions
  add column if not exists client_id uuid;

alter table public.exam_sessions
  add column if not exists ai_correction jsonb;

create unique index if not exists exam_sessions_user_client_id_uidx
  on public.exam_sessions (user_id, client_id)
  where client_id is not null;

-- Select / insert inchangés dans leur règle. Les noms en base sont
-- "Insert own sessions" et "Lecture own sessions" ; on les remplace par
-- les noms du schéma ("Users … own exam_sessions"), alignés sur content_events.
-- Le second DROP rend le script rejouable.
-- Update et delete : ses lignes seulement. Pas de policy admin.
drop policy if exists "Insert own sessions" on public.exam_sessions;
drop policy if exists "Users insert own exam_sessions" on public.exam_sessions;
create policy "Users insert own exam_sessions"
  on public.exam_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Lecture own sessions" on public.exam_sessions;
drop policy if exists "Users read own exam_sessions" on public.exam_sessions;
create policy "Users read own exam_sessions"
  on public.exam_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users update own exam_sessions" on public.exam_sessions;
create policy "Users update own exam_sessions"
  on public.exam_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own exam_sessions" on public.exam_sessions;
create policy "Users delete own exam_sessions"
  on public.exam_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

-- Même modèle que protect_profiles_privileged_columns : la RLS autorise
-- l'update de sa ligne, le trigger refuse le changement effectif des
-- colonnes de score et d'identité, y compris si le SET ne les cite pas
-- mais que NEW diffère de OLD.
create or replace function public.protect_exam_sessions_privileged_columns()
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

  if new.user_id is distinct from old.user_id
     or new.client_id is distinct from old.client_id
     or new.module is distinct from old.module
     or new.score is distinct from old.score
     or new.score_max is distinct from old.score_max then
    raise exception 'Modification des champs de session interdite'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_exam_sessions_privileged_columns on public.exam_sessions;
create trigger protect_exam_sessions_privileged_columns
  before update on public.exam_sessions
  for each row execute procedure public.protect_exam_sessions_privileged_columns();

revoke all on table public.exam_sessions from public, anon;
grant select, insert, update, delete on table public.exam_sessions to authenticated;
