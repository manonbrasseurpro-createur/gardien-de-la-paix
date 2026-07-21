SELECT u.id,
       u.email,
       u.created_at,
       u.raw_user_meta_data,
       u.raw_app_meta_data
FROM auth.users u
WHERE u.id = 'd7368b3e-19c4-4c30-9cdd-67c247123466';
