-- À exécuter dans l'éditeur SQL Supabase.
-- Drapeau "bannière bug score cas pratique déjà vue" (l'utilisateur peut le passer à true).

alter table public.profiles
  add column if not exists seen_score_bug_notice boolean not null default false;
