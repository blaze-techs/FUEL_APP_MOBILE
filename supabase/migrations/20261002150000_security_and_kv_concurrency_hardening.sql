-- Security and concurrency hardening applied 2026-10-02.
-- Keep this migration in source control so the database and repository remain auditable.

BEGIN;

-- Profiles previously had a public SELECT policy. The table contains MFA secrets
-- and recovery codes, so client-readable access is restricted to the account owner.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
DROP POLICY IF EXISTS profiles_public_read ON public.profiles;
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Replace station-membership-wide write access with least-privilege permissions.
DROP POLICY IF EXISTS accounting_period_locks_station_access ON public.accounting_period_locks;
CREATE POLICY accounting_period_locks_read ON public.accounting_period_locks
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY accounting_period_locks_write ON public.accounting_period_locks
  FOR INSERT TO authenticated WITH CHECK (fuelpro_has_permission(station_id, 'period.lock'));
CREATE POLICY accounting_period_locks_update ON public.accounting_period_locks
  FOR UPDATE TO authenticated
  USING (fuelpro_has_permission(station_id, 'period.lock'))
  WITH CHECK (fuelpro_has_permission(station_id, 'period.lock'));
CREATE POLICY accounting_period_locks_delete ON public.accounting_period_locks
  FOR DELETE TO authenticated USING (fuelpro_has_permission(station_id, 'period.lock'));

DROP POLICY IF EXISTS fuel_price_history_station_access ON public.fuel_price_history;
CREATE POLICY fuel_price_history_read ON public.fuel_price_history
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY fuel_price_history_write ON public.fuel_price_history
  FOR INSERT TO authenticated WITH CHECK (fuelpro_has_permission(station_id, 'station.write'));
CREATE POLICY fuel_price_history_update ON public.fuel_price_history
  FOR UPDATE TO authenticated
  USING (fuelpro_has_permission(station_id, 'station.write'))
  WITH CHECK (fuelpro_has_permission(station_id, 'station.write'));
CREATE POLICY fuel_price_history_delete ON public.fuel_price_history
  FOR DELETE TO authenticated USING (fuelpro_has_permission(station_id, 'station.write'));

DROP POLICY IF EXISTS inventory_movements_station_access ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY inventory_movements_write ON public.inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    fuelpro_has_permission(station_id, 'inventory.write')
    OR fuelpro_has_permission(station_id, 'purchase.receive')
  );

DROP POLICY IF EXISTS tank_movements_station_access ON public.tank_movements;
CREATE POLICY tank_movements_read ON public.tank_movements
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY tank_movements_write ON public.tank_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    fuelpro_has_permission(station_id, 'inventory.write')
    OR fuelpro_has_permission(station_id, 'purchase.receive')
  );

DROP POLICY IF EXISTS shift_pump_readings_station_access ON public.shift_pump_readings;
CREATE POLICY shift_pump_readings_read ON public.shift_pump_readings
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY shift_pump_readings_write ON public.shift_pump_readings
  FOR INSERT TO authenticated
  WITH CHECK (
    fuelpro_has_permission(station_id, 'meter.reading')
    OR fuelpro_has_permission(station_id, 'shift.close')
  );

DROP POLICY IF EXISTS payment_transactions_station_access ON public.payment_transactions;
DROP POLICY IF EXISTS payments_scope ON public.payment_transactions;
CREATE POLICY payment_transactions_read ON public.payment_transactions
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY payment_transactions_insert ON public.payment_transactions
  FOR INSERT TO authenticated WITH CHECK (fuelpro_has_permission(station_id, 'payment.create'));
CREATE POLICY payment_transactions_reconcile ON public.payment_transactions
  FOR UPDATE TO authenticated
  USING (fuelpro_has_permission(station_id, 'payment.reconcile'))
  WITH CHECK (fuelpro_has_permission(station_id, 'payment.reconcile'));
-- Intentionally no DELETE policy: payment transactions are ledger records.

DROP POLICY IF EXISTS nozzle_prices_scope ON public.nozzle_price_history;
CREATE POLICY nozzle_prices_read ON public.nozzle_price_history
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY nozzle_prices_write ON public.nozzle_price_history
  FOR INSERT TO authenticated WITH CHECK (fuelpro_has_permission(station_id, 'station.write'));
CREATE POLICY nozzle_prices_update ON public.nozzle_price_history
  FOR UPDATE TO authenticated
  USING (fuelpro_has_permission(station_id, 'station.write'))
  WITH CHECK (fuelpro_has_permission(station_id, 'station.write'));
CREATE POLICY nozzle_prices_delete ON public.nozzle_price_history
  FOR DELETE TO authenticated USING (fuelpro_has_permission(station_id, 'station.write'));

-- Role assignments are administrative data. Matching one's own role is not enough
-- to change another assignment.
DROP POLICY IF EXISTS station_roles_scope ON public.station_role_assignments;
CREATE POLICY station_roles_read ON public.station_role_assignments
  FOR SELECT TO authenticated USING (fuelpro_user_role(station_id) IS NOT NULL);
CREATE POLICY station_roles_insert ON public.station_role_assignments
  FOR INSERT TO authenticated
  WITH CHECK (fuelpro_has_permission(station_id, 'station.write') OR fuelpro_user_role(station_id) = 'owner');
CREATE POLICY station_roles_update ON public.station_role_assignments
  FOR UPDATE TO authenticated
  USING (fuelpro_has_permission(station_id, 'station.write') OR fuelpro_user_role(station_id) = 'owner')
  WITH CHECK (fuelpro_has_permission(station_id, 'station.write') OR fuelpro_user_role(station_id) = 'owner');
CREATE POLICY station_roles_delete ON public.station_role_assignments
  FOR DELETE TO authenticated
  USING (fuelpro_has_permission(station_id, 'station.write') OR fuelpro_user_role(station_id) = 'owner');

-- Optimistic concurrency: a NULL expected version may create a missing row, but
-- can never overwrite an existing row. This closes the first-write lost-update race.
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
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'version', v_current,
        'data', v_row.data,
        'updated_at', v_row.updated_at
      );
    END IF;

    UPDATE public.app_kv
       SET data = p_data,
           version = v_current + 1,
           updated_at = now()
     WHERE id = p_id
       AND owner_id = p_owner_id
       AND station_id IS NOT DISTINCT FROM p_station_id
       AND collection = p_collection
     RETURNING * INTO v_row;
  ELSE
    IF p_expected_version IS NOT NULL AND p_expected_version <> 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'conflict', true,
        'version', NULL,
        'data', NULL,
        'updated_at', NULL
      );
    END IF;

    INSERT INTO public.app_kv(id, owner_id, station_id, collection, data, version, updated_at)
    VALUES (p_id, p_owner_id, p_station_id, p_collection, p_data, 1, now())
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'conflict', false,
    'version', v_row.version,
    'data', v_row.data,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_app_kv_versioned(text, uuid, uuid, text, jsonb, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_app_kv_versioned(text, uuid, uuid, text, jsonb, integer) TO authenticated;

COMMIT;
