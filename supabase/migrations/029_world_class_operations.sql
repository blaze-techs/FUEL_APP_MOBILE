-- FuelPro World-Class Operations Foundation
-- Migration 029: immutable meter ledger, reconciliation, payments, inventory movements,
-- RBAC permissions, offline outbox and accounting-period locks.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS fuel_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel_type_id UUID REFERENCES fuel_types(id),
  fuel_code TEXT NOT NULL,
  price_per_liter NUMERIC(12,3) NOT NULL CHECK (price_per_liter >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  source TEXT,
  source_reference TEXT,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX IF NOT EXISTS fuel_price_history_station_time_idx
  ON fuel_price_history(station_id, fuel_code, valid_from DESC);

CREATE TABLE IF NOT EXISTS shift_pump_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
  pump_id UUID REFERENCES pumps(id) ON DELETE RESTRICT,
  fuel_type_id UUID REFERENCES fuel_types(id) ON DELETE RESTRICT,
  nozzle_code TEXT,
  opening_meter NUMERIC(14,3) NOT NULL CHECK (opening_meter >= 0),
  closing_meter NUMERIC(14,3) NOT NULL CHECK (closing_meter >= opening_meter),
  price_per_liter NUMERIC(12,3) NOT NULL CHECK (price_per_liter >= 0),
  litres_sold NUMERIC(14,3) GENERATED ALWAYS AS (closing_meter - opening_meter) STORED,
  expected_sales NUMERIC(16,2) GENERATED ALWAYS AS ((closing_meter - opening_meter) * price_per_liter) STORED,
  actual_sales NUMERIC(16,2),
  variance_amount NUMERIC(16,2),
  variance_litres NUMERIC(14,3),
  variance_reason TEXT,
  entered_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  reversal_of UUID REFERENCES shift_pump_readings(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_id, pump_id, nozzle_code),
  CHECK (actual_sales IS NULL OR actual_sales >= 0)
);
CREATE INDEX IF NOT EXISTS shift_pump_readings_station_shift_idx
  ON shift_pump_readings(station_id, shift_id);

CREATE TABLE IF NOT EXISTS tank_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  fuel_type_id UUID NOT NULL REFERENCES fuel_types(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','delivery','sale','adjustment','wastage','transfer_in','transfer_out','closing')),
  quantity_litres NUMERIC(14,3) NOT NULL CHECK (quantity_litres <> 0),
  reference_type TEXT,
  reference_id UUID,
  unit_cost NUMERIC(12,3) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tank_movements_station_fuel_time_idx
  ON tank_movements(station_id, fuel_type_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES sales(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  amount NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','failed','reversed','refunded')),
  customer_phone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_reference)
);
CREATE INDEX IF NOT EXISTS payment_transactions_station_time_idx
  ON payment_transactions(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  product_id UUID,
  fuel_type_id UUID REFERENCES fuel_types(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN
    ('purchase','sale','transfer_in','transfer_out','adjustment','wastage','count','return')),
  quantity NUMERIC(16,3) NOT NULL CHECK (quantity <> 0),
  unit_cost NUMERIC(14,3) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  reference_type TEXT,
  reference_id UUID,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS inventory_movements_station_time_idx
  ON inventory_movements(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID REFERENCES stations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  operation TEXT NOT NULL CHECK (operation IN ('create','update','delete','reversal')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','synced','failed','conflict')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sync_outbox_pending_idx
  ON sync_outbox(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS accounting_period_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  reason TEXT,
  locked_by UUID REFERENCES auth.users(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, period_start, period_end),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS fuelpro_role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY(role, permission)
);

INSERT INTO fuelpro_role_permissions(role, permission) VALUES
 ('owner','*'),('founder','*'),
 ('manager','station.read'),('manager','station.write'),('manager','shift.approve'),
 ('manager','sale.create'),('manager','sale.reverse'),('manager','inventory.write'),
 ('manager','payment.reconcile'),('manager','report.read'),
 ('supervisor','station.read'),('supervisor','shift.open'),('supervisor','shift.close'),
 ('supervisor','shift.approve'),('supervisor','sale.create'),('supervisor','inventory.write'),
 ('cashier','station.read'),('cashier','sale.create'),('cashier','payment.create'),
 ('attendant','station.read'),('attendant','shift.open'),('attendant','shift.close'),
 ('attendant','meter.reading'),('accountant','station.read'),('accountant','report.read'),
 ('accountant','payment.reconcile'),('auditor','station.read'),('auditor','report.read'),
 ('auditor','audit.read')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fuelpro_is_station_member(p_station_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM stations s WHERE s.id = p_station_id AND s.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.station_id = p_station_id AND tm.user_id = auth.uid() AND tm.is_active = true
  );
$$;

ALTER TABLE fuel_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_pump_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tank_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuelpro_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY fuel_price_history_station_access ON fuel_price_history FOR ALL
 USING (fuelpro_is_station_member(station_id))
 WITH CHECK (fuelpro_is_station_member(station_id));
CREATE POLICY shift_pump_readings_station_access ON shift_pump_readings FOR ALL
 USING (fuelpro_is_station_member(station_id))
 WITH CHECK (fuelpro_is_station_member(station_id));
CREATE POLICY tank_movements_station_access ON tank_movements FOR ALL
 USING (fuelpro_is_station_member(station_id))
 WITH CHECK (fuelpro_is_station_member(station_id));
CREATE POLICY payment_transactions_station_access ON payment_transactions FOR ALL
 USING (fuelpro_is_station_member(station_id))
 WITH CHECK (fuelpro_is_station_member(station_id));
CREATE POLICY inventory_movements_station_access ON inventory_movements FOR ALL
 USING (fuelpro_is_station_member(station_id))
 WITH CHECK (fuelpro_is_station_member(station_id));
CREATE POLICY sync_outbox_station_access ON sync_outbox FOR ALL
 USING (station_id IS NULL OR fuelpro_is_station_member(station_id))
 WITH CHECK (station_id IS NULL OR fuelpro_is_station_member(station_id));
CREATE POLICY accounting_period_locks_station_access ON accounting_period_locks FOR ALL
 USING (fuelpro_is_station_member(station_id))
 WITH CHECK (fuelpro_is_station_member(station_id));
CREATE POLICY fuelpro_roles_read ON fuelpro_role_permissions FOR SELECT
 USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION fuelpro_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS payment_transactions_updated_at ON payment_transactions;
CREATE TRIGGER payment_transactions_updated_at
BEFORE UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION fuelpro_set_updated_at();

-- Immutable ledgers: corrections are explicit reversal/new-entry operations.
CREATE OR REPLACE FUNCTION fuelpro_block_ledger_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable ledger: use a reversal/correction entry instead of %', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS shift_readings_immutable ON shift_pump_readings;
CREATE TRIGGER shift_readings_immutable
BEFORE UPDATE OR DELETE ON shift_pump_readings FOR EACH ROW
EXECUTE FUNCTION fuelpro_block_ledger_mutation();

DROP TRIGGER IF EXISTS tank_movements_immutable ON tank_movements;
CREATE TRIGGER tank_movements_immutable
BEFORE UPDATE OR DELETE ON tank_movements FOR EACH ROW
EXECUTE FUNCTION fuelpro_block_ledger_mutation();

DROP TRIGGER IF EXISTS inventory_movements_immutable ON inventory_movements;
CREATE TRIGGER inventory_movements_immutable
BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW
EXECUTE FUNCTION fuelpro_block_ledger_mutation();

-- Period lock guard for operational ledgers.
CREATE OR REPLACE FUNCTION fuelpro_period_is_locked(p_station UUID, p_when TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
 SELECT EXISTS (
   SELECT 1 FROM accounting_period_locks
   WHERE station_id = p_station
     AND p_when::date BETWEEN period_start AND period_end
 );
$$;

CREATE OR REPLACE FUNCTION fuelpro_guard_locked_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF fuelpro_period_is_locked(NEW.station_id, COALESCE(NEW.created_at, NOW())) THEN
    RAISE EXCEPTION 'Accounting period is locked for this station/date';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shift_readings_period_lock ON shift_pump_readings;
CREATE TRIGGER shift_readings_period_lock
BEFORE INSERT ON shift_pump_readings FOR EACH ROW EXECUTE FUNCTION fuelpro_guard_locked_insert();
DROP TRIGGER IF EXISTS tank_movements_period_lock ON tank_movements;
CREATE TRIGGER tank_movements_period_lock
BEFORE INSERT ON tank_movements FOR EACH ROW EXECUTE FUNCTION fuelpro_guard_locked_insert();
DROP TRIGGER IF EXISTS inventory_movements_period_lock ON inventory_movements;
CREATE TRIGGER inventory_movements_period_lock
BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION fuelpro_guard_locked_insert();

-- Server-side reconciliation helper. The app never needs to trust client math.
CREATE OR REPLACE FUNCTION fuelpro_reconcile_reading(
  p_reading_id UUID,
  p_actual_sales NUMERIC,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r shift_pump_readings;
BEGIN
  SELECT * INTO r FROM shift_pump_readings WHERE id = p_reading_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reading not found'; END IF;
  IF NOT fuelpro_is_station_member(r.station_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_actual_sales < 0 THEN RAISE EXCEPTION 'Actual sales cannot be negative'; END IF;

  RETURN jsonb_build_object(
    'reading_id', r.id,
    'litres_sold', r.litres_sold,
    'expected_sales', r.expected_sales,
    'actual_sales', p_actual_sales,
    'variance_amount', ROUND(p_actual_sales - r.expected_sales, 2),
    'variance_litres', ROUND((p_actual_sales / NULLIF(r.price_per_liter,0)) - r.litres_sold, 3),
    'variance_reason', p_reason
  );
END;
$$;
