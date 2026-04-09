-- Add per-room avatar preference columns to office_members.
--
-- Each member can now store a room-specific avatar that overrides their
-- global profile avatar.  NULL in any column means "fall back to the
-- global profile value".

ALTER TABLE public.office_members
  ADD COLUMN IF NOT EXISTS avatar_body_color  TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avatar_skin_color  TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avatar_style       TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avatar_accessories TEXT[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avatar_preset_id   TEXT    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avatar_model_url   TEXT    DEFAULT NULL;

-- Allow members to update their own row (needed to save per-room avatar).
-- Owners/admins can already update via the existing policy; this covers
-- regular members updating only their own membership record.
CREATE POLICY "Members update own membership"
  ON public.office_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
