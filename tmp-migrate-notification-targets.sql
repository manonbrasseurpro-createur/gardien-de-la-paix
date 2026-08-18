-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Ciblage manuel d'utilisateurs pour les notifications site.

alter table public.site_notifications
  drop constraint if exists site_notifications_target_audience_check;
alter table public.site_notifications
  add constraint site_notifications_target_audience_check
  check (target_audience in ('all', 'free', 'subscriber', 'complimentary', 'users'));

create table if not exists public.notification_targets (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.site_notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  unique (notification_id, user_id)
);

create index if not exists notification_targets_notification_idx
  on public.notification_targets (notification_id);
create index if not exists notification_targets_user_idx
  on public.notification_targets (user_id);

alter table public.notification_targets enable row level security;

drop policy if exists "Users read own notification_targets" on public.notification_targets;
create policy "Users read own notification_targets"
  on public.notification_targets for select
  using (auth.uid() = user_id);

drop policy if exists "Admin read all notification_targets" on public.notification_targets;
create policy "Admin read all notification_targets"
  on public.notification_targets for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin insert notification_targets" on public.notification_targets;
create policy "Admin insert notification_targets"
  on public.notification_targets for insert
  with check ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin update notification_targets" on public.notification_targets;
create policy "Admin update notification_targets"
  on public.notification_targets for update
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin delete notification_targets" on public.notification_targets;
create policy "Admin delete notification_targets"
  on public.notification_targets for delete
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

grant select, insert, update, delete on table public.notification_targets to authenticated;
