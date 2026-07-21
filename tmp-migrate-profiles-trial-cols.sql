ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS free_trial_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_trial_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
