-- Fix 500 errors caused by self-referencing RLS on office_members.
--
-- The old policy "Office members are viewable by office members" contained a
-- subquery on office_members itself.  When the offices SELECT policy also
-- queries office_members, PostgreSQL can hit an infinite-recursion / stack-
-- overflow during RLS evaluation, producing a 500 from PostgREST.
--
-- The fix: wrap the membership check in a SECURITY DEFINER function so that
-- the inner query runs without re-applying RLS on office_members.

-- 1. Helper function — bypasses RLS when called from within a policy.
CREATE OR REPLACE FUNCTION public.is_member_of_office(p_office_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_members
    WHERE office_id = p_office_id
      AND user_id = auth.uid()
  );
$$;

-- 2. Replace the self-referencing office_members SELECT policy.
DROP POLICY IF EXISTS "Office members are viewable by office members" ON public.office_members;

CREATE POLICY "Office members are viewable by office members"
  ON public.office_members FOR SELECT
  TO authenticated
  USING (public.is_member_of_office(office_id));

-- 3. Replace the offices SELECT policy that also triggered the recursion chain.
DROP POLICY IF EXISTS "Offices are viewable by members" ON public.offices;

CREATE POLICY "Offices are viewable by members"
  ON public.offices FOR SELECT
  TO authenticated
  USING (public.is_member_of_office(id));

-- 4. Also update the offices UPDATE and DELETE policies that reference
--    office_members directly (not strictly needed for the 500 fix, but
--    consistent and avoids potential future issues).
DROP POLICY IF EXISTS "Owners and admins can update offices" ON public.offices;

CREATE OR REPLACE FUNCTION public.is_office_admin_or_owner(p_office_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_members
    WHERE office_id = p_office_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

CREATE POLICY "Owners and admins can update offices"
  ON public.offices FOR UPDATE
  TO authenticated
  USING (public.is_office_admin_or_owner(id));

DROP POLICY IF EXISTS "Only owners can delete offices" ON public.offices;

CREATE OR REPLACE FUNCTION public.is_office_owner(p_office_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM office_members
    WHERE office_id = p_office_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$$;

CREATE POLICY "Only owners can delete offices"
  ON public.offices FOR DELETE
  TO authenticated
  USING (public.is_office_owner(id));
