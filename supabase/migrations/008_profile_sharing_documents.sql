-- 008_profile_sharing_documents.sql
-- Adds: phone/username to profiles, user_documents table, station_members table,
-- broadened storage RLS for cross-device document upload/access.
-- Applied via Supabase Management API (database/query).

-- ============================================================
-- SECTION 1: PROFILES — add phone, username, avatar_url
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Unique username constraint (NULLS DISTINCT so multiple NULLs allowed)
DROP INDEX IF EXISTS idx_profiles_username_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique
  ON public.profiles (username) WHERE username IS NOT NULL;

-- Update handle_new_user to also copy username from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'username', NULL)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, profiles.name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SECTION 2: STATION_MEMBERS — DB-backed station sharing
-- ============================================================
CREATE TABLE IF NOT EXISTS public.station_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email TEXT,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'staff',
  status TEXT NOT NULL DEFAULT 'pending',
  invite_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.station_members ENABLE ROW LEVEL SECURITY;

-- Owner can manage members of their stations
DROP POLICY IF EXISTS "station_members_owner_manage" ON public.station_members;
CREATE POLICY "station_members_owner_manage" ON public.station_members FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = station_members.station_id AND stations.owner_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM stations WHERE stations.id = station_members.station_id AND stations.owner_id = auth.uid())
  );

-- A user can read rows where they are the invited/accepted member
DROP POLICY IF EXISTS "station_members_self_read" ON public.station_members;
CREATE POLICY "station_members_self_read" ON public.station_members FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR invited_email = (
      SELECT email FROM auth.users WHERE id = auth.uid()
    )
  );

-- A user can UPDATE their own membership row (accept/reject invite)
DROP POLICY IF EXISTS "station_members_self_update" ON public.station_members;
CREATE POLICY "station_members_self_update" ON public.station_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR invited_email = (
      SELECT email FROM auth.users WHERE id = auth.uid()
    ))
  WITH CHECK (user_id = auth.uid() OR invited_email = (
      SELECT email FROM auth.users WHERE id = auth.uid()
    ));

CREATE INDEX IF NOT EXISTS idx_station_members_station ON public.station_members(station_id);
CREATE INDEX IF NOT EXISTS idx_station_members_user ON public.station_members(user_id);
CREATE INDEX IF NOT EXISTS idx_station_members_token ON public.station_members(invite_token);

-- ============================================================
-- SECTION 3: USER_DOCUMENTS — cross-device file metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size BIGINT,
  mime_type TEXT,
  category TEXT DEFAULT 'general',
  description TEXT,
  storage_bucket TEXT DEFAULT 'fuelpro-files',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_documents_owner_all" ON public.user_documents;
CREATE POLICY "user_documents_owner_all" ON public.user_documents FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Station members can also read documents shared with their station
DROP POLICY IF EXISTS "user_documents_station_read" ON public.user_documents;
CREATE POLICY "user_documents_station_read" ON public.user_documents FOR SELECT
  TO authenticated
  USING (
    station_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM station_members
      WHERE station_members.station_id = user_documents.station_id
        AND station_members.user_id = auth.uid()
        AND station_members.status = 'accepted'
    )
  );

CREATE INDEX IF NOT EXISTS idx_user_documents_owner ON public.user_documents(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_documents_station ON public.user_documents(station_id);

-- ============================================================
-- SECTION 4: STORAGE RLS — broaden fuelpro-files for documents
-- ============================================================
-- Allow uploads under documents/<uid>/... (in addition to logos/<uid>/...)
DROP POLICY IF EXISTS "fuelpro_files_upload_owner" ON storage.objects;
CREATE POLICY "fuelpro_files_upload_owner"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'fuelpro-files'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "fuelpro_files_update_owner" ON storage.objects;
CREATE POLICY "fuelpro_files_update_owner"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'fuelpro-files'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'fuelpro-files'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "fuelpro_files_delete_owner" ON storage.objects;
CREATE POLICY "fuelpro_files_delete_owner"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'fuelpro-files'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- public read remains unchanged
DROP POLICY IF EXISTS "fuelpro_files_public_read" ON storage.objects;
CREATE POLICY "fuelpro_files_public_read"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'fuelpro-files');
