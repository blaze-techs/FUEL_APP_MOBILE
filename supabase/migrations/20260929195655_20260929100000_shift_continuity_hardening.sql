-- FuelPro shift continuity hardening
-- Canonical sequence: Date Day -> Date Night -> next Date Day -> next Date Night.

CREATE UNIQUE INDEX IF NOT EXISTS operational_shifts_station_date_type_uq
  ON operational_shifts(station_id, shift_date, shift_type)
  WHERE status <> 'void';

CREATE OR REPLACE FUNCTION fuelpro_open_shift(
  p_station UUID,
  p_shift_date DATE,
  p_shift_type TEXT
)
RETURNS operational_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift operational_shifts;
  v_prev operational_shifts;
  v_existing operational_shifts;
  v_prev_date DATE;
  v_prev_type TEXT;
  v_has_any BOOLEAN;
BEGIN
  IF p_shift_type NOT IN ('day','night') THEN RAISE EXCEPTION 'shift_type must be day or night'; END IF;
  IF NOT fuelpro_has_permission(p_station,'shift.open') THEN RAISE EXCEPTION 'Not authorized to open shift'; END IF;
  IF fuelpro_period_is_locked(p_station,p_shift_date::timestamptz) THEN RAISE EXCEPTION 'Accounting period is locked'; END IF;

  SELECT * INTO v_existing FROM operational_shifts
  WHERE station_id=p_station AND shift_date=p_shift_date AND shift_type=p_shift_type AND status <> 'void' LIMIT 1;
  IF FOUND THEN RETURN v_existing; END IF;

  v_prev_date := CASE WHEN p_shift_type='night' THEN p_shift_date ELSE p_shift_date - 1 END;
  v_prev_type := CASE WHEN p_shift_type='night' THEN 'day' ELSE 'night' END;

  SELECT * INTO v_prev FROM operational_shifts
  WHERE station_id=p_station AND shift_date=v_prev_date AND shift_type=v_prev_type AND status <> 'void'
  ORDER BY created_at DESC LIMIT 1;

  SELECT EXISTS(
    SELECT 1 FROM operational_shifts
    WHERE station_id=p_station AND status <> 'void'
      AND (shift_date < p_shift_date OR (shift_date=p_shift_date AND shift_type='day' AND p_shift_type='night'))
  ) INTO v_has_any;

  IF NOT v_has_any AND p_shift_type <> 'day' THEN RAISE EXCEPTION 'The first shift must be the Day shift'; END IF;
  IF v_has_any AND v_prev.id IS NULL THEN RAISE EXCEPTION 'Shift sequence is broken: the immediately preceding shift must be completed first'; END IF;
  IF v_prev.id IS NOT NULL AND v_prev.status NOT IN ('closed','reopened') THEN RAISE EXCEPTION 'Previous shift must be closed before opening this shift'; END IF;

  INSERT INTO operational_shifts(station_id,shift_date,shift_type,opened_by,previous_shift_id)
  VALUES(p_station,p_shift_date,p_shift_type,auth.uid(),v_prev.id)
  RETURNING * INTO v_shift;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_station,auth.uid(),'shift.open','operational_shift',v_shift.id::text,to_jsonb(v_shift));
  RETURN v_shift;
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_enforce_shift_meter_continuity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift operational_shifts;
  v_prev_shift UUID;
  v_expected NUMERIC;
BEGIN
  SELECT * INTO v_shift FROM operational_shifts WHERE id=NEW.shift_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot record meter reading: shift not found'; END IF;

  v_prev_shift := v_shift.previous_shift_id;

  IF v_prev_shift IS NULL THEN
    SELECT id INTO v_prev_shift FROM operational_shifts
    WHERE station_id=v_shift.station_id
      AND shift_date=CASE WHEN v_shift.shift_type='night' THEN v_shift.shift_date ELSE v_shift.shift_date-1 END
      AND shift_type=CASE WHEN v_shift.shift_type='night' THEN 'day' ELSE 'night' END
      AND status <> 'void'
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_prev_shift IS NOT NULL THEN
    SELECT closing_meter INTO v_expected FROM operational_shift_meters
    WHERE shift_id=v_prev_shift AND nozzle_id=NEW.nozzle_id
    ORDER BY created_at DESC LIMIT 1;

    IF v_expected IS NULL THEN RAISE EXCEPTION 'Previous shift has no closing meter for nozzle %',NEW.nozzle_id; END IF;

    IF ABS(NEW.opening_meter-v_expected) > 0.001 THEN
      INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
      VALUES(
        NEW.station_id,'continuity_break','high','operational_shift',NEW.shift_id::text,
        jsonb_build_object('nozzle_id',NEW.nozzle_id,'expected_opening',v_expected,
          'actual_opening',NEW.opening_meter,'previous_shift_id',v_prev_shift)
      );
      RAISE EXCEPTION 'Pump/nozzle meter continuity failure: expected opening %, got %',v_expected,NEW.opening_meter;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operational_shift_meter_continuity ON operational_shift_meters;
CREATE TRIGGER operational_shift_meter_continuity
BEFORE INSERT ON operational_shift_meters
FOR EACH ROW EXECUTE FUNCTION fuelpro_enforce_shift_meter_continuity();

CREATE OR REPLACE FUNCTION fuelpro_get_shift_continuity(
  p_station UUID, p_shift_date DATE, p_shift_type TEXT
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
  IF NOT fuelpro_has_permission(p_station,'shift.read') THEN RAISE EXCEPTION 'Not authorized to read shift continuity'; END IF;

  v_prev_date := CASE WHEN p_shift_type='night' THEN p_shift_date ELSE p_shift_date-1 END;
  v_prev_type := CASE WHEN p_shift_type='night' THEN 'day' ELSE 'night' END;

  SELECT * INTO v_current FROM operational_shifts
  WHERE station_id=p_station AND shift_date=p_shift_date AND shift_type=p_shift_type AND status <> 'void' LIMIT 1;

  SELECT * INTO v_prev FROM operational_shifts
  WHERE station_id=p_station AND shift_date=v_prev_date AND shift_type=v_prev_type AND status <> 'void'
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
VALUES('20260929100000_shift_continuity_hardening','passed',
  jsonb_build_object('applied_at',NOW(),'rule','Date Day -> Date Night -> next Date Day -> next Date Night'));
