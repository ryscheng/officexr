-- Add avatar preset and custom model columns to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_preset_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avatar_model_url  TEXT DEFAULT NULL;

-- Storage bucket for custom avatar models (run once via Supabase dashboard or CLI)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatar-models', 'avatar-models', true)
ON CONFLICT (id) DO NOTHING;

-- RLS: anyone can read avatar models (public bucket)
CREATE POLICY "Public read avatar models"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatar-models');

-- RLS: authenticated users can upload/update only their own folder
CREATE POLICY "Users upload own avatar model"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatar-models'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own avatar model"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatar-models'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own avatar model"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatar-models'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
