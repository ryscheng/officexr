-- Persist room environment so all users (including new joiners) see the same scene.
--
-- Adds an `environment` column to offices and a SECURITY DEFINER RPC that any
-- room member can call to update it.  Using an RPC avoids having to grant broad
-- UPDATE access on the offices row (which would let members rename rooms, etc.).
--
-- Environment values are arbitrary strings; unknown values fall back to the
-- default scene in client code.

-- 1. Add column (no CHECK constraint — arbitrary scene names are allowed)
ALTER TABLE public.offices
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'corporate';

-- 2. RPC: any room member can change the environment
CREATE OR REPLACE FUNCTION public.set_office_environment(p_office_id uuid, p_environment text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_member_of_office(p_office_id) THEN
    RAISE EXCEPTION 'Not a member of this office';
  END IF;

  UPDATE public.offices SET environment = p_environment WHERE id = p_office_id;
END;
$$;
