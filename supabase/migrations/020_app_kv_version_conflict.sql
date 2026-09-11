-- Migration 020: app_kv optimistic-concurrency versioning + conflict resolution
--
-- Problem: when two devices are open at the same time and both edit data,
-- `set()` is last-writer-wins with no version awareness. Device B (working
-- from a stale read) silently overwrites device A's newer write — the data
-- "conflicts because it's uncertain which to rely on". This adds:
--
--   1. A `version` BIGINT column (monotonic per-row counter, 1-based) so a
--      writer can detect that a newer revision exists before overwriting.
--   2. A `update_app_kv_version` trigger that increments `version` and
--      refreshes `updated_at` on every UPDATE. (INSERTs start at version 1.)
--   3. A helper RPC `upsert_app_kv_versioned` that performs an atomic
--      conditional upsert: it only UPDATEs when the existing row's version
--      equals the caller-supplied `expected_version`, OR when the row does
--      not exist yet (INSERT). On a version mismatch it returns the current
--      row so the client can merge and retry. This is optimistic concurrency.
--
-- The version is read by clients via `select id, data, version, updated_at`.
-- The original `update_updated_at` trigger is preserved (now alongside the
-- version trigger) so existing `updated_at`-based logic keeps working.

ALTER TABLE app_kv
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS app_kv_version_idx ON app_kv (version);

-- Increment version + updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION update_app_kv_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_app_kv_version_trigger ON app_kv;
CREATE TRIGGER update_app_kv_version_trigger
  BEFORE UPDATE ON app_kv
  FOR EACH ROW
  EXECUTE FUNCTION update_app_kv_version();

-- Atomic conditional upsert used by the client for optimistic concurrency.
-- Returns a JSONB row: { ok: bool, id, version, updated_at, data }.
--   ok=true  -> the write was applied (INSERT or version matched).
--   ok=false -> a newer revision exists; `data`/`version` hold the current
--               remote value so the client can merge + retry.
CREATE OR REPLACE FUNCTION upsert_app_kv_versioned(
  p_id TEXT,
  p_owner_id UUID,
  p_station_id TEXT,
  p_collection TEXT,
  p_data JSONB,
  p_expected_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_version BIGINT;
  existing_data JSONB;
  existing_updated TIMESTAMPTZ;
BEGIN
  SELECT version, data, updated_at
    INTO existing_version, existing_data, existing_updated
    FROM app_kv
    WHERE id = p_id AND (owner_id = p_owner_id OR p_owner_id IS NULL);

  IF NOT FOUND THEN
    -- INSERT (row does not exist). version defaults to 1.
    INSERT INTO app_kv (id, collection, owner_id, station_id, data, version, updated_at)
      VALUES (p_id, p_collection, p_owner_id, p_station_id, p_data, 1, NOW())
      ON CONFLICT (id) DO NOTHING;
    RETURN jsonb_build_object(
      'ok', true, 'id', p_id, 'version', 1, 'updated_at', NOW()::text, 'data', p_data
    );
  END IF;

  -- UPDATE only when the existing version matches the caller's expectation.
  -- A first-write (client expected_version 0 / null) always applies as an
  -- UPDATE when the row exists but the client never read it (treat as fresh).
  IF p_expected_version IS NULL OR existing_version = p_expected_version OR p_expected_version = 0 THEN
    UPDATE app_kv
      SET data = p_data,
          station_id = COALESCE(p_station_id, app_kv.station_id),
          collection = COALESCE(p_collection, app_kv.collection)
      WHERE id = p_id;
    RETURN jsonb_build_object(
      'ok', true, 'id', p_id, 'version', existing_version + 1,
      'updated_at', NOW()::text, 'data', p_data
    );
  END IF;

  -- Conflict: remote is newer. Return the remote value so the client merges.
  RETURN jsonb_build_object(
    'ok', false, 'id', p_id, 'version', existing_version,
    'updated_at', existing_updated::text, 'data', existing_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_app_kv_versioned() TO authenticated;
