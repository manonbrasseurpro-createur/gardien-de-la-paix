SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'professional_quotes'
ORDER BY cmd, policyname;
