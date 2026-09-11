-- ============================================================
-- Migration 002: app_kv table
-- Run this in your Supabase project's SQL Editor.
-- Safe to run on your existing live project — uses IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_kv (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_kv_collection_idx ON app_kv (collection);

ALTER TABLE app_kv ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own app_kv rows" ON app_kv;
CREATE POLICY "Users can manage their own app_kv rows"
  ON app_kv FOR ALL USING (
    owner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM stations WHERE stations.id = app_kv.station_id AND stations.owner_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_app_kv_updated_at ON app_kv;
CREATE TRIGGER update_app_kv_updated_at BEFORE UPDATE ON app_kv FOR EACH ROW EXECUTE FUNCTION update_updated_at();
