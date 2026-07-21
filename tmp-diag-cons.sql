SELECT r.conname,
       pg_get_constraintdef(r.oid) AS def
FROM pg_constraint r
WHERE r.conrelid = 'public.profiles'::regclass;
