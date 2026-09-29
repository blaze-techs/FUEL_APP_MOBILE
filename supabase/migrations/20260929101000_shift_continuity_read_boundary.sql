-- FuelPro: continuity RPC read access follows station membership.
CREATE OR REPLACE FUNCTION fuelpro_get_shift_continuity(
  p_station UUID,
  p_shift_date DATE,
  p_shift_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev operational_shifts;
  v_current operational_shifts;
  v_prev_date DATE;
  v_prev_type TEXT;
  v_nozzles JSONB;
BEGIN
  IF fuelpro_user_role(p_station) IS NULL THEN
    RAISE EXCEPTION 'Not authorized to read shift continuity';
  END IF;
  v_prev_date := CASE WHEN p_shift_type='night' THEN p_shift_date ELSE p_shift_date-1 END;
  v_prev_type := CASE WHEN p_shift_type='night' THEN 'day' ELSE 'night' END;
  SELECT * INTO v_current FROM operational_shifts
  WHERE station_id=p_station AND shift_date=p_shift_date
    AND shift_type=p_shift_type AND status <> 'void' LIMIT 1;
  SELECT * INTO v_prev FROM operational_shifts
  WHERE station_id=p_station AND shift_date=v_prev_date
    AND shift_type=v_prev_type AND status <> 'void'
  ORDER BY created_at DESC LIMIT 1;
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('nozzle_id',m.nozzle_id,'opening_meter',m.opening_meter,
      'closing_meter',m.closing_meter,'shift_id',m.shift_id) ORDER BY m.nozzle_id
  ),'[]'::jsonb) INTO v_nozzles
  FROM operational_shift_meters m WHERE m.shift_id=v_prev.id;
  RETURN jsonb_build_object(
    'current_shift',CASE WHEN v_current.id IS NULL THEN NULL ELSE to_jsonb(v_current) END,
    'previous_shift',CASE WHEN v_prev.id IS NULL THEN NULL ELSE to_jsonb(v_prev) END,
    'previous_shift_closed',COALESCE(v_prev.status IN ('closed','reopened'),false),
    'nozzle_closings',v_nozzles
  );
END;
$$;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('20260929101000_shift_continuity_read_boundary','passed',
  jsonb_build_object('applied_at',NOW(),'read_boundary','station membership'));
