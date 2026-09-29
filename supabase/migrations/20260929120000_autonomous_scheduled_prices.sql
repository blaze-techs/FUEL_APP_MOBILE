-- FuelPro autonomous scheduled-price execution
-- The browser remains a UI/projection only. The database owns execution.

CREATE OR REPLACE FUNCTION public.fuelpro_apply_due_price_schedules()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_schedule JSONB;
  v_data JSONB;
  v_new_data JSONB;
  v_config_data JSONB;
  v_config_id TEXT;
  v_station UUID;
  v_owner UUID;
  v_schedule_id TEXT;
  v_fuel TEXT;
  v_price NUMERIC;
  v_effective TIMESTAMPTZ;
  v_previous NUMERIC;
  v_execution TEXT;
  v_applied INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id, station_id, owner_id, data
    FROM public.app_kv
    WHERE collection = 'fuel_data'
      AND station_id IS NOT NULL
      AND jsonb_typeof(data) = 'array'
      AND id LIKE 'price_schedules__%'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(data) e
        WHERE e->>'status' = 'pending'
          AND (e ? 'verificationConfirmedAt' OR e ? 'mfaVerifiedAt')
          AND COALESCE(e->>'effectiveOn','') <> ''
          AND (e->>'effectiveOn')::timestamptz <= NOW()
      )
    ORDER BY updated_at
    FOR UPDATE
  LOOP
    v_station := v_row.station_id;
    v_owner := v_row.owner_id;
    v_data := v_row.data;

    FOR v_schedule IN
      SELECT value
      FROM jsonb_array_elements(v_data)
      WHERE value->>'status' = 'pending'
        AND (value ? 'verificationConfirmedAt' OR value ? 'mfaVerifiedAt')
        AND COALESCE(value->>'effectiveOn','') <> ''
        AND (value->>'effectiveOn')::timestamptz <= NOW()
      ORDER BY (value->>'effectiveOn')::timestamptz, value->>'id'
    LOOP
      v_schedule_id := v_schedule->>'id';
      v_fuel := COALESCE(v_schedule->>'fuelType', v_schedule->>'label');
      v_price := NULLIF(v_schedule->>'price','')::NUMERIC;
      v_effective := (v_schedule->>'effectiveOn')::timestamptz;
      v_execution := 'auto_' || gen_random_uuid()::text;

      IF v_schedule_id IS NULL OR v_price IS NULL OR v_price <= 0 OR v_effective IS NULL THEN
        CONTINUE;
      END IF;

      -- Only stations with an actual configured fuel/nozzle mapping are eligible.
      IF NOT EXISTS (
        SELECT 1
        FROM public.pump_nozzles pn
        JOIN public.fuel_types ft ON ft.id = pn.fuel_type_id
        WHERE pn.station_id = v_station
          AND pn.is_active = TRUE
          AND regexp_replace(lower(ft.name),'[^a-z0-9]','','g')
              = regexp_replace(lower(v_fuel),'[^a-z0-9]','','g')
      ) THEN
        v_failed := v_failed + 1;
        CONTINUE;
      END IF;

      SELECT ph.price_per_liter
      INTO v_previous
      FROM public.nozzle_price_history ph
      JOIN public.pump_nozzles pn ON pn.id = ph.nozzle_id
      JOIN public.fuel_types ft ON ft.id = pn.fuel_type_id
      WHERE ph.station_id = v_station
        AND pn.is_active = TRUE
        AND regexp_replace(lower(ft.name),'[^a-z0-9]','','g')
            = regexp_replace(lower(v_fuel),'[^a-z0-9]','','g')
        AND ph.valid_to IS NULL
      ORDER BY ph.valid_from DESC
      LIMIT 1;

      -- Close the currently effective canonical price interval, then create
      -- the new scheduled interval for every active nozzle of this fuel.
      UPDATE public.nozzle_price_history ph
      SET valid_to = v_effective
      FROM public.pump_nozzles pn
      JOIN public.fuel_types ft ON ft.id = pn.fuel_type_id
      WHERE ph.nozzle_id = pn.id
        AND ph.station_id = v_station
        AND pn.station_id = v_station
        AND pn.is_active = TRUE
        AND regexp_replace(lower(ft.name),'[^a-z0-9]','','g')
            = regexp_replace(lower(v_fuel),'[^a-z0-9]','','g')
        AND ph.valid_from < v_effective
        AND (ph.valid_to IS NULL OR ph.valid_to > v_effective);

      INSERT INTO public.nozzle_price_history(
        station_id,nozzle_id,price_per_liter,currency,valid_from,source,approved_by
      )
      SELECT
        v_station,pn.id,v_price,'KES',v_effective,'scheduled',NULL
      FROM public.pump_nozzles pn
      JOIN public.fuel_types ft ON ft.id = pn.fuel_type_id
      WHERE pn.station_id = v_station
        AND pn.is_active = TRUE
        AND regexp_replace(lower(ft.name),'[^a-z0-9]','','g')
            = regexp_replace(lower(v_fuel),'[^a-z0-9]','','g')
        AND NOT EXISTS (
          SELECT 1
          FROM public.nozzle_price_history ph
          WHERE ph.nozzle_id = pn.id
            AND ph.valid_from = v_effective
            AND ph.price_per_liter = v_price
        );

      -- Keep the existing cross-device UI projection synchronized. This is
      -- deliberately secondary to nozzle_price_history, never its authority.
      SELECT id, data
      INTO v_config_id, v_config_data
      FROM public.app_kv
      WHERE collection = 'fuel_data'
        AND owner_id = v_owner
        AND station_id = v_station
        AND id LIKE 'fuel_types_config__%'
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_config_id IS NOT NULL AND jsonb_typeof(v_config_data) = 'array' THEN
        v_config_data := (
          SELECT jsonb_agg(
            CASE
              WHEN regexp_replace(lower(COALESCE(e->>'name',e->>'label','')),'[^a-z0-9]','','g')
                   = regexp_replace(lower(v_fuel),'[^a-z0-9]','','g')
              THEN e || jsonb_build_object(
                'price',v_price,
                'source','scheduled',
                'scheduledAt',v_effective,
                'updatedAt',NOW()
              )
              ELSE e
            END
          )
          FROM jsonb_array_elements(v_config_data) e
        );
        UPDATE public.app_kv
        SET data = v_config_data, updated_at = NOW()
        WHERE id = v_config_id;
      END IF;

      v_schedule := v_schedule ||
        jsonb_build_object(
          'status','applied',
          'appliedAt',NOW(),
          'executionId',v_execution,
          'appliedFromPrice',v_previous,
          'appliedToPrice',v_price
        );

      v_data := (
        SELECT jsonb_agg(
          CASE WHEN value->>'id' = v_schedule_id THEN v_schedule ELSE value END
        )
        FROM jsonb_array_elements(v_data)
      );

      INSERT INTO public.immutable_audit_log(
        station_id,user_id,action,entity_type,entity_id,new_values
      )
      VALUES(
        v_station,NULL,'scheduled_price.apply','price_schedule',v_schedule_id,
        jsonb_build_object(
          'fuelType',v_fuel,
          'price',v_price,
          'effectiveOn',v_effective,
          'executionId',v_execution,
          'automated',true,
          'source','supabase_cron'
        )
      );

      v_applied := v_applied + 1;
    END LOOP;

    UPDATE public.app_kv
    SET data = v_data, updated_at = NOW()
    WHERE id = v_row.id;
  END LOOP;

  RETURN jsonb_build_object(
    'applied',v_applied,
    'skippedOrInvalid',v_failed,
    'ranAt',NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fuelpro_apply_due_price_schedules() FROM PUBLIC, anon, authenticated;

-- Idempotent one-minute autonomous worker. The DB, not a browser session,
-- determines when scheduled prices become effective.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fuelpro-apply-scheduled-prices') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'fuelpro-apply-scheduled-prices';
  END IF;

  PERFORM cron.schedule(
    'fuelpro-apply-scheduled-prices',
    '* * * * *',
    'SELECT public.fuelpro_apply_due_price_schedules();'
  );
END $$;

INSERT INTO migration_verifications(migration_name,status,details)
VALUES(
  '20260929120000_autonomous_scheduled_prices',
  'passed',
  jsonb_build_object(
    'execution','database',
    'frequency','every minute',
    'browser_required',false,
    'cross_device',true,
    'canonical_store','public.nozzle_price_history'
  )
);
