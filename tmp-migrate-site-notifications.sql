-- À exécuter dans l'éditeur SQL Supabase (rôle postgres).
-- Notifications site affichées en bannière + mémorisation des fermetures.

create table if not exists public.site_notifications (
  id uuid primary key default gen_random_uuid(),
  title text,
  message text not null,
  type text not null default 'info'
    check (type in ('info', 'warning', 'success', 'promo')),
  target_audience text not null default 'all'
    check (target_audience in ('all', 'free', 'subscriber', 'complimentary')),
  active boolean not null default true,
  start_date timestamptz,
  end_date timestamptz,
  dismissible boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_dismissals (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.site_notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  unique (notification_id, user_id)
);

create index if not exists site_notifications_active_idx
  on public.site_notifications (active, start_date, end_date);
create index if not exists notification_dismissals_user_idx
  on public.notification_dismissals (user_id, notification_id);

alter table public.site_notifications enable row level security;
alter table public.notification_dismissals enable row level security;

drop policy if exists "Authenticated read active site_notifications" on public.site_notifications;
create policy "Authenticated read active site_notifications"
  on public.site_notifications for select
  to authenticated
  using (
    active = true
    and (start_date is null or start_date <= now())
    and (end_date is null or end_date >= now())
  );

drop policy if exists "Admin read all site_notifications" on public.site_notifications;
create policy "Admin read all site_notifications"
  on public.site_notifications for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin insert site_notifications" on public.site_notifications;
create policy "Admin insert site_notifications"
  on public.site_notifications for insert
  with check ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin update site_notifications" on public.site_notifications;
create policy "Admin update site_notifications"
  on public.site_notifications for update
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Admin delete site_notifications" on public.site_notifications;
create policy "Admin delete site_notifications"
  on public.site_notifications for delete
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Users read own notification_dismissals" on public.notification_dismissals;
create policy "Users read own notification_dismissals"
  on public.notification_dismissals for select
  using (auth.uid() = user_id);

drop policy if exists "Admin read all notification_dismissals" on public.notification_dismissals;
create policy "Admin read all notification_dismissals"
  on public.notification_dismissals for select
  using ((auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com');

drop policy if exists "Users insert own notification_dismissals" on public.notification_dismissals;
create policy "Users insert own notification_dismissals"
  on public.notification_dismissals for insert
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.site_notifications to authenticated;
grant select, insert on table public.notification_dismissals to authenticated;
