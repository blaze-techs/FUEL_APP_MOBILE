-- Migration 031: automatic canonical side-effects, sync versioning and audit capture.

CREATE TABLE IF NOT EXISTS sync_entity_versions (
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  payload_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(station_id,entity_type,entity_id)
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  outbox_id UUID REFERENCES sync_outbox(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  client_version BIGINT,
  server_version BIGINT,
  client_payload JSONB,
  server_payload JSONB,
  resolution TEXT CHECK (resolution IN ('server_wins','client_wins','merged','manual')),
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sync_outbox ADD COLUMN IF NOT EXISTS base_version BIGINT;
ALTER TABLE sync_outbox ADD COLUMN IF NOT EXISTS resulting_version BIGINT;
ALTER TABLE sync_outbox ADD COLUMN IF NOT EXISTS conflict_id UUID REFERENCES sync_conflicts(id);
ALTER TABLE sync_entity_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_versions_scope ON sync_entity_versions FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY sync_conflicts_scope ON sync_conflicts FOR SELECT
 USING (fuelpro_user_role(station_id) IS NOT NULL);

-- Automatically mirror immutable fuel sales into tank movements.
CREATE OR REPLACE FUNCTION fuelpro_sales_to_tank_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_fuel UUID;
BEGIN
  IF NEW.nozzle_id IS NULL OR NEW.quantity_litres=0 THEN RETURN NEW; END IF;
  SELECT fuel_type_id INTO v_fuel FROM pump_nozzles WHERE id=NEW.nozzle_id;
  IF v_fuel IS NULL THEN RETURN NEW; END IF;
  INSERT INTO tank_movements(
    station_id,fuel_type_id,movement_type,quantity_litres,reference_type,reference_id,notes,created_by,created_at
  ) VALUES(
    NEW.station_id,v_fuel,'sale',
    CASE WHEN NEW.entry_type='sale' THEN -NEW.quantity_litres ELSE NEW.quantity_litres END,
    'sales_ledger',NEW.id,
    CASE WHEN NEW.entry_type='reversal' THEN 'Automatic sale reversal movement' ELSE 'Automatic sale movement' END,
    NEW.created_by,NEW.created_at
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sales_ledger_tank_movement ON sales_ledger;
CREATE TRIGGER sales_ledger_tank_movement
AFTER INSERT ON sales_ledger FOR EACH ROW EXECUTE FUNCTION fuelpro_sales_to_tank_movement();

-- Generic immutable audit capture for selected mutable control tables.
CREATE OR REPLACE FUNCTION fuelpro_audit_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid UUID; eid TEXT;
BEGIN
  sid := COALESCE((to_jsonb(NEW)->>'station_id')::uuid,(to_jsonb(OLD)->>'station_id')::uuid);
  eid := COALESCE(to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id');
  INSERT INTO immutable_audit_log(station_id,user_id,action,entity_type,entity_id,old_values,new_values)
  VALUES(sid,auth.uid(),lower(TG_OP),TG_TABLE_NAME,eid,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END);
  RETURN COALESCE(NEW,OLD);
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'operational_shifts','payment_transactions','cash_drawers','shift_payment_reconciliation',
    'purchase_order_ledger','supplier_deliveries','credit_accounts_ledger','anomaly_events',
    'etims_documents','station_role_assignments','pump_nozzles','nozzle_price_history'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON %I',t,t);
    EXECUTE format('CREATE TRIGGER %I_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION fuelpro_audit_change()',t,t);
  END LOOP;
END $$;

-- Canonical payment and credit summaries for reporting.
CREATE OR REPLACE VIEW canonical_payment_daily_summary AS
SELECT station_id,created_at::date business_date,payment_method,status,
       COUNT(*) transaction_count,SUM(amount) amount
FROM payment_transactions
GROUP BY station_id,created_at::date,payment_method,status;

CREATE OR REPLACE VIEW canonical_credit_balances AS
SELECT a.id account_id,a.station_id,a.account_name,a.account_type,a.credit_limit,a.status,
       COALESCE(SUM(l.amount),0) balance
FROM credit_accounts_ledger a
LEFT JOIN credit_ledger l ON l.account_id=a.id
GROUP BY a.id,a.station_id,a.account_name,a.account_type,a.credit_limit,a.status;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('031_sync_side_effects_audit','passed',jsonb_build_object('applied_at',NOW()));
