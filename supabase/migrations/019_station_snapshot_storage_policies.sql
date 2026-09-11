-- Migration 019: Station snapshot storage policies (APPLIED LIVE 2026-08-18)
--
-- Allows the station OWNER (authenticated) to upload/update a public
-- read-only station snapshot at:
--   fuelpro-files/station-snapshots/<stationId>/snapshot.json
--
-- The `fuelpro-files` bucket is already PUBLIC (fuelpro_files_public_read
-- SELECT policy), so the snapshot is fetchable by ANYONE (no auth) — this is
-- intentional: a team member logged in via an Access Code has NO Supabase
-- session, so RLS would block them from app_kv. The snapshot is the public
-- channel that lets them view the approved sections read-only.
--
-- The existing upload/update policies use `(storage.foldername(name))[2] = auth.uid()`
-- which matches `logos/<uid>/...` and `documents/<uid>/...` but NOT
-- `station-snapshots/<stationId>/...` (where foldername[2] is the stationId,
-- not the uid). These two new policies allow any authenticated user to
-- upload to the `station-snapshots/` prefix.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'station_snapshots_auth_upload'
  ) THEN
    CREATE POLICY station_snapshots_auth_upload
      ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'fuelpro-files'
        AND (storage.foldername(name))[1] = 'station-snapshots'
        AND auth.role() = 'authenticated'
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'station_snapshots_auth_update'
  ) THEN
    CREATE POLICY station_snapshots_auth_update
      ON storage.objects
      FOR UPDATE
      USING (
        bucket_id = 'fuelpro-files'
        AND (storage.foldername(name))[1] = 'station-snapshots'
        AND auth.role() = 'authenticated'
      )
      WITH CHECK (
        bucket_id = 'fuelpro-files'
        AND (storage.foldername(name))[1] = 'station-snapshots'
        AND auth.role() = 'authenticated'
      );
  END IF;
END$$;
