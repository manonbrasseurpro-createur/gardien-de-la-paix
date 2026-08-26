-- Tracking de consommation de contenu par élève (anti déjà-vu).
-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Append-only : insert + select pour le propriétaire, pas d'update ni de delete.
-- exam_sessions n'est pas modifié.

create table if not exists public.content_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  module text not null,
  content_type text not null,
  content_id text not null,
  mode text,
  score numeric,
  score_max numeric,
  completed_at timestamptz not null default now()
);

-- Requêtes fréquentes : "qu'est-ce que cet élève a déjà fait" dans un module
create index if not exists content_events_user_module_content_idx
  on public.content_events (user_id, module, content_id);

create index if not exists content_events_user_module_type_idx
  on public.content_events (user_id, module, content_type);

-- Suivi admin de la consommation dans le temps
create index if not exists content_events_completed_at_idx
  on public.content_events (completed_at desc);

alter table public.content_events enable row level security;

drop policy if exists "Users insert own content_events" on public.content_events;
create policy "Users insert own content_events"
  on public.content_events for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users read own content_events" on public.content_events;
create policy "Users read own content_events"
  on public.content_events for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Admin read all content_events" on public.content_events;
create policy "Admin read all content_events"
  on public.content_events for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

revoke all on table public.content_events from public, anon;
grant select, insert on table public.content_events to authenticated;
