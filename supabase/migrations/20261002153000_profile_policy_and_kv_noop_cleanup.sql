BEGIN;

-- Remove legacy broad profile policies left behind by earlier hardening migrations.
DROP POLICY IF EXISTS profiles_anon_select ON public.profiles;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;

-- Do not advance app_kv versions for byte-for-byte identical payloads. This
-- prevents render/autosave loops from turning harmless no-op writes into
-- tens of thousands of revisions and unnecessary realtime traffic.
CREATE OR REPLACE FUNCTION public.upsert_app_kv_versioned(
  p_id text,
  p_owner_id uuid,
  p_station_id uuid,
  p_collection text,
  p_data jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current integer;
  v_row public.app_kv%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR p_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_row
  FROM public.app_kv
  WHERE id = p_id
    AND owner_id = p_owner_id
    AND station_id IS NOT DISTINCT FROM p_station_id
    AND collection = p_collection
  FOR UPDATE;

  v_current := v_row.version;

  IF v_row.id IS NOT NULL THEN
    IF p_expected_version IS NULL OR p_expected_version <> v_current THEN
      RETURN jsonb_build_object('ok', false, 'conflict', true,
        'version', v_current, 'data', v_row.data, 'updated_at', v_row.updated_at);
    END IF;

    IF v_row.data IS NOT DISTINCT FROM p_data THEN
      RETURN jsonb_build_object('ok', true, 'conflict', false,
        'version', v_current, 'data', v_row.data, 'updated_at', v_row.updated_at,
        'noop', true);
    END IF;

    UPDATE public.app_kv
       SET data = p_data, version = v_current + 1, updated_at = now()
     WHERE id = p_id
       AND owner_id = p_owner_id
       AND station_id IS NOT DISTINCT FROM p_station_id
       AND collection = p_collection
     RETURNING * INTO v_row;
  ELSE
    IF p_expected_version IS NOT NULL AND p_expected_version <> 0 THEN
      RETURN jsonb_build_object('ok', false, 'conflict', true,
        'version', NULL, 'data', NULL, 'updated_at', NULL);
    END IF;

    INSERT INTO public.app_kv(id, owner_id, station_id, collection, data, version, updated_at)
    VALUES(p_id, p_owner_id, p_station_id, p_collection, p_data, 1, now())
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('ok', true, 'conflict', false,
    'version', v_row.version, 'data', v_row.data, 'updated_at', v_row.updated_at);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_app_kv_versioned(text, uuid, uuid, text, jsonb, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_app_kv_versioned(text, uuid, uuid, text, jsonb, integer) TO authenticated;

COMMIT;
