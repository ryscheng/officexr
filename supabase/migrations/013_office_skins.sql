-- Room-level custom GLTF/GLB character skins.
--
-- Any room member can upload a skin; the skin is then selectable by
-- all members of that room.  Members can delete skins they uploaded;
-- admins/owners can delete any skin.

CREATE TABLE public.office_skins (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id   uuid        NOT NULL REFERENCES public.offices(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  model_url   text        NOT NULL,
  uploaded_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.office_skins ENABLE ROW LEVEL SECURITY;

-- Members can see skins for rooms they belong to.
CREATE POLICY "Members read office skins"
  ON public.office_skins FOR SELECT
  TO authenticated
  USING (public.is_member_of_office(office_id));

-- Any member can upload a skin to their room.
CREATE POLICY "Members insert office skins"
  ON public.office_skins FOR INSERT
  TO authenticated
  WITH CHECK (public.is_member_of_office(office_id));

-- Uploader can delete their own skin; admins/owners can delete any.
CREATE POLICY "Members delete own office skins"
  ON public.office_skins FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_office_admin_or_owner(office_id));

-- ── Storage bucket for room skin files ────────────────────────────────────────
-- Files are stored at: room-skins/{officeId}/{uuid}.{glb|gltf}

INSERT INTO storage.buckets (id, name, public)
VALUES ('room-skins', 'room-skins', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (bucket is already public, but explicit policy is best practice).
CREATE POLICY "Public read room skins"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'room-skins');

-- Any room member can upload to the room's folder.
CREATE POLICY "Members upload room skins"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'room-skins'
    AND public.is_member_of_office((storage.foldername(name))[1]::uuid)
  );

-- Any room member can delete files from the room's folder.
-- (Fine-grained ownership is enforced at the office_skins table level.)
CREATE POLICY "Members delete room skins"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'room-skins'
    AND public.is_member_of_office((storage.foldername(name))[1]::uuid)
  );
