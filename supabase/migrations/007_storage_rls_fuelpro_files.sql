-- Storage RLS policies for fuelpro-files bucket
-- Allows authenticated users to upload/read/delete their own files scoped by
-- path prefix `logos/<uid>/...` (and a shared public-read for the public bucket).
-- Applied via Supabase Management API (database/query).

-- 1. Authenticated users can INSERT (upload) objects they own (path scoped by uid)
CREATE POLICY "fuelpro_files_upload_owner"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'fuelpro-files'
  AND (storage.foldername(name))[1] = 'logos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- 2. Authenticated users can UPDATE their own objects
CREATE POLICY "fuelpro_files_update_owner"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'fuelpro-files'
  AND (storage.foldername(name))[1] = 'logos'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'fuelpro-files'
  AND (storage.foldername(name))[1] = 'logos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- 3. Authenticated users can DELETE their own objects
CREATE POLICY "fuelpro_files_delete_owner"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'fuelpro-files'
  AND (storage.foldername(name))[1] = 'logos'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- 4. Public read for the public bucket (so logos render without auth)
CREATE POLICY "fuelpro_files_public_read"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'fuelpro-files');
