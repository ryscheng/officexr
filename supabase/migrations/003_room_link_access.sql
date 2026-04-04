-- Add link_access column: when true, any authenticated user with the room link can join.
-- When false (default), only explicitly invited / already-added members can enter.
ALTER TABLE public.offices
  ADD COLUMN IF NOT EXISTS link_access boolean NOT NULL DEFAULT false;

-- Allow authenticated users to read offices that have link access enabled.
-- (The existing "Offices are viewable by members" policy already covers members;
--  Postgres OR's multiple SELECT policies together.)
CREATE POLICY IF NOT EXISTS "Authenticated users can view link-accessible offices"
  ON public.offices FOR SELECT
  TO authenticated
  USING (link_access = true);
