-- Isolate publicly readable company logos from the private documents bucket.
-- Public bucket access is intentional only for image assets stored here.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fuelpro-logos',
  'fuelpro-logos',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

DROP POLICY IF EXISTS fuelpro_logos_insert_owner ON storage.objects;
CREATE POLICY fuelpro_logos_insert_owner
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'fuelpro-logos'
    AND (storage.foldername(name))[1] = 'logos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS fuelpro_logos_select_owner ON storage.objects;
CREATE POLICY fuelpro_logos_select_owner
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'fuelpro-logos'
    AND (storage.foldername(name))[1] = 'logos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS fuelpro_logos_update_owner ON storage.objects;
CREATE POLICY fuelpro_logos_update_owner
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'fuelpro-logos'
    AND (storage.foldername(name))[1] = 'logos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'fuelpro-logos'
    AND (storage.foldername(name))[1] = 'logos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS fuelpro_logos_delete_owner ON storage.objects;
CREATE POLICY fuelpro_logos_delete_owner
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'fuelpro-logos'
    AND (storage.foldername(name))[1] = 'logos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

COMMIT;
