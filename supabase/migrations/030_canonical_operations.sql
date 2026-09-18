-- FuelPro Canonical Operations
-- Migration 030: canonical shift/sales/payment/inventory/credit/audit ledgers,
-- station-scoped RBAC, anomaly detection, canonical reporting and DR metadata.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------
-- Station-scoped authorization
-- -----------------------------
CREATE TABLE IF NOT EXISTS station_role_assignments (
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','supervisor','cashier','attendant','accountant','auditor')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by UUID REFERENCES auth.users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(station_id, user_id)
);

CREATE INDEX IF NOT EXISTS station_role_assignments_user_idx
  ON station_role_assignments(user_id, is_active);

CREATE OR REPLACE FUNCTION fuelpro_user_role(p_station UUID, p_user UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT 'owner' FROM stations s WHERE s.id = p_station AND s.owner_id = p_user),
    (SELECT sra.role FROM station_role_assignments sra
      WHERE sra.station_id = p_station AND sra.user_id = p_user AND sra.is_active
      LIMIT 1),
    (SELECT tm.role FROM team_members tm
      WHERE tm.station_id = p_station AND tm.user_id = p_user AND tm.is_active
      LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION fuelpro_has_permission(
  p_station UUID,
  p_permission TEXT,
  p_user UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_global_role TEXT;
BEGIN
  IF p_user IS NULL THEN RETURN FALSE; END IF;

  SELECT role INTO v_global_role FROM users WHERE id = p_user LIMIT 1;
  IF v_global_role IN ('founder','admin') THEN RETURN TRUE; END IF;

  v_role := fuelpro_user_role(p_station, p_user);
  IF v_role IS NULL THEN RETURN FALSE; END IF;

  RETURN EXISTS (
    SELECT 1 FROM fuelpro_role_permissions rp
    WHERE rp.role = v_role AND (rp.permission = '*' OR rp.permission = p_permission)
  );
END;
$$;

INSERT INTO fuelpro_role_permissions(role, permission) VALUES
 ('owner','*'),
 ('manager','shift.open'),('manager','shift.close'),('manager','shift.approve'),
 ('manager','sale.create'),('manager','sale.reverse'),('manager','payment.create'),
 ('manager','payment.reconcile'),('manager','drawer.open'),('manager','drawer.close'),
 ('manager','purchase.create'),('manager','purchase.receive'),('manager','credit.manage'),
 ('manager','inventory.write'),('manager','report.read'),('manager','period.lock'),
 ('manager','audit.read'),
 ('supervisor','shift.open'),('supervisor','shift.close'),('supervisor','shift.approve'),
 ('supervisor','sale.create'),('supervisor','payment.create'),('supervisor','drawer.open'),
 ('supervisor','drawer.close'),('supervisor','inventory.write'),
 ('cashier','sale.create'),('cashier','payment.create'),('cashier','drawer.open'),('cashier','drawer.close'),
 ('attendant','shift.open'),('attendant','shift.close'),('attendant','meter.reading'),('attendant','sale.create'),
 ('accountant','report.read'),('accountant','payment.reconcile'),('accountant','period.lock'),
 ('accountant','credit.manage'),('accountant','purchase.receive'),
 ('auditor','report.read'),('auditor','audit.read')
ON CONFLICT DO NOTHING;

-- -----------------------------
-- Pump/nozzle mapping + history
-- -----------------------------
CREATE TABLE IF NOT EXISTS pump_nozzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  pump_id UUID NOT NULL REFERENCES pumps(id) ON DELETE CASCADE,
  fuel_type_id UUID NOT NULL REFERENCES fuel_types(id),
  nozzle_code TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at TIMESTAMPTZ,
  UNIQUE(station_id, pump_id, nozzle_code)
);

CREATE TABLE IF NOT EXISTS nozzle_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  nozzle_id UUID NOT NULL REFERENCES pump_nozzles(id) ON DELETE RESTRICT,
  price_per_liter NUMERIC(12,3) NOT NULL CHECK (price_per_liter >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  source TEXT,
  approved_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX IF NOT EXISTS nozzle_price_history_lookup_idx
  ON nozzle_price_history(nozzle_id, valid_from DESC);

-- -----------------------------
-- Canonical day/night shifts
-- -----------------------------
CREATE TABLE IF NOT EXISTS operational_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_type TEXT NOT NULL CHECK (shift_type IN ('day','night')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','pending_approval','closed','reopened','void')),
  opened_by UUID NOT NULL REFERENCES auth.users(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  variance_approved BOOLEAN NOT NULL DEFAULT FALSE,
  variance_reason TEXT,
  reopen_reason TEXT,
  previous_shift_id UUID REFERENCES operational_shifts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, shift_date, shift_type)
);
CREATE INDEX IF NOT EXISTS operational_shifts_station_date_idx
  ON operational_shifts(station_id, shift_date DESC, shift_type);

CREATE TABLE IF NOT EXISTS operational_shift_meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  nozzle_id UUID NOT NULL REFERENCES pump_nozzles(id) ON DELETE RESTRICT,
  opening_meter NUMERIC(16,3) NOT NULL CHECK (opening_meter >= 0),
  closing_meter NUMERIC(16,3) NOT NULL CHECK (closing_meter >= opening_meter),
  price_per_liter NUMERIC(12,3) NOT NULL CHECK (price_per_liter >= 0),
  litres_sold NUMERIC(16,3) GENERATED ALWAYS AS (closing_meter - opening_meter) STORED,
  expected_sales NUMERIC(18,2) GENERATED ALWAYS AS ((closing_meter - opening_meter) * price_per_liter) STORED,
  actual_sales NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (actual_sales >= 0),
  variance_amount NUMERIC(18,2) GENERATED ALWAYS AS (actual_sales - ((closing_meter - opening_meter) * price_per_liter)) STORED,
  entered_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_id, nozzle_id)
);
CREATE INDEX IF NOT EXISTS operational_shift_meters_continuity_idx
  ON operational_shift_meters(station_id, nozzle_id, created_at DESC);

-- -----------------------------
-- Canonical immutable sales
-- -----------------------------
CREATE TABLE IF NOT EXISTS sales_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  nozzle_id UUID REFERENCES pump_nozzles(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sale','reversal')),
  reversal_of UUID REFERENCES sales_ledger(id) ON DELETE RESTRICT,
  quantity_litres NUMERIC(16,3) NOT NULL CHECK (quantity_litres >= 0),
  unit_price NUMERIC(12,3) NOT NULL CHECK (unit_price >= 0),
  gross_amount NUMERIC(18,2) NOT NULL,
  tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(18,2) NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partial','paid','reversed')),
  customer_id UUID,
  fleet_vehicle_ref TEXT,
  receipt_number TEXT,
  external_reference TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (
    (entry_type = 'sale' AND reversal_of IS NULL AND gross_amount >= 0 AND net_amount >= 0)
    OR
    (entry_type = 'reversal' AND reversal_of IS NOT NULL AND gross_amount <= 0 AND net_amount <= 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_ledger_receipt_unique
  ON sales_ledger(station_id, receipt_number)
  WHERE receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_ledger_station_time_idx
  ON sales_ledger(station_id, created_at DESC);

-- -----------------------------
-- Payments / M-Pesa / cash drawer
-- -----------------------------
ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS checkout_request_id TEXT,
  ADD COLUMN IF NOT EXISTS merchant_request_id TEXT,
  ADD COLUMN IF NOT EXISTS mpesa_receipt TEXT,
  ADD COLUMN IF NOT EXISTS result_code TEXT,
  ADD COLUMN IF NOT EXISTS result_description TEXT,
  ADD COLUMN IF NOT EXISTS callback_payload JSONB,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS payment_checkout_unique
  ON payment_transactions(checkout_request_id)
  WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_mpesa_receipt_unique
  ON payment_transactions(mpesa_receipt)
  WHERE mpesa_receipt IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_drawers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  opened_by UUID NOT NULL REFERENCES auth.users(id),
  opening_cash NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by UUID REFERENCES auth.users(id),
  closed_at TIMESTAMPTZ,
  expected_cash NUMERIC(18,2),
  counted_cash NUMERIC(18,2),
  variance_amount NUMERIC(18,2),
  close_notes TEXT
);

CREATE TABLE IF NOT EXISTS cash_drawer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drawer_id UUID NOT NULL REFERENCES cash_drawers(id) ON DELETE RESTRICT,
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('sale','refund','cash_in','cash_out','correction')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount <> 0),
  reference_type TEXT,
  reference_id UUID,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shift_payment_reconciliation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES operational_shifts(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL,
  expected_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  counted_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  variance_amount NUMERIC(18,2) GENERATED ALWAYS AS (counted_amount - expected_amount) STORED,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shift_id, payment_method)
);

-- -----------------------------
-- Suppliers / POs / deliveries
-- -----------------------------
CREATE TABLE IF NOT EXISTS purchase_order_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  supplier_id UUID,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','part_received','received','cancelled')),
  currency TEXT NOT NULL DEFAULT 'KES',
  ordered_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, order_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_order_ledger(id) ON DELETE RESTRICT,
  product_id UUID,
  fuel_type_id UUID REFERENCES fuel_types(id),
  description TEXT NOT NULL,
  quantity NUMERIC(16,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,3) NOT NULL CHECK (unit_cost >= 0),
  received_quantity NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_order_ledger(id) ON DELETE RESTRICT,
  supplier_id UUID,
  delivery_note TEXT,
  tanker_registration TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_delivery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES supplier_deliveries(id) ON DELETE RESTRICT,
  fuel_type_id UUID REFERENCES fuel_types(id),
  product_id UUID,
  quantity NUMERIC(16,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,3) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  tank_movement_id UUID REFERENCES tank_movements(id),
  inventory_movement_id UUID REFERENCES inventory_movements(id)
);

-- -----------------------------
-- Customer / fleet credit
-- -----------------------------
CREATE TABLE IF NOT EXISTS credit_accounts_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  customer_id UUID,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'customer' CHECK (account_type IN ('customer','fleet')),
  external_ref TEXT,
  credit_limit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, external_ref)
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES credit_accounts_ledger(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('charge','payment','adjustment','reversal')),
  amount NUMERIC(18,2) NOT NULL CHECK (amount <> 0),
  sale_id UUID REFERENCES sales_ledger(id) ON DELETE RESTRICT,
  payment_id UUID REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  reversal_of UUID REFERENCES credit_ledger(id) ON DELETE RESTRICT,
  vehicle_ref TEXT,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS credit_ledger_account_time_idx
  ON credit_ledger(account_id, created_at DESC);

-- -----------------------------
-- Immutable audit / anomalies
-- -----------------------------
CREATE TABLE IF NOT EXISTS immutable_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  correlation_id TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS immutable_audit_station_time_idx
  ON immutable_audit_log(station_id, created_at DESC);

CREATE TABLE IF NOT EXISTS anomaly_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  anomaly_type TEXT NOT NULL CHECK (anomaly_type IN
   ('backwards_meter','continuity_break','large_variance','duplicate_transaction','suspicious_meter_jump','payment_mismatch')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','false_positive')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ
);

-- -----------------------------
-- eTIMS connector queue
-- -----------------------------
CREATE TABLE IF NOT EXISTS etims_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES sales_ledger(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN ('invoice','credit_note','debit_note')),
  local_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','accepted','rejected','retry')),
  kra_reference TEXT,
  request_payload JSONB NOT NULL,
  response_payload JSONB,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(station_id, local_reference)
);

-- -----------------------------
-- Monitoring / backup / DR
-- -----------------------------
CREATE TABLE IF NOT EXISTS system_health_metrics (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  unit TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warning','critical')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS system_health_metrics_time_idx
  ON system_health_metrics(recorded_at DESC);

CREATE TABLE IF NOT EXISTS backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  backup_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','completed','failed')),
  artifact_reference TEXT,
  checksum TEXT,
  size_bytes BIGINT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS restore_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_run_id UUID REFERENCES backup_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed')),
  checks JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS migration_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed','failed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------
-- Canonical report views
-- -----------------------------
CREATE OR REPLACE VIEW canonical_sales_effective AS
SELECT
  station_id,
  shift_id,
  created_at,
  SUM(quantity_litres) AS litres,
  SUM(gross_amount) AS gross_amount,
  SUM(tax_amount) AS tax_amount,
  SUM(net_amount) AS net_amount
FROM sales_ledger
GROUP BY station_id, shift_id, created_at;

CREATE OR REPLACE VIEW canonical_station_daily_summary AS
SELECT
  station_id,
  created_at::date AS business_date,
  SUM(quantity_litres) AS litres,
  SUM(gross_amount) AS gross_sales,
  SUM(tax_amount) AS tax_amount,
  SUM(net_amount) AS net_sales,
  COUNT(*) FILTER (WHERE entry_type='sale') AS sale_count,
  COUNT(*) FILTER (WHERE entry_type='reversal') AS reversal_count
FROM sales_ledger
GROUP BY station_id, created_at::date;

-- -----------------------------
-- Immutability
-- -----------------------------
CREATE OR REPLACE FUNCTION fuelpro_block_update_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; post a reversal/correction entry instead', TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'operational_shift_meters','sales_ledger','cash_drawer_events',
    'credit_ledger','immutable_audit_log'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fuelpro_block_update_delete()',
      t, t
    );
  END LOOP;
END $$;

-- -----------------------------
-- Shift lifecycle RPCs
-- -----------------------------
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

  SELECT id INTO v_prev
  FROM operational_shifts
  WHERE station_id=p_station AND status IN ('closed','reopened')
  ORDER BY COALESCE(closed_at, opened_at) DESC
  LIMIT 1;

  INSERT INTO operational_shifts(station_id,shift_date,shift_type,opened_by,previous_shift_id)
  VALUES(p_station,p_shift_date,p_shift_type,auth.uid(),v_prev)
  RETURNING * INTO v_shift;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_station,auth.uid(),'shift.open','operational_shift',v_shift.id::text,to_jsonb(v_shift));

  RETURN v_shift;
END;
$$;

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
  v_prev_close NUMERIC;
  v_open NUMERIC;
  v_close NUMERIC;
  v_nozzle UUID;
  v_price NUMERIC;
  v_actual NUMERIC;
  v_variance NUMERIC := 0;
  v_max_variance NUMERIC := 0;
BEGIN
  SELECT * INTO v_shift FROM operational_shifts WHERE id=p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status NOT IN ('open','reopened') THEN RAISE EXCEPTION 'Shift is not open'; END IF;
  IF NOT fuelpro_has_permission(v_shift.station_id,'shift.close') THEN RAISE EXCEPTION 'Not authorized to close shift'; END IF;
  IF fuelpro_period_is_locked(v_shift.station_id, now()) THEN RAISE EXCEPTION 'Accounting period is locked'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_meter_rows)
  LOOP
    v_nozzle := (v_row->>'nozzle_id')::uuid;
    v_open := (v_row->>'opening_meter')::numeric;
    v_close := (v_row->>'closing_meter')::numeric;
    v_price := (v_row->>'price_per_liter')::numeric;
    v_actual := COALESCE((v_row->>'actual_sales')::numeric,0);

    IF v_close < v_open THEN
      INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
      VALUES(v_shift.station_id,'backwards_meter','critical','operational_shift',p_shift::text,v_row);
      RAISE EXCEPTION 'Closing meter cannot be below opening meter';
    END IF;

    SELECT osm.closing_meter INTO v_prev_close
    FROM operational_shift_meters osm
    JOIN operational_shifts os ON os.id=osm.shift_id
    WHERE osm.station_id=v_shift.station_id AND osm.nozzle_id=v_nozzle
    ORDER BY os.closed_at DESC NULLS LAST, osm.created_at DESC
    LIMIT 1;

    IF v_prev_close IS NOT NULL AND ABS(v_open-v_prev_close) > 0.001 THEN
      INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
      VALUES(v_shift.station_id,'continuity_break','high','operational_shift',p_shift::text,
        jsonb_build_object('nozzle_id',v_nozzle,'expected_opening',v_prev_close,'actual_opening',v_open));
      RAISE EXCEPTION 'Pump meter continuity failure for nozzle %: expected %, got %', v_nozzle, v_prev_close, v_open;
    END IF;

    IF v_close - v_open > 100000 THEN
      INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
      VALUES(v_shift.station_id,'suspicious_meter_jump','high','operational_shift',p_shift::text,v_row);
    END IF;

    INSERT INTO operational_shift_meters(
      station_id,shift_id,nozzle_id,opening_meter,closing_meter,price_per_liter,actual_sales,entered_by
    ) VALUES(
      v_shift.station_id,p_shift,v_nozzle,v_open,v_close,v_price,v_actual,auth.uid()
    );

    v_variance := v_actual - ((v_close-v_open)*v_price);
    v_max_variance := GREATEST(v_max_variance, ABS(v_variance));

    IF ABS(v_variance) > GREATEST(100, ((v_close-v_open)*v_price)*0.005) THEN
      INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
      VALUES(v_shift.station_id,'large_variance',
        CASE WHEN ABS(v_variance)>5000 THEN 'critical' ELSE 'high' END,
        'operational_shift',p_shift::text,
        jsonb_build_object('nozzle_id',v_nozzle,'variance',v_variance));
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payment_rows)
  LOOP
    INSERT INTO shift_payment_reconciliation(
      station_id,shift_id,payment_method,expected_amount,counted_amount,notes
    ) VALUES(
      v_shift.station_id,p_shift,v_row->>'payment_method',
      COALESCE((v_row->>'expected_amount')::numeric,0),
      COALESCE((v_row->>'counted_amount')::numeric,0),
      v_row->>'notes'
    )
    ON CONFLICT(shift_id,payment_method) DO NOTHING;
  END LOOP;

  UPDATE operational_shifts SET
    status = CASE WHEN v_max_variance > 100 THEN 'pending_approval' ELSE 'closed' END,
    closed_by = auth.uid(),
    closed_at = NOW(),
    variance_reason = p_variance_reason,
    variance_approved = (v_max_variance <= 100)
  WHERE id=p_shift;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_shift.station_id,auth.uid(),'shift.close','operational_shift',p_shift::text,
    jsonb_build_object('max_variance',v_max_variance));

  RETURN jsonb_build_object(
    'shift_id',p_shift,
    'status',CASE WHEN v_max_variance > 100 THEN 'pending_approval' ELSE 'closed' END,
    'max_variance',v_max_variance
  );
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_approve_shift_variance(p_shift UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_shift operational_shifts;
BEGIN
  SELECT * INTO v_shift FROM operational_shifts WHERE id=p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF v_shift.status <> 'pending_approval' THEN RAISE EXCEPTION 'Shift does not require approval'; END IF;
  IF NOT fuelpro_has_permission(v_shift.station_id,'shift.approve') THEN RAISE EXCEPTION 'Not authorized'; END IF;

  UPDATE operational_shifts SET
    status='closed', variance_approved=TRUE, variance_reason=p_reason,
    approved_by=auth.uid(), approved_at=NOW()
  WHERE id=p_shift;

  UPDATE shift_payment_reconciliation SET approved_by=auth.uid(), approved_at=NOW()
  WHERE shift_id=p_shift AND ABS(variance_amount) > 0;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_shift.station_id,auth.uid(),'shift.variance.approve','operational_shift',p_shift::text,
    jsonb_build_object('reason',p_reason));

  RETURN jsonb_build_object('shift_id',p_shift,'status','closed');
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_reopen_shift(p_shift UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_shift operational_shifts;
BEGIN
  SELECT * INTO v_shift FROM operational_shifts WHERE id=p_shift FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift not found'; END IF;
  IF NOT fuelpro_has_permission(v_shift.station_id,'shift.approve') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF fuelpro_period_is_locked(v_shift.station_id, COALESCE(v_shift.closed_at,v_shift.opened_at)) THEN
    RAISE EXCEPTION 'Accounting period is locked';
  END IF;
  UPDATE operational_shifts SET status='reopened', reopen_reason=p_reason WHERE id=p_shift;
  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_shift.station_id,auth.uid(),'shift.reopen','operational_shift',p_shift::text,jsonb_build_object('reason',p_reason));
  RETURN jsonb_build_object('shift_id',p_shift,'status','reopened');
END;
$$;

-- -----------------------------
-- Sales posting / reversal
-- -----------------------------
CREATE OR REPLACE FUNCTION fuelpro_post_sale(
  p_station UUID,
  p_shift UUID,
  p_nozzle UUID,
  p_litres NUMERIC,
  p_unit_price NUMERIC,
  p_tax NUMERIC,
  p_payment_status TEXT,
  p_customer UUID,
  p_vehicle TEXT,
  p_receipt TEXT,
  p_external_ref TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS sales_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sale sales_ledger;
DECLARE v_gross NUMERIC;
DECLARE v_net NUMERIC;
BEGIN
  IF NOT fuelpro_has_permission(p_station,'sale.create') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF fuelpro_period_is_locked(p_station,NOW()) THEN RAISE EXCEPTION 'Accounting period is locked'; END IF;
  IF p_litres < 0 OR p_unit_price < 0 OR p_tax < 0 THEN RAISE EXCEPTION 'Invalid sale values'; END IF;
  v_gross := ROUND(p_litres*p_unit_price,2);
  v_net := ROUND(v_gross-p_tax,2);
  IF v_net < 0 THEN RAISE EXCEPTION 'Tax cannot exceed gross amount'; END IF;

  INSERT INTO sales_ledger(
    station_id,shift_id,nozzle_id,entry_type,quantity_litres,unit_price,
    gross_amount,tax_amount,net_amount,payment_status,customer_id,fleet_vehicle_ref,
    receipt_number,external_reference,idempotency_key,created_by,metadata
  ) VALUES(
    p_station,p_shift,p_nozzle,'sale',p_litres,p_unit_price,v_gross,p_tax,v_net,
    COALESCE(p_payment_status,'unpaid'),p_customer,p_vehicle,p_receipt,p_external_ref,
    p_idempotency_key,auth.uid(),COALESCE(p_metadata,'{}'::jsonb)
  )
  ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
  RETURNING * INTO v_sale;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(p_station,auth.uid(),'sale.post','sales_ledger',v_sale.id::text,to_jsonb(v_sale));

  RETURN v_sale;
END;
$$;

CREATE OR REPLACE FUNCTION fuelpro_reverse_sale(p_sale UUID, p_reason TEXT, p_idempotency_key TEXT)
RETURNS sales_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_original sales_ledger;
DECLARE v_rev sales_ledger;
BEGIN
  SELECT * INTO v_original FROM sales_ledger WHERE id=p_sale AND entry_type='sale';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF NOT fuelpro_has_permission(v_original.station_id,'sale.reverse') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF fuelpro_period_is_locked(v_original.station_id,v_original.created_at) THEN RAISE EXCEPTION 'Accounting period is locked'; END IF;
  IF EXISTS(SELECT 1 FROM sales_ledger WHERE reversal_of=p_sale) THEN RAISE EXCEPTION 'Sale already reversed'; END IF;

  INSERT INTO sales_ledger(
    station_id,shift_id,nozzle_id,entry_type,reversal_of,quantity_litres,unit_price,
    gross_amount,tax_amount,net_amount,payment_status,customer_id,fleet_vehicle_ref,
    receipt_number,external_reference,idempotency_key,created_by,metadata
  ) VALUES(
    v_original.station_id,v_original.shift_id,v_original.nozzle_id,'reversal',v_original.id,
    v_original.quantity_litres,v_original.unit_price,-v_original.gross_amount,
    -v_original.tax_amount,-v_original.net_amount,'reversed',v_original.customer_id,
    v_original.fleet_vehicle_ref,NULL,v_original.external_reference,p_idempotency_key,
    auth.uid(),jsonb_build_object('reason',p_reason)
  ) RETURNING * INTO v_rev;

  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,new_values)
  VALUES(v_original.station_id,auth.uid(),'sale.reverse','sales_ledger',v_rev.id::text,to_jsonb(v_rev));

  RETURN v_rev;
END;
$$;

-- -----------------------------
-- Automatic anomaly triggers
-- -----------------------------
CREATE OR REPLACE FUNCTION fuelpro_detect_duplicate_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider_reference IS NOT NULL AND EXISTS(
    SELECT 1 FROM payment_transactions
    WHERE provider=NEW.provider AND provider_reference=NEW.provider_reference
      AND id<>NEW.id
  ) THEN
    INSERT INTO anomaly_events(station_id,anomaly_type,severity,entity_type,entity_id,details)
    VALUES(NEW.station_id,'duplicate_transaction','critical','payment_transaction',NEW.id::text,
      jsonb_build_object('provider',NEW.provider,'reference',NEW.provider_reference));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_duplicate_detector ON payment_transactions;
CREATE TRIGGER payment_duplicate_detector
AFTER INSERT ON payment_transactions
FOR EACH ROW EXECUTE FUNCTION fuelpro_detect_duplicate_payment();

-- -----------------------------
-- RLS
-- -----------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'station_role_assignments','pump_nozzles','nozzle_price_history','operational_shifts',
    'operational_shift_meters','sales_ledger','cash_drawers','cash_drawer_events',
    'shift_payment_reconciliation','purchase_order_ledger','purchase_order_items_ledger',
    'supplier_deliveries','supplier_delivery_items','credit_accounts_ledger','credit_ledger',
    'immutable_audit_log','anomaly_events','etims_documents'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;

CREATE POLICY station_roles_scope ON station_role_assignments FOR ALL
 USING (fuelpro_has_permission(station_id,'station.write') OR fuelpro_user_role(station_id)=role OR fuelpro_user_role(station_id)='owner')
 WITH CHECK (fuelpro_has_permission(station_id,'station.write') OR fuelpro_user_role(station_id)='owner');

CREATE POLICY pump_nozzles_scope ON pump_nozzles FOR ALL
 USING (fuelpro_user_role(station_id) IS NOT NULL)
 WITH CHECK (fuelpro_has_permission(station_id,'station.write'));
CREATE POLICY nozzle_prices_scope ON nozzle_price_history FOR ALL
 USING (fuelpro_user_role(station_id) IS NOT NULL)
 WITH CHECK (fuelpro_has_permission(station_id,'station.write'));
CREATE POLICY shifts_scope ON operational_shifts FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY shifts_insert_scope ON operational_shifts FOR INSERT
 WITH CHECK (fuelpro_has_permission(station_id,'shift.open'));
CREATE POLICY meters_scope ON operational_shift_meters FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY sales_scope ON sales_ledger FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY payments_scope ON payment_transactions FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY cash_drawers_scope ON cash_drawers FOR ALL
 USING (fuelpro_user_role(station_id) IS NOT NULL)
 WITH CHECK (fuelpro_has_permission(station_id,'drawer.open'));
CREATE POLICY cash_events_scope ON cash_drawer_events FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY shift_recon_scope ON shift_payment_reconciliation FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY po_scope ON purchase_order_ledger FOR ALL
 USING (fuelpro_user_role(station_id) IS NOT NULL)
 WITH CHECK (fuelpro_has_permission(station_id,'purchase.create'));
CREATE POLICY delivery_scope ON supplier_deliveries FOR ALL
 USING (fuelpro_user_role(station_id) IS NOT NULL)
 WITH CHECK (fuelpro_has_permission(station_id,'purchase.receive'));
CREATE POLICY credit_accounts_scope ON credit_accounts_ledger FOR ALL
 USING (fuelpro_user_role(station_id) IS NOT NULL)
 WITH CHECK (fuelpro_has_permission(station_id,'credit.manage'));
CREATE POLICY credit_ledger_scope ON credit_ledger FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY immutable_audit_scope ON immutable_audit_log FOR SELECT
 USING (station_id IS NULL OR fuelpro_has_permission(station_id,'audit.read'));
CREATE POLICY anomaly_scope ON anomaly_events FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY etims_scope ON etims_documents FOR SELECT
 USING (fuelpro_has_permission(station_id,'report.read'));

-- Server-only monitoring tables are intentionally not exposed by RLS policies.
ALTER TABLE system_health_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE restore_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_verifications ENABLE ROW LEVEL SECURITY;

-- Record migration verification marker.
INSERT INTO migration_verifications(migration_name,status,details)
VALUES('030_canonical_operations','passed',jsonb_build_object('applied_at',NOW()));
