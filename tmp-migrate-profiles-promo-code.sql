-- À exécuter dans l'éditeur SQL Supabase.
-- Ajoute promo_code et l'inclut dans le trigger des colonnes protégées.

alter table public.profiles add column if not exists promo_code text;

create or replace function public.protect_profiles_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     or (auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com' then
    return new;
  end if;

  if new.subscription_status is distinct from old.subscription_status
     or new.subscription_plan is distinct from old.subscription_plan
     or new.subscription_end is distinct from old.subscription_end
     or new.subscription_ends_at is distinct from old.subscription_ends_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.promo_code is distinct from old.promo_code
     or new.is_complimentary is distinct from old.is_complimentary
     or new.sport_access is distinct from old.sport_access
     or new.last_ai_correction_at is distinct from old.last_ai_correction_at then
    raise exception 'Modification des champs abonnement interdite'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
