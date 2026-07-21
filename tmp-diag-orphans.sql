SELECT n.nspname AS schema,
       p.proname AS name,
       p.oid::regprocedure AS signature,
       obj_description(p.oid, 'pg_proc') AS comment
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'handle_new_user';

SELECT COUNT(*) AS users_without_profile
FROM auth.users u
LEFT JOIN public.profiles pr ON pr.id = u.id
WHERE pr.id IS NULL;

SELECT u.id, u.email, u.created_at
FROM auth.users u
LEFT JOIN public.profiles pr ON pr.id = u.id
WHERE pr.id IS NULL
ORDER BY u.created_at DESC
LIMIT 20;
