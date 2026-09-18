-- Migration 034: authoritative shift close runs and server-derived variance approvals.

CREATE TABLE IF NOT EXISTS shift_close_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  run_number INTEGER NOT NULL CHECK (run_number > 0),
  meter_expected_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  canonical_sales_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  meter_variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_expected_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_counted_total NUMERIC(18,2) NOT NULL DEFAULT 0,
  payment_variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_variance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('closed','pending_approval','approved')),
  variance_reason TEXT,
  closed_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_id,run_number)
);

CREATE TABLE IF NOT EXISTS shift_close_payment_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  close_run_id UUID NOT NULL REFERENCES shift_close_runs(id) ON DELETE RESTRICT,
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL,
  expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  counted_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance_amount NUMERIC(18,2) GENERATED ALWAYS AS (counted_amount-expected_amount) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(close_run_id,payment_method)
);

ALTER TABLE shift_close_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_close_payment_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_close_runs_scope ON shift_close_runs FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY shift_close_payment_counts_scope ON shift_close_payment_counts FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);

CREATE TRIGGER shift_close_runs_immutable
BEFORE UPDATE OR DELETE ON shift_close_runs
FOR EACH ROW EXECUTE FUNCTION fuelpro_block_update_delete();
CREATE TRIGGER shift_close_payment_counts_immutable
BEFORE UPDATE OR DELETE ON shift_close_payment_counts
FOR EACH ROW EXECUTE FUNCTION fuelpro_block_update_delete();

-- Approval metadata must be append-only rather than mutating the immutable close run.
CREATE TABLE IF NOT EXISTS shift_variance_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  close_run_id UUID NOT NULL REFERENCES shift_close_runs(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  approved_by UUID NOT NULL REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(close_run_id)
);
ALTER TABLE shift_variance_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_variance_approvals_scope ON shift_variance_approvals FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE TRIGGER shift_variance_approvals_immutable
BEFORE UPDATE OR DELETE ON shift_variance_approvals
FOR EACH ROW EXECUTE FUNCTION fuelpro_block_update_delete();

CREATE OR REPLACE FUNCTION fuelpro_close_shift(
  p_shift UUID,
  p_meter_rows JSONB,
  p_payment_rows JSONB DEFAULT '[]'::jsonb,
  p_variance_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shift operational_shifts;
  v_row JSONB;
  v_nozzle UUID;
  v_open NUMERIC;
  v_close NUMERIC;
  v_price NUMERIC;
  v_actual NUMERIC;
  v_previous_close NUMERIC;
  v_expected NUMERIC;
  v_nozzle_variance NUMERIC;
  v_meter_expected_total NUMERIC := 0;
  v_sales_total NUMERIC := 0;
  v_meter_variance NUMERIC := 0;
  v_payment_expected NUMERIC := 0;
  v_payment_counted NUMERIC := 0;
  v_payment_variance NUMERIC := 0;
  v_max_variance NUMERIC := 0;
  v_run_number INTEGER;
  v_close_run shift_close_runs;
  v_status TEXT;
  v_snapshot_count INTEGER;
  v_existing_meter_count INTEGER;
  v_pending_payments INTEGER;
  v_counted NUMERIC;
  v_method TEXT;
  v_expected_method NUMERIC;
BEGIN
  SELECT * INTO v_shift FROM operational_shifts WHERE id=p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status NOT IN ('open','reopened') THEN
    RAISE EXCEPTION 'Shift is not open/reopened';
  END IF;
  IF NOT fuelpro_has_permission(v_shift.station_id,'shift.close') THEN
    RAISE EXCEPTION 'Not authorized to close shift';
  END IF;
  IF fuelpro_period_is_locked(v_shift.station_id,v_shift.shift_date::timestamptz) THEN
    RAISE EXCEPTION 'Accounting period is locked';
  END IF;

  SELECT COUNT(*) INTO v_snapshot_count
  FROM operational_shift_price_snapshots WHERE shift_id=p_shift;
  SELECT COUNT(*) INTO v_existing_meter_count
  FROM operational_shift_meters WHERE shift_id=p_shift;

  -- First close captures physical meter readings exactly once.
  IF v_existing_meter_count=0 THEN
    IF jsonb_array_length(COALESCE(p_meter_rows,'[]'::jsonb)) <> v_snapshot_count THEN
      RAISE EXCEPTION 'Every snapshotted active nozzle requires a closing meter reading (% expected)',v_snapshot_count;
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_meter_rows,'[]'::jsonb))
    LOOP
      v_nozzle := (v_row->>'nozzle_id')::uuid;
      v_open := (v_row->>'opening_meter')::numeric;
      v_close := (v_row->>'closing_meter')::numeric;

      SELECT price_per_liter INTO v_price
      FROM operational_shift_price_snapshots
      WHERE shift_id=p_shift AND nozzle_id=v_nozzle;
      IF v_price IS NULL THEN RAISE EXCEPTION 'No price snapshot for nozzle %',v_nozzle; END IF;

      IF v_close < v_open THEN
        INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
        VALUES(v_shift.station_id,'backwards_meter','critical','operational_shift',p_shift::text,v_row);
        RAISE EXCEPTION 'Closing meter cannot be below opening meter';
      END IF;

      SELECT osm.closing_meter INTO v_previous_close
      FROM operational_shift_meters osm
      JOIN operational_shifts os ON os.id=osm.shift_id
      WHERE osm.station_id=v_shift.station_id
        AND osm.nozzle_id=v_nozzle
        AND osm.shift_id<>p_shift
      ORDER BY os.closed_at DESC NULLS LAST,osm.created_at DESC
      LIMIT 1;

      IF v_previous_close IS NOT NULL AND ABS(v_open-v_previous_close)>0.001 THEN
        INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
        VALUES(v_shift.station_id,'continuity_break','high','operational_shift',p_shift::text,
          jsonb_build_object('nozzle_id',v_nozzle,'expected_opening',v_previous_close,'actual_opening',v_open));
        RAISE EXCEPTION 'Pump meter continuity failure for nozzle %: expected %, got %',v_nozzle,v_previous_close,v_open;
      END IF;

      SELECT COALESCE(gross_amount,0) INTO v_actual
      FROM canonical_shift_nozzle_sales
      WHERE shift_id=p_shift AND nozzle_id=v_nozzle;
      v_actual := COALESCE(v_actual,0);
      v_expected := ROUND((v_close-v_open)*v_price,2);
      v_nozzle_variance := ROUND(v_actual-v_expected,2);

      INSERT INTO operational_shift_meters(
        station_id,shift_id,nozzle_id,opening_meter,closing_meter,price_per_liter,actual_sales,entered_by
      ) VALUES(
        v_shift.station_id,p_shift,v_nozzle,v_open,v_close,v_price,v_actual,auth.uid()
      );

      IF (v_close-v_open)>100000 THEN
        INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
        VALUES(v_shift.station_id,'suspicious_meter_jump','high','operational_shift',p_shift::text,
          jsonb_build_object('nozzle_id',v_nozzle,'opening',v_open,'closing',v_close));
      END IF;
      IF ABS(v_nozzle_variance)>GREATEST(100,v_expected*0.005) THEN
        INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
        VALUES(v_shift.station_id,'large_variance',
          CASE WHEN ABS(v_nozzle_variance)>5000 THEN 'critical' ELSE 'high' END,
          'operational_shift',p_shift::text,
          jsonb_build_object('nozzle_id',v_nozzle,'expected',v_expected,'actual',v_actual,'variance',v_nozzle_variance));
      END IF;
    END LOOP;
  END IF;

  -- Every close/re-close recalculates against the current immutable sales ledger.
  SELECT COALESCE(SUM(expected_sales),0) INTO v_meter_expected_total
  FROM operational_shift_meters WHERE shift_id=p_shift;
  SELECT COALESCE(SUM(gross_amount),0) INTO v_sales_total
  FROM sales_ledger WHERE shift_id=p_shift;
  v_meter_variance := ROUND(v_sales_total-v_meter_expected_total,2);

  SELECT COALESCE(SUM(pending_count),0),COALESCE(SUM(confirmed_amount),0)
  INTO v_pending_payments,v_payment_expected
  FROM canonical_shift_payment_totals WHERE shift_id=p_shift;
  IF COALESCE(v_pending_payments,0)>0 THEN
    RAISE EXCEPTION 'Cannot close shift with % pending payment(s)',v_pending_payments;
  END IF;

  SELECT COALESCE(MAX(run_number),0)+1 INTO v_run_number
  FROM shift_close_runs WHERE shift_id=p_shift;

  -- Use operator counts only as physical counted values; expected is always canonical.
  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_payment_rows,'[]'::jsonb))
  LOOP
    v_method := v_row->>'payment_method';
    v_counted := COALESCE((v_row->>'counted_amount')::numeric,0);
    SELECT COALESCE(confirmed_amount,0) INTO v_expected_method
    FROM canonical_shift_payment_totals
    WHERE shift_id=p_shift AND payment_method=v_method;
    v_expected_method := COALESCE(v_expected_method,0);
    v_payment_counted := v_payment_counted+v_counted;
  END LOOP;

  -- Methods not physically listed count as zero and therefore become a variance.
  v_payment_variance := ROUND(v_payment_counted-v_payment_expected,2);
  v_max_variance := GREATEST(ABS(v_meter_variance),ABS(v_payment_variance));
  v_status := CASE
    WHEN v_max_variance>GREATEST(100,GREATEST(v_meter_expected_total,v_payment_expected)*0.005)
      THEN 'pending_approval'
    ELSE 'closed'
  END;

  INSERT INTO shift_close_runs(
    station_id,shift_id,run_number,meter_expected_total,canonical_sales_total,meter_variance_amount,
    payment_expected_total,payment_counted_total,payment_variance_amount,max_variance_amount,
    status,variance_reason,closed_by
  ) VALUES(
    v_shift.station_id,p_shift,v_run_number,v_meter_expected_total,v_sales_total,v_meter_variance,
    v_payment_expected,v_payment_counted,v_payment_variance,v_max_variance,
    v_status,p_variance_reason,auth.uid()
  ) RETURNING * INTO v_close_run;

  -- Persist all canonical payment methods plus any additional counted method.
  FOR v_method IN
    SELECT payment_method FROM canonical_shift_payment_totals WHERE shift_id=p_shift
    UNION
    SELECT elem->>'payment_method'
    FROM jsonb_array_elements(COALESCE(p_payment_rows,'[]'::jsonb)) elem
    WHERE elem->>'payment_method' IS NOT NULL
  LOOP
    SELECT COALESCE(confirmed_amount,0) INTO v_expected_method
    FROM canonical_shift_payment_totals
    WHERE shift_id=p_shift AND payment_method=v_method;
    SELECT COALESCE((elem->>'counted_amount')::numeric,0) INTO v_counted
    FROM jsonb_array_elements(COALESCE(p_payment_rows,'[]'::jsonb)) elem
    WHERE elem->>'payment_method'=v_method
    LIMIT 1;
    v_expected_method := COALESCE(v_expected_method,0);
    v_counted := COALESCE(v_counted,0);

    INSERT INTO shift_close_payment_counts(
      close_run_id,station_id,shift_id,payment_method,expected_amount,counted_amount
    ) VALUES(v_close_run.id,v_shift.station_id,p_shift,v_method,v_expected_method,v_counted);
  END LOOP;

  UPDATE operational_shifts SET
    status=v_status,
    closed_by=auth.uid(),
    closed_at=NOW(),
    variance_reason=p_variance_reason,
    variance_approved=(v_status='closed')
  WHERE id=p_shift;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_shift.station_id,auth.uid(),'shift.close','shift_close_run',v_close_run.id::text,to_jsonb(v_close_run));

  RETURN jsonb_build_object(
    'shift_id',p_shift,
    'close_run_id',v_close_run.id,
    'run_number',v_run_number,
    'status',v_status,
    'meter_expected_total',v_meter_expected_total,
    'canonical_sales_total',v_sales_total,
    'meter_variance',v_meter_variance,
    'payment_expected_total',v_payment_expected,
    'payment_counted_total',v_payment_counted,
    'payment_variance',v_payment_variance,
    'max_variance',v_max_variance
  );
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_approve_shift_variance(p_shift UUID,p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_shift operational_shifts; v_run shift_close_runs; v_approval shift_variance_approvals;
BEGIN
  SELECT * INTO v_shift FROM operational_shifts WHERE id=p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status<>'pending_approval' THEN RAISE EXCEPTION 'Shift does not require approval'; END IF;
  IF NOT fuelpro_has_permission(v_shift.station_id,'shift.approve') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason))<3 THEN RAISE EXCEPTION 'Approval reason is required'; END IF;

  SELECT * INTO v_run FROM shift_close_runs WHERE shift_id=p_shift ORDER BY run_number DESC LIMIT 1;
  IF NOT FOUND OR v_run.status<>'pending_approval' THEN RAISE EXCEPTION 'Pending close run not found'; END IF;

  INSERT INTO shift_variance_approvals(station_id,shift_id,close_run_id,reason,approved_by)
  VALUES(v_shift.station_id,p_shift,v_run.id,p_reason,auth.uid())
  RETURNING * INTO v_approval;

  UPDATE operational_shifts SET
    status='closed',variance_approved=TRUE,variance_reason=p_reason,
    approved_by=auth.uid(),approved_at=NOW()
  WHERE id=p_shift;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_shift.station_id,auth.uid(),'shift.variance.approve','shift_variance_approval',v_approval.id::text,to_jsonb(v_approval));

  RETURN jsonb_build_object('shift_id',p_shift,'status','closed','approval_id',v_approval.id,'close_run_id',v_run.id);
END;
$$;

CREATE OR REPLACE VIEW canonical_shift_close_summary AS
SELECT
  r.*,a.reason approval_reason,a.approved_by,a.approved_at
FROM shift_close_runs r
LEFT JOIN shift_variance_approvals a ON a.close_run_id=r.id;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('034_authoritative_shift_close','passed',jsonb_build_object('applied_at',NOW()));
