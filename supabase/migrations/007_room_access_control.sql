-- Consolidate room access control.
--
-- Problems fixed:
--   1. Non-members could not read `link_access` on private rooms, so the
--      client-side check returned 'not-found' instead of 'denied'.
--   2. The INSERT policy allowed any authenticated user to self-add to any
--      room regardless of link_access (TOCTOU / bypass risk).
--   3. No DELETE policy existed, so owner-initiated member removal was
--      blocked by RLS.
--
-- Solution: a single SECURITY DEFINER RPC that atomically checks access
-- and auto-joins when link_access is on, plus tightened INSERT/DELETE
-- policies on office_members.

-- ── 1. Atomic access-check + auto-join ────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_office_if_allowed(p_office_id uuid)
RETURNS text   -- 'ready' | 'denied' | 'not-found'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link_access boolean;
BEGIN
  -- Fast path: already a member.
  IF EXISTS (
    SELECT 1 FROM office_members
    WHERE office_id = p_office_id AND user_id = auth.uid()
  ) THEN
    RETURN 'ready';
  END IF;

  -- Read the office bypassing RLS (SECURITY DEFINER).
  SELECT link_access INTO v_link_access FROM offices WHERE id = p_office_id;

  IF NOT FOUND THEN
    RETURN 'not-found';
  END IF;

  IF v_link_access THEN
    -- Auto-join: ON CONFLICT is a safety net against races.
    INSERT INTO office_members (office_id, user_id, role)
    VALUES (p_office_id, auth.uid(), 'member')
    ON CONFLICT (office_id, user_id) DO NOTHING;
    RETURN 'ready';
  ELSE
    RETURN 'denied';
  END IF;
END;
$$;

-- ── 2. Tighten INSERT so clients cannot self-add to private rooms ──────
--
-- Allowed cases:
--   a) role = 'owner' and the office has no members yet (new office creation).
--   b) role = 'member'/'admin' and the office has link_access = true.
--
-- Auto-joins for private rooms must go through join_office_if_allowed()
-- which runs as SECURITY DEFINER and bypasses this policy.

CREATE OR REPLACE FUNCTION public.can_self_join_office(p_office_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN p_role = 'owner' THEN
      -- Creating a new office: only valid when there are no existing members.
      NOT EXISTS (SELECT 1 FROM office_members WHERE office_id = p_office_id)
    ELSE
      -- Joining an existing office: only allowed when link_access is on.
      EXISTS (SELECT 1 FROM offices WHERE id = p_office_id AND link_access = true)
  END;
$$;

DROP POLICY IF EXISTS "Authenticated users can insert office memberships" ON public.office_members;
CREATE POLICY "Authenticated users can insert office memberships"
  ON public.office_members FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.can_self_join_office(office_id, role)
  );

-- ── 3. Allow office owners to remove any member ───────────────────────
CREATE POLICY "Office owners can remove members"
  ON public.office_members FOR DELETE
  TO authenticated
  USING (public.is_office_owner(office_id));
