-- Déduplication + unicité : un élève / un module / un type / un item.
-- À exécuter dans l'éditeur SQL Supabase après migrate-content-events.sql.
-- Les relances d'une même question n'ajoutent plus de lignes (upsert côté client = ignore).

delete from public.content_events
where id not in (
  select kept.id
  from (
    select distinct on (user_id, module, content_type, content_id) id
    from public.content_events
    order by user_id, module, content_type, content_id, completed_at desc
  ) kept
);

create unique index if not exists content_events_user_module_type_id_uidx
  on public.content_events (user_id, module, content_type, content_id);
