-- À exécuter dans l'éditeur SQL Supabase.
-- Expose seulement la moyenne et le nombre d'avis (tous les questionnaires notés).

create or replace function public.get_satisfaction_rating_stats()
returns table(average_note numeric, review_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    round(avg(note)::numeric, 1) as average_note,
    count(*)::integer as review_count
  from public.satisfaction_surveys
  where note is not null;
$$;

revoke all on function public.get_satisfaction_rating_stats() from public;
grant execute on function public.get_satisfaction_rating_stats() to anon, authenticated;
