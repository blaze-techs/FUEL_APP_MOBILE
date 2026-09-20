-- Migration 038: harden app_kv sync concurrency.
-- A NULL expected version is never allowed to overwrite an existing row.
-- Callers must first read the remote revision and merge/retry on conflict.
ALTER TABLE app_kv ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS app_kv_version_idx ON app_kv (version);

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
FOR EACH ROW EXECUTE FUNCTION update_app_kv_version();

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
SET search_path = public
AS $$
DECLARE
  existing_version BIGINT;
  existing_data JSONB;
  existing_updated TIMESTAMPTZ;
BEGIN
  SELECT version, data, updated_at
    INTO existing_version, existing_data, existing_updated
    FROM app_kv
   WHERE id = p_id
     AND (owner_id = p_owner_id OR p_owner_id IS NULL);

  IF NOT FOUND THEN
    INSERT INTO app_kv (id, collection, owner_id, station_id, data, version, updated_at)
    VALUES (p_id, p_collection, p_owner_id, p_station_id, p_data, 1, NOW())
    ON CONFLICT (id) DO NOTHING;

    IF EXISTS (SELECT 1 FROM app_kv WHERE id = p_id AND owner_id = p_owner_id) THEN
      SELECT version, data, updated_at
        INTO existing_version, existing_data, existing_updated
        FROM app_kv
       WHERE id = p_id AND owner_id = p_owner_id;

      IF existing_version <> 1 OR existing_data IS DISTINCT FROM p_data THEN
        RETURN jsonb_build_object(
          'ok', false, 'id', p_id, 'version', existing_version,
          'updated_at', existing_updated::text, 'data', existing_data
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'id', p_id, 'version', 1,
      'updated_at', NOW()::text, 'data', p_data
    );
  END IF;

  IF p_expected_version IS NULL OR existing_version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false, 'id', p_id, 'version', existing_version,
      'updated_at', existing_updated::text, 'data', existing_data
    );
  END IF;

  UPDATE app_kv
     SET data = p_data,
         station_id = COALESCE(p_station_id, app_kv.station_id),
         collection = COALESCE(p_collection, app_kv.collection)
   WHERE id = p_id AND owner_id = p_owner_id;

  RETURN jsonb_build_object(
    'ok', true, 'id', p_id, 'version', existing_version + 1,
    'updated_at', NOW()::text, 'data', p_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_app_kv_versioned(TEXT, UUID, TEXT, TEXT, JSONB, BIGINT)
TO authenticated;
