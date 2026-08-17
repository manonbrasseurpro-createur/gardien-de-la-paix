-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Ajoute resolved + politique UPDATE réservée à l'admin (JWT email).

alter table public.problem_reports
  add column if not exists resolved boolean not null default false;

drop policy if exists "Admin update problem_reports" on public.problem_reports;
create policy "Admin update problem_reports"
  on public.problem_reports for update
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');
