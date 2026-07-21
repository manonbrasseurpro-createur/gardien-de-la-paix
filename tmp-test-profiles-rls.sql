-- Security tests returning a result set (ROLLBACK at end).
BEGIN;

SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', 'd7368b3e-19c4-4c30-9cdd-67c247123466',
    'role', 'authenticated',
    'email', 'manon.libertywebi@gmail.com'
  )::text,
  true
);

SET LOCAL ROLE authenticated;

CREATE TEMP TABLE security_test_results (
  test_id text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_uid uuid := 'd7368b3e-19c4-4c30-9cdd-67c247123466';
  v_old_name text;
  v_new_name text;
  v_status_before text;
  v_status_after text;
  v_customer_before text;
  v_customer_after text;
  v_jwt jsonb := auth.jwt();
  v_uid_check uuid := auth.uid();
  v_err text;
BEGIN
  INSERT INTO security_test_results VALUES (
    '0_auth_context',
    (v_uid_check = v_uid AND (v_jwt ->> 'role') = 'authenticated'),
    format('auth.uid=%s jwt.role=%s jwt.email=%s', v_uid_check, v_jwt ->> 'role', v_jwt ->> 'email')
  );

  SELECT first_name, subscription_status, stripe_customer_id
  INTO v_old_name, v_status_before, v_customer_before
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND THEN
    INSERT INTO security_test_results VALUES ('setup', false, 'profile row missing');
    RETURN;
  END IF;

  -- 1) Non-sensitive update
  BEGIN
    UPDATE public.profiles
    SET first_name = coalesce(nullif(v_old_name, ''), 'Manon') || ' (test-rls)'
    WHERE id = v_uid
    RETURNING first_name INTO v_new_name;

    INSERT INTO security_test_results VALUES (
      '1_first_name_allowed',
      (v_new_name IS NOT NULL AND v_new_name IS DISTINCT FROM v_old_name),
      format('%s -> %s', v_old_name, v_new_name)
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO security_test_results VALUES ('1_first_name_allowed', false, SQLERRM);
  END;

  -- 2a) subscription_status change must be blocked
  BEGIN
    UPDATE public.profiles
    SET subscription_status = CASE
      WHEN coalesce(subscription_status, '') = 'active' THEN 'expired'
      ELSE 'active'
    END
    WHERE id = v_uid;

    INSERT INTO security_test_results VALUES (
      '2a_subscription_status_blocked',
      false,
      'UPDATE was allowed (should have been blocked)'
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO security_test_results VALUES (
      '2a_subscription_status_blocked',
      (SQLERRM LIKE '%Modification des champs abonnement interdite%'),
      SQLERRM
    );
  END;

  -- 2b) stripe_customer_id change must be blocked
  BEGIN
    UPDATE public.profiles
    SET stripe_customer_id = 'cus_test_privilege_escalation'
    WHERE id = v_uid;

    INSERT INTO security_test_results VALUES (
      '2b_stripe_customer_id_blocked',
      false,
      'UPDATE was allowed (should have been blocked)'
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO security_test_results VALUES (
      '2b_stripe_customer_id_blocked',
      (SQLERRM LIKE '%Modification des champs abonnement interdite%'),
      SQLERRM
    );
  END;

  SELECT subscription_status, stripe_customer_id
  INTO v_status_after, v_customer_after
  FROM public.profiles
  WHERE id = v_uid;

  INSERT INTO security_test_results VALUES (
    '2c_values_unchanged',
    (v_status_after IS NOT DISTINCT FROM v_status_before
      AND v_customer_after IS NOT DISTINCT FROM v_customer_before),
    format(
      'status %s -> %s ; customer %s -> %s',
      v_status_before, v_status_after, v_customer_before, v_customer_after
    )
  );
END $$;

SELECT test_id, ok, detail FROM security_test_results ORDER BY test_id;

ROLLBACK;
