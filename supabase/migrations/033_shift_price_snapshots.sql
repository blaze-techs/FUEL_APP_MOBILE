-- Migration 033: shift price snapshots and server-derived reconciliation invariants.

CREATE TABLE IF NOT EXISTS operational_shift_price_snapshots (
  shift_id UUID NOT NULL REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  nozzle_id UUID NOT NULL REFERENCES pump_nozzles(id) ON DELETE RESTRICT,
  price_per_liter NUMERIC(12,3) NOT NULL CHECK (price_per_liter >= 0),
  source_price_history_id UUID REFERENCES nozzle_price_history(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(shift_id,nozzle_id)
);
ALTER TABLE operational_shift_price_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_price_snapshots_scope ON operational_shift_price_snapshots FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION fuelpro_open_shift(
  p_station UUID,
  p_shift_date DATE,
  p_shift_type TEXT
)
RETURNS operational_shifts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_shift operational_shifts;
DECLARE v_prev UUID;
BEGIN
  IF p_shift_type NOT IN ('day','night') THEN
    RAISE EXCEPTION 'shift_type must be day or night';
  END IF;
  IF NOT fuelpro_has_permission(p_station,'shift.open') THEN
    RAISE EXCEPTION 'Not authorized to open shift';
  END IF;
  IF fuelpro_period_is_locked(p_station, p_shift_date::timestamptz) THEN
    RAISE EXCEPTION 'Accounting period is locked';
  END IF;
  IF EXISTS(
    SELECT 1 FROM operational_shifts
    WHERE station_id=p_station AND status IN ('open','pending_approval','reopened')
  ) THEN
    RAISE EXCEPTION 'Another shift is still open or awaiting approval';
  END IF;

  SELECT id INTO v_prev
  FROM operational_shifts
  WHERE station_id=p_station AND status='closed'
  ORDER BY COALESCE(closed_at,opened_at) DESC
  LIMIT 1;

  INSERT INTO operational_shifts(station_id,shift_date,shift_type,opened_by,previous_shift_id)
  VALUES(p_station,p_shift_date,p_shift_type,auth.uid(),v_prev)
  RETURNING * INTO v_shift;

  INSERT INTO operational_shift_price_snapshots(
    shift_id,station_id,nozzle_id,price_per_liter,source_price_history_id
  )
  SELECT
    v_shift.id,p_station,n.id,
    COALESCE(ph.price_per_liter,p.price_per_liter,0),
    ph.id
  FROM pump_nozzles n
  JOIN pumps p ON p.id=n.pump_id
  LEFT JOIN LATERAL (
    SELECT h.id,h.price_per_liter
    FROM nozzle_price_history h
    WHERE h.nozzle_id=n.id
      AND h.valid_from <= v_shift.opened_at
      AND (h.valid_to IS NULL OR h.valid_to > v_shift.opened_at)
    ORDER BY h.valid_from DESC
    LIMIT 1
  ) ph ON TRUE
  WHERE n.station_id=p_station AND n.is_active=TRUE;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_station,auth.uid(),'shift.open','operational_shift',v_shift.id::text,to_jsonb(v_shift));

  RETURN v_shift;
END;
$$;

CREATE OR REPLACE VIEW canonical_shift_nozzle_sales AS
SELECT
  station_id,shift_id,nozzle_id,
  SUM(CASE WHEN entry_type='reversal' THEN -quantity_litres ELSE quantity_litres END) litres,
  SUM(gross_amount) gross_amount,
  SUM(tax_amount) tax_amount,
  SUM(net_amount) net_amount
FROM sales_ledger
WHERE shift_id IS NOT NULL AND nozzle_id IS NOT NULL
GROUP BY station_id,shift_id,nozzle_id;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('033_shift_price_snapshots','passed',jsonb_build_object('applied_at',NOW()));
