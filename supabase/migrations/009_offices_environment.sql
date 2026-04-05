-- Persist room environment so all users (including new joiners) see the same scene.
--
-- Adds an `environment` column to offices and a SECURITY DEFINER RPC that any
-- room member can call to update it.  Using an RPC avoids having to grant broad
-- UPDATE access on the offices row (which would let members rename rooms, etc.).

-- 1. Add column
ALTER TABLE public.offices
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'corporate'
  CHECK (environment IN ('corporate', 'cabin', 'coffeeshop'));

-- 2. RPC: any room member can change the environment
CREATE OR REPLACE FUNCTION public.set_office_environment(p_office_id uuid, p_environment text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_environment NOT IN ('corporate', 'cabin', 'coffeeshop') THEN
    RAISE EXCEPTION 'Invalid environment: %', p_environment;
  END IF;

  IF NOT public.is_member_of_office(p_office_id) THEN
    RAISE EXCEPTION 'Not a member of this office';
  END IF;

  UPDATE public.offices SET environment = p_environment WHERE id = p_office_id;
END;
$$;
