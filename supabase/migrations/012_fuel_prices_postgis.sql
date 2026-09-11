-- ============================================================
-- Migration 012: Global Fuel Prices cache (PostGIS)
--
-- Hyper-local fuel price cache. The serverless fuel-engine
-- (api/lib/fuel-engine.ts) reverse-geocodes the user's GPS to a
-- village/town name, web-searches local fuel prices, parses them
-- with an LLM, and upserts a row here. When a user in a remote
-- village has no exact match, get_nearest_fuel() returns the
-- closest town's price (within a radius) via PostGIS proximity.
--
-- Safe to run on the existing live project — uses IF NOT EXISTS.
-- PostGIS is enabled if available; if the extension cannot be
-- enabled on the plan, the geography column + GIST index are
-- skipped (the engine still works via the lat/lon fallback RPC).
-- ============================================================

-- 1. Enable PostGIS (required for geography + ST_DWithin/ST_Distance).
--    Wrapped in a DO block so a missing extension doesn't abort the
--    whole migration on plans that disable it.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS extension not available: %', SQLERRM;
  END;
END $$;

-- 2. Global fuel price cache.
CREATE TABLE IF NOT EXISTS fuel_prices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_name TEXT NOT NULL,                 -- e.g. "Lodwar", "Kakuma"
  country      TEXT NOT NULL,
  country_code TEXT,
  lat          NUMERIC,
  lon          NUMERIC,
  location     GEOGRAPHY(POINT, 4326),         -- precise distance calculations
  prices       JSONB NOT NULL DEFAULT '{}'::jsonb,
                                              -- {"super_petrol": 220.08, "diesel": 229.95, "kerosene": 198.50}
  currency     TEXT NOT NULL DEFAULT 'Local',
  source       TEXT NOT NULL DEFAULT 'AI-Verified',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  query_count  INT NOT NULL DEFAULT 1
);

-- Unique on (location_name, country) so upserts replace stale rows.
DROP INDEX IF EXISTS fuel_prices_location_country_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS fuel_prices_location_country_uniq
  ON fuel_prices (location_name, country);

-- GIST index for lightning-fast nearest-neighbour searches.
-- Only create if PostGIS is present (the geography column exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'postgis'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fuel_prices' AND column_name = 'location'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_fuel_location ON fuel_prices USING GIST (location);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fuel_name ON fuel_prices (location_name);
CREATE INDEX IF NOT EXISTS idx_fuel_country ON fuel_prices (country);
CREATE INDEX IF NOT EXISTS idx_fuel_query_count ON fuel_prices (query_count DESC);

-- updated_at trigger (reuse the shared update_updated_at() function
-- created in migration 002 if present; otherwise define a local one).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.last_updated = NOW();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

-- Note: fuel_prices uses last_updated, not updated_at, so we use a
-- dedicated trigger function instead of the generic one.
DROP FUNCTION IF EXISTS update_fuel_prices_last_updated() CASCADE;
CREATE OR REPLACE FUNCTION update_fuel_prices_last_updated()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_fuel_prices_last_updated ON fuel_prices;
CREATE TRIGGER update_fuel_prices_last_updated
  BEFORE UPDATE ON fuel_prices
  FOR EACH ROW EXECUTE FUNCTION update_fuel_prices_last_updated();

-- 3. Row Level Security.
--    Price data is public (anyone can read). Writes are done with the
--    service_role key (serverless engine), which bypasses RLS, so we
--    only need a permissive read policy and no write policy for anon.
ALTER TABLE fuel_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fuel_prices public read" ON fuel_prices;
CREATE POLICY "fuel_prices public read"
  ON fuel_prices FOR SELECT USING (true);

-- Grant read access to anon + authenticated (writes go via service_role).
GRANT SELECT ON fuel_prices TO anon, authenticated;

-- 4. Nearest-neighbour RPC (PostGIS path).
--    Returns the closest cached price within `radius_km` of the user.
DROP FUNCTION IF EXISTS get_nearest_fuel(NUMERIC, NUMERIC, INT) CASCADE;
CREATE OR REPLACE FUNCTION get_nearest_fuel(
  user_lat  NUMERIC,
  user_lon  NUMERIC,
  radius_km INT DEFAULT 50
)
RETURNS TABLE (
  location_name TEXT,
  distance_km   NUMERIC,
  prices        JSONB,
  currency      TEXT,
  source        TEXT,
  last_updated  TIMESTAMPTZ
) AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RETURN QUERY
    SELECT
      f.location_name,
      (ST_Distance(f.location, ST_Point(user_lon, user_lat)::geography) / 1000)::NUMERIC AS distance_km,
      f.prices,
      f.currency,
      f.source,
      f.last_updated
    FROM fuel_prices f
    WHERE f.location IS NOT NULL
      AND ST_DWithin(f.location, ST_Point(user_lon, user_lat)::geography, radius_km * 1000)
    ORDER BY distance_km ASC
    LIMIT 1;
  ELSE
    -- PostGIS not available: approximate with planar haversine in SQL.
    RETURN QUERY
    SELECT
      f.location_name,
      (
        6371 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(user_lat - f.lat) / 2), 2) +
          COS(RADIANS(user_lat)) * COS(RADIANS(f.lat)) *
          POWER(SIN(RADIANS(user_lon - f.lon) / 2), 2)
        ))
      )::NUMERIC AS distance_km,
      f.prices,
      f.currency,
      f.source,
      f.last_updated
    FROM fuel_prices f
    WHERE f.lat IS NOT NULL AND f.lon IS NOT NULL
      AND (
        6371 * 2 * ASIN(SQRT(
          POWER(SIN(RADIANS(user_lat - f.lat) / 2), 2) +
          COS(RADIANS(user_lat)) * COS(RADIANS(f.lat)) *
          POWER(SIN(RADIANS(user_lon - f.lon) / 2), 2)
        ))
      ) <= radius_km
    ORDER BY distance_km ASC
    LIMIT 1;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow anon/authenticated to call the nearest-neighbour RPC.
GRANT EXECUTE ON FUNCTION get_nearest_fuel(NUMERIC, NUMERIC, INT) TO anon, authenticated;

-- 5. Bump query_count atomically when an exact match is read.
--    Called by the engine after a cache hit so the monthly cron can
--    refresh the busiest locations first.
DROP FUNCTION IF EXISTS bump_fuel_query_count(TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION bump_fuel_query_count(
  p_location_name TEXT,
  p_country TEXT
)
RETURNS VOID AS $$
BEGIN
  UPDATE fuel_prices
    SET query_count = query_count + 1
    WHERE location_name = p_location_name AND country = p_country;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION bump_fuel_query_count(TEXT, TEXT) TO anon, authenticated;
