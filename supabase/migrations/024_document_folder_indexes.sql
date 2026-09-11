-- 024_document_folder_indexes.sql
-- Performance indexes for Document Center folder listing/filtering.
-- station_id (migration 008) and folder_path (migration 010) columns
-- already exist; this only adds composite + partial indexes so per-station
-- folder queries stay fast as user_documents grows.

-- Composite index for "list folders / files for one station" queries.
CREATE INDEX IF NOT EXISTS idx_user_documents_station_folder
  ON public.user_documents (station_id, folder_path);

-- Index for filtering by folder within a station.
CREATE INDEX IF NOT EXISTS idx_user_documents_folder
  ON public.user_documents (folder_path)
  WHERE folder_path IS NOT NULL AND folder_path <> '';
