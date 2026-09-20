-- Migration 032: canonical payment linkage, explicit tank registry and full movement automation.

CREATE TABLE IF NOT EXISTS fuel_tanks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel_type_id UUID NOT NULL REFERENCES fuel_types(id),
  tank_code TEXT NOT NULL,
  name TEXT,
  capacity_litres NUMERIC(16,3) NOT NULL CHECK (capacity_litres > 0),
  safe_fill_litres NUMERIC(16,3),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id,tank_code),
  CHECK (safe_fill_litres IS NULL OR safe_fill_litres <= capacity_litres)
);

ALTER TABLE tank_movements
  ADD COLUMN IF NOT EXISTS tank_id UUID REFERENCES fuel_tanks(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS counterparty_tank_id UUID REFERENCES fuel_tanks(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tank_movements_idempotency_unique
  ON tank_movements(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS ledger_sale_id UUID REFERENCES sales_ledger(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payment_transactions_idempotency_unique
  ON payment_transactions(station_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE fuel_tanks ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuel_tanks_scope ON fuel_tanks FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY fuel_tanks_write_scope ON fuel_tanks FOR INSERT
 WITH CHECK (fuelpro_has_permission(station_id,'inventory.write'));
CREATE POLICY fuel_tanks_update_scope ON fuel_tanks FOR UPDATE
 USING (fuelpro_has_permission(station_id,'inventory.write'))
 WITH CHECK (fuelpro_has_permission(station_id,'inventory.write'));

-- Full movement posting helper. Transfers are two immutable entries in one transaction.
CREATE OR REPLACE FUNCTION fuelpro_post_tank_movement(
  p_station UUID,
  p_tank UUID,
  p_fuel UUID,
  p_type TEXT,
  p_quantity NUMERIC,
  p_counterparty UUID DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_primary tank_movements; v_counter tank_movements;
BEGIN
  IF NOT fuelpro_has_permission(p_station,'inventory.write') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be positive'; END IF;
  IF p_type NOT IN ('delivery','sale','adjustment','wastage','transfer','opening','closing') THEN
    RAISE EXCEPTION 'Unsupported tank movement type';
  END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_primary FROM tank_movements WHERE idempotency_key=p_idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('movement',to_jsonb(v_primary),'duplicate',true); END IF;
  END IF;

  IF p_type='transfer' THEN
    IF p_counterparty IS NULL THEN RAISE EXCEPTION 'Counterparty tank required for transfer'; END IF;
    INSERT INTO tank_movements(
      station_id,fuel_type_id,tank_id,counterparty_tank_id,movement_type,quantity_litres,
      reference_type,reference_id,unit_cost,notes,created_by,idempotency_key
    ) VALUES(
      p_station,p_fuel,p_tank,p_counterparty,'transfer_out',-p_quantity,
      p_reference_type,p_reference_id,p_unit_cost,p_notes,auth.uid(),
      CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key||':out' END
    ) RETURNING * INTO v_primary;
    INSERT INTO tank_movements(
      station_id,fuel_type_id,tank_id,counterparty_tank_id,movement_type,quantity_litres,
      reference_type,reference_id,unit_cost,notes,created_by,idempotency_key
    ) VALUES(
      p_station,p_fuel,p_counterparty,p_tank,'transfer_in',p_quantity,
      p_reference_type,p_reference_id,p_unit_cost,p_notes,auth.uid(),
      CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key||':in' END
    ) RETURNING * INTO v_counter;
    RETURN jsonb_build_object('movement',to_jsonb(v_primary),'counter_movement',to_jsonb(v_counter),'duplicate',false);
  END IF;

  INSERT INTO tank_movements(
    station_id,fuel_type_id,tank_id,movement_type,quantity_litres,
    reference_type,reference_id,unit_cost,notes,created_by,idempotency_key
  ) VALUES(
    p_station,p_fuel,p_tank,
    CASE p_type
      WHEN 'delivery' THEN 'delivery'
      WHEN 'sale' THEN 'sale'
      WHEN 'wastage' THEN 'wastage'
      WHEN 'adjustment' THEN 'adjustment'
      WHEN 'opening' THEN 'opening'
      WHEN 'closing' THEN 'closing'
    END,
    CASE WHEN p_type IN ('sale','wastage') THEN -p_quantity ELSE p_quantity END,
    p_reference_type,p_reference_id,p_unit_cost,p_notes,auth.uid(),p_idempotency_key
  ) RETURNING * INTO v_primary;
  RETURN jsonb_build_object('movement',to_jsonb(v_primary),'duplicate',false);
END;
$$;

-- Current book balance by tank, always derived from immutable movements.
CREATE OR REPLACE VIEW canonical_tank_balances AS
SELECT
  t.id tank_id,t.station_id,t.fuel_type_id,t.tank_code,t.name,t.capacity_litres,
  COALESCE(SUM(m.quantity_litres),0) book_litres,
  t.capacity_litres-COALESCE(SUM(m.quantity_litres),0) ullage_litres
FROM fuel_tanks t
LEFT JOIN tank_movements m ON m.tank_id=t.id
GROUP BY t.id,t.station_id,t.fuel_type_id,t.tank_code,t.name,t.capacity_litres;

-- Payment status is derived; sales ledger remains immutable.
CREATE OR REPLACE VIEW canonical_sale_payment_status AS
SELECT
  s.id sale_id,s.station_id,s.shift_id,s.gross_amount,
  COALESCE(SUM(CASE WHEN p.status='confirmed' THEN p.amount ELSE 0 END),0) paid_amount,
  CASE
    WHEN s.entry_type='reversal' THEN 'reversed'
    WHEN COALESCE(SUM(CASE WHEN p.status='confirmed' THEN p.amount ELSE 0 END),0) <= 0 THEN 'unpaid'
    WHEN COALESCE(SUM(CASE WHEN p.status='confirmed' THEN p.amount ELSE 0 END),0) < s.gross_amount THEN 'partial'
    ELSE 'paid'
  END derived_payment_status
FROM sales_ledger s
LEFT JOIN payment_transactions p ON p.ledger_sale_id=s.id
GROUP BY s.id,s.station_id,s.shift_id,s.gross_amount,s.entry_type;

-- Shift reconciliation expected amounts derive from canonical payments.
CREATE OR REPLACE VIEW canonical_shift_payment_totals AS
SELECT
  s.station_id,s.shift_id,p.payment_method,
  SUM(CASE WHEN p.status='confirmed' THEN p.amount ELSE 0 END) confirmed_amount,
  COUNT(*) FILTER (WHERE p.status='pending') pending_count
FROM payment_transactions p
JOIN sales_ledger s ON s.id=p.ledger_sale_id
WHERE s.shift_id IS NOT NULL
GROUP BY s.station_id,s.shift_id,p.payment_method;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('032_payment_tanks','passed',jsonb_build_object('applied_at',NOW()));
