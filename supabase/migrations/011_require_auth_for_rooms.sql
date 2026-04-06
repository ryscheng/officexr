-- Require authentication to join any room.
--
-- Anonymous (guest) users are welcome in the global lobby, which is handled
-- entirely client-side and never calls join_office_if_allowed.  Any call to
-- this RPC with a NULL uid means an unauthenticated actor is trying to access
-- a real room, which must be denied regardless of link_access.

CREATE OR REPLACE FUNCTION public.join_office_if_allowed(p_office_id uuid)
RETURNS text   -- 'ready' | 'denied' | 'not-found'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link_access boolean;
BEGIN
  -- Guests are not allowed in any room outside the global lobby.
  IF auth.uid() IS NULL THEN
    RETURN 'denied';
  END IF;

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
