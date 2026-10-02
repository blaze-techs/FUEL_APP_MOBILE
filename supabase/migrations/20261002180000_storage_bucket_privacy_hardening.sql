BEGIN;

-- The files bucket previously had a public-read policy over the entire bucket.
-- Keep only intentionally public namespaces public; invoices, statements,
-- uploads and other documents require an authenticated Supabase session.
UPDATE storage.buckets
SET public = false
WHERE id = 'fuelpro-files';

DROP POLICY IF EXISTS fuelpro_files_public_read ON storage.objects;
CREATE POLICY fuelpro_files_public_read_shared
  ON storage.objects FOR SELECT TO anon
  USING (
    bucket_id = 'fuelpro-files'
    AND (storage.foldername(name))[1] IN ('mini-site', 'station-snapshots', 'station-logos')
  );

CREATE POLICY fuelpro_files_auth_read
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fuelpro-files');

COMMIT;
