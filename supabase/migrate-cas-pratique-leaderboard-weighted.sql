-- Pondération par points + minimum 5 tests pour le classement cas pratiques.
-- À exécuter dans l'éditeur SQL Supabase (ou via `supabase db query --linked`).

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
    round((sum(es.score) / nullif(sum(es.score_max), 0) * 100)::numeric, 1) as avg_score,
    count(*)::bigint as test_count
  from public.exam_sessions es
  join public.profiles p on p.id = es.user_id
  where es.module = 'cas-pratique'
  group by es.user_id, p.first_name
  having count(*) >= 5
  order by avg_score desc, test_count desc, p.first_name asc
  limit 10;
$$;

grant execute on function public.get_cas_pratique_leaderboard() to authenticated;
