-- ============================================================
-- Migration 004: cross-device sync guard (idempotent)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) owner_id on stations (legacy projects only had created_by)
ALTER TABLE public.stations
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.stations
   SET owner_id = created_by
 WHERE owner_id IS NULL AND created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stations_owner ON public.stations(owner_id);

-- 2) Full RLS set on stations (SELECT/INSERT/UPDATE/DELETE)
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own stations" ON public.stations;
CREATE POLICY "Users can view their own stations"
  ON public.stations FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can insert their own stations" ON public.stations;
CREATE POLICY "Users can insert their own stations"
  ON public.stations FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update their own stations" ON public.stations;
CREATE POLICY "Users can update their own stations"
  ON public.stations FOR UPDATE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete their own stations" ON public.stations;
CREATE POLICY "Users can delete their own stations"
  ON public.stations FOR DELETE USING (auth.uid() = owner_id);

-- 3) app_kv guard (same as 002, for projects that never ran it)
CREATE TABLE IF NOT EXISTS public.app_kv (
  id         TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  owner_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  station_id UUID REFERENCES public.stations(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_kv_collection_idx ON public.app_kv (collection);

ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own app_kv rows" ON public.app_kv;
CREATE POLICY "Users can manage their own app_kv rows"
  ON public.app_kv FOR ALL USING (
    owner_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.stations
             WHERE stations.id = app_kv.station_id
               AND stations.owner_id = auth.uid())
  );

-- 4) updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_stations_updated_at ON public.stations;
CREATE TRIGGER update_stations_updated_at
  BEFORE UPDATE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_app_kv_updated_at ON public.app_kv;
CREATE TRIGGER update_app_kv_updated_at
  BEFORE UPDATE ON public.app_kv
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
