SELECT COUNT(*)::int AS total_users FROM auth.users;
SELECT COUNT(*)::int AS total_profiles FROM public.profiles;
SELECT COUNT(*)::int AS users_without_profile
FROM auth.users u
LEFT JOIN public.profiles pr ON pr.id = u.id
WHERE pr.id IS NULL;

SELECT date_trunc('day', u.created_at) AS day,
       COUNT(*)::int AS signups,
       COUNT(pr.id)::int AS with_profile,
       (COUNT(*) - COUNT(pr.id))::int AS without_profile
FROM auth.users u
LEFT JOIN public.profiles pr ON pr.id = u.id
GROUP BY 1
ORDER BY 1;

SELECT MIN(created_at) AS first_profile, MAX(created_at) AS last_profile
FROM public.profiles;
