INSERT INTO public.profiles (
  id,
  email,
  first_name,
  last_name,
  subscription_status,
  free_trial_start
)
VALUES (
  'd7368b3e-19c4-4c30-9cdd-67c247123466',
  'manon.libertywebi@gmail.com',
  'Manon',
  'Libertywebi',
  'trial',
  now()
)
ON CONFLICT (id) DO UPDATE
SET subscription_status = EXCLUDED.subscription_status,
    free_trial_start = COALESCE(public.profiles.free_trial_start, EXCLUDED.free_trial_start),
    email = COALESCE(public.profiles.email, EXCLUDED.email),
    first_name = COALESCE(NULLIF(public.profiles.first_name, ''), EXCLUDED.first_name),
    last_name = COALESCE(NULLIF(public.profiles.last_name, ''), EXCLUDED.last_name);

SELECT id, email, first_name, last_name, subscription_status, free_trial_start, created_at
FROM public.profiles
WHERE id = 'd7368b3e-19c4-4c30-9cdd-67c247123466';
