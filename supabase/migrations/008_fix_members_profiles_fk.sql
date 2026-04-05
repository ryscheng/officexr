-- Fix "No members found" in SettingsPanel.
--
-- The members query uses PostgREST's embedded-resource syntax:
--   .select('id, user_id, role, profiles(name, email)')
--
-- PostgREST resolves embedded resources via FK constraints in the public
-- schema. Currently office_members.user_id references auth.users(id), but
-- there is no FK to public.profiles(id). Without a direct FK PostgREST
-- cannot find the relationship and returns a 400 error, so data is null and
-- the panel shows "No members found" even when members exist.
--
-- Fix: add a FK from office_members.user_id → profiles.id. Both columns
-- hold the same auth-user UUID and profiles are auto-created on signup via
-- the handle_new_user trigger, so this constraint is safe on any live DB.
--
-- The RLS policy "Office members are viewable by office members" (using
-- is_member_of_office) is already correct and is left unchanged.

ALTER TABLE public.office_members
  ADD CONSTRAINT office_members_user_id_fkey_profiles
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
