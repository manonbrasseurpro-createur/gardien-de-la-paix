-- Harden profiles: users can update own row, but cannot change privileged columns.
-- Privileged columns are writable only by service_role (Stripe webhook) or admin email.

DROP POLICY IF EXISTS "Authenticated users can update is_complimentary" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile (limited)" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile (non-sensitive)" ON public.profiles;

CREATE POLICY "Users update own profile (non-sensitive)"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.protect_profiles_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- service_role (Edge Functions / webhook) and site admin may change privileged fields
  IF coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     OR (auth.jwt() ->> 'email') = 'manonbrasseurpro@gmail.com' THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
     OR NEW.subscription_end IS DISTINCT FROM OLD.subscription_end
     OR NEW.subscription_ends_at IS DISTINCT FROM OLD.subscription_ends_at
     OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
     OR NEW.is_complimentary IS DISTINCT FROM OLD.is_complimentary
     OR NEW.sport_access IS DISTINCT FROM OLD.sport_access
  THEN
    RAISE EXCEPTION 'Modification des champs abonnement interdite'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profiles_privileged_columns ON public.profiles;
CREATE TRIGGER protect_profiles_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.protect_profiles_privileged_columns();
