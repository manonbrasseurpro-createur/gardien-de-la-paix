-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Table admin des partenaires (codes promo Stripe ↔ profiles.promo_code).
-- Lecture / écriture réservées à manonbrasseurpro@gmail.com.

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  contact_email text,
  promo_code text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'ended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists partners_promo_code_unique
  on public.partners (upper(promo_code))
  where promo_code is not null and btrim(promo_code) <> '';

create index if not exists partners_status_created_at_idx
  on public.partners (status, created_at desc);

create or replace function public.set_partners_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists partners_set_updated_at on public.partners;
create trigger partners_set_updated_at
  before update on public.partners
  for each row execute procedure public.set_partners_updated_at();

alter table public.partners enable row level security;

drop policy if exists "Admin read partners" on public.partners;
create policy "Admin read partners"
  on public.partners for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin insert partners" on public.partners;
create policy "Admin insert partners"
  on public.partners for insert
  with check ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin update partners" on public.partners;
create policy "Admin update partners"
  on public.partners for update
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin delete partners" on public.partners;
create policy "Admin delete partners"
  on public.partners for delete
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

revoke all on table public.partners from public, anon;
grant select, insert, update, delete on table public.partners to authenticated;
