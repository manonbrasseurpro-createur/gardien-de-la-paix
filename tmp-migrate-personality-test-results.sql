-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Résultats complets du test de personnalité (60 affirmations, 6 dimensions).
-- Append-only : insert + select pour le propriétaire, pas d'update ni de delete.

create table if not exists public.personality_test_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  duree_secondes integer not null default 0 check (duree_secondes >= 0),
  dimension_scores jsonb not null default '{}'::jsonb,
  score_moyen numeric not null check (score_moyen >= 0),
  coherence_score numeric check (coherence_score is null or coherence_score >= 0),
  analyse_text text
);

create index if not exists personality_test_results_user_created_at_idx
  on public.personality_test_results (user_id, created_at desc);

alter table public.personality_test_results enable row level security;

drop policy if exists "Users insert own personality_test_results" on public.personality_test_results;
create policy "Users insert own personality_test_results"
  on public.personality_test_results for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users read own personality_test_results" on public.personality_test_results;
create policy "Users read own personality_test_results"
  on public.personality_test_results for select
  to authenticated
  using (auth.uid() = user_id);

grant select, insert on table public.personality_test_results to authenticated;
