-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Historique des campagnes email admin + RLS réservée à manonbrasseurpro@gmail.com.

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid references auth.users (id) on delete set null,
  subject text not null,
  recipient_count integer not null default 0,
  sent_at timestamptz not null default now(),
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'failed')),
  brevo_campaign_id bigint
);

create index if not exists email_campaigns_sent_at_idx
  on public.email_campaigns (sent_at desc);

alter table public.email_campaigns enable row level security;

drop policy if exists "Admin read email_campaigns" on public.email_campaigns;
create policy "Admin read email_campaigns"
  on public.email_campaigns for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

grant select on table public.email_campaigns to authenticated;

-- Pas de policy INSERT/UPDATE/DELETE côté client :
-- l'Edge Function send-campaign écrit via service_role (bypass RLS).
