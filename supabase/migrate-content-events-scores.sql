-- Scores par tentative sur content_events + historique multi-tentatives.
-- À exécuter dans l'éditeur SQL Supabase.
-- On retire l'unicité (user, module, type, content_id) pour pouvoir
-- conserver dernier score ET meilleur score. Le badge "fait" déduplique côté client.

alter table public.content_events
  add column if not exists score numeric;

alter table public.content_events
  add column if not exists score_max numeric;

drop index if exists public.content_events_user_module_type_id_uidx;
