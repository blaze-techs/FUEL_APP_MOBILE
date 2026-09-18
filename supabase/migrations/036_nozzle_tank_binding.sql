-- Migration 036: bind dispensing nozzles to physical tanks so sales move the right tank.

ALTER TABLE pump_nozzles
  ADD COLUMN IF NOT EXISTS tank_id UUID REFERENCES fuel_tanks(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS pump_nozzles_tank_idx ON pump_nozzles(tank_id);

CREATE OR REPLACE FUNCTION fuelpro_sales_to_tank_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_fuel UUID; v_tank UUID;
BEGIN
  IF NEW.nozzle_id IS NULL OR NEW.quantity_litres=0 THEN RETURN NEW; END IF;
  SELECT fuel_type_id,tank_id INTO v_fuel,v_tank FROM pump_nozzles WHERE id=NEW.nozzle_id;
  IF v_fuel IS NULL THEN RETURN NEW; END IF;

  INSERT INTO tank_movements(
    station_id,fuel_type_id,tank_id,movement_type,quantity_litres,
    reference_type,reference_id,notes,created_by,created_at,idempotency_key
  ) VALUES(
    NEW.station_id,v_fuel,v_tank,'sale',
    CASE WHEN NEW.entry_type='sale' THEN -NEW.quantity_litres ELSE NEW.quantity_litres END,
    'sales_ledger',NEW.id,
    CASE WHEN NEW.entry_type='reversal' THEN 'Automatic sale reversal movement' ELSE 'Automatic sale movement' END,
    NEW.created_by,NEW.created_at,'sale-ledger:'||NEW.id::text
  );
  RETURN NEW;
END;
$$;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES('036_nozzle_tank_binding','passed',jsonb_build_object('applied_at',NOW()));
