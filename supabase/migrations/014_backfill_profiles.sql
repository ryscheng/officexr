-- Backfill profiles for users whose profile row is missing or has a null
-- email.  This covers users who signed up before the trigger existed, users
-- whose trigger run failed, and users who authenticated via a provider that
-- later exposed their email.

-- 1. Insert missing profile rows (users with no profile at all).
INSERT INTO public.profiles (id, name, email, avatar_url)
SELECT
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  u.email,
  u.raw_user_meta_data->>'avatar_url'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = u.id
)
ON CONFLICT (id) DO NOTHING;

-- 2. Fill in null emails on existing profile rows where auth.users has one.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS NULL
  AND u.email IS NOT NULL;

-- 3. Fill in null names on existing profile rows where auth.users metadata has one.
UPDATE public.profiles p
SET name = coalesce(
  u.raw_user_meta_data->>'full_name',
  u.raw_user_meta_data->>'name'
)
FROM auth.users u
WHERE p.id = u.id
  AND p.name IS NULL
  AND coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name'
  ) IS NOT NULL;
