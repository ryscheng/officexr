-- Allow owners and admins to update member roles.
--
-- Owners can change any non-owner member's role.
-- Admins can change any member's role (but not owners, since this policy
-- only matches rows where the target role is not 'owner').
-- The client UI already prevents attempts to change owner rows.

CREATE POLICY "Owners and admins can update member roles"
  ON public.office_members FOR UPDATE
  TO authenticated
  USING (
    public.is_office_admin_or_owner(office_id)
    AND role <> 'owner'          -- cannot change owner rows
  )
  WITH CHECK (
    public.is_office_admin_or_owner(office_id)
    AND role <> 'owner'          -- cannot promote anyone to owner
  );
