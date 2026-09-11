-- 011_document_folders_station_index.sql
-- Support for the Document Center folder + per-station (sub-user) isolation.
-- station_id already exists (migration 008); folder_path already exists (010).
-- This migration only adds supporting indexes for folder listing/filtering
-- within a station scope, so per-station folder queries stay fast as the
-- user_documents table grows.

-- Composite index for "list folders / files for one station" queries.
CREATE INDEX IF NOT EXISTS idx_user_documents_station_folder
  ON public.user_documents (station_id, folder_path);

-- Index for filtering by folder within a station.
CREATE INDEX IF NOT EXISTS idx_user_documents_folder
  ON public.user_documents (folder_path)
  WHERE folder_path IS NOT NULL AND folder_path <> '';
