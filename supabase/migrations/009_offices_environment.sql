-- Persist room environment so all users (including new joiners) see the same scene.
--
-- Adds an `environment` column to offices. Only owners and admins may update it,
-- enforced by the existing "Owners and admins can update offices" RLS policy.
-- Environment values are arbitrary strings; unknown values fall back to the
-- default scene in client code.

ALTER TABLE public.offices
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'corporate';
