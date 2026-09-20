-- Migration 010: Add document metadata columns to user_documents.
--
-- The Document Center (DocumentCenter.tsx) previously stored files in
-- IndexedDB (browser-local, NO cross-device sync). It is being migrated to
-- Supabase Storage + the user_documents table. The Document Center tracks
-- extra metadata (tags, folder_path, thumbnail) that the original
-- user_documents table (migration 008) did not have. This migration adds
-- those columns so documentStore.ts can store ALL metadata in the database.
--
-- Applied live 2026-08-09 via Supabase Management API.

ALTER TABLE user_documents
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS folder_path TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS thumbnail TEXT;
