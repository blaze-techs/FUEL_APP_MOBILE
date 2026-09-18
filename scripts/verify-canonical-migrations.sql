\set ON_ERROR_STOP on
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

INSERT INTO auth.users(id,email) VALUES('11111111-1111-1111-1111-111111111111','ci@fuelpro.test') ON CONFLICT DO NOTHING;
INSERT INTO users(id,email,role) VALUES('11111111-1111-1111-1111-111111111111','ci@fuelpro.test','founder') ON CONFLICT(id) DO UPDATE SET role='founder';

INSERT INTO stations(id,name,owner_id)
VALUES('22222222-2222-2222-2222-222222222222','CI Station','11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO fuel_types(id,name,code)
VALUES('33333333-3333-3333-3333-333333333333','Petrol','PMS')
ON CONFLICT(code) DO NOTHING;

INSERT INTO pumps(id,station_id,pump_number,name,fuel_type_id,price_per_liter)
VALUES('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','1','Pump 1','33333333-3333-3333-3333-333333333333',220)
ON CONFLICT(station_id,pump_number) DO NOTHING;

INSERT INTO pump_nozzles(id,station_id,pump_id,fuel_type_id,nozzle_code)
VALUES('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333','1-1')
ON CONFLICT(station_id,pump_id,nozzle_code) DO NOTHING;

SELECT (fuelpro_open_shift('22222222-2222-2222-2222-222222222222','2026-09-18','day')).id AS opened_shift \gset

SELECT (fuelpro_post_sale(
  '22222222-2222-2222-2222-222222222222',
  :'opened_shift'::uuid,
  '55555555-5555-5555-5555-555555555555',
  10,220,0,'paid',NULL,NULL,'CI-0001',NULL,'ci-sale-1','{}'::jsonb
)).id AS sale_id \gset

INSERT INTO payment_transactions(
  station_id,ledger_sale_id,shift_id,provider,provider_reference,payment_method,
  amount,currency,status,confirmed_at,idempotency_key
) VALUES(
  '22222222-2222-2222-2222-222222222222',:'sale_id'::uuid,:'opened_shift'::uuid,
  'cash','ci-cash-1','cash',2200,'KES','confirmed',NOW(),'ci-payment-1'
);

SELECT fuelpro_close_shift(
  :'opened_shift'::uuid,
  '[{"nozzle_id":"55555555-5555-5555-5555-555555555555","opening_meter":1000,"closing_meter":1010,"price_per_liter":220,"actual_sales":2200}]'::jsonb,
  '[{"payment_method":"cash","expected_amount":2200,"counted_amount":2200}]'::jsonb,
  NULL
);

SELECT (fuelpro_reverse_sale(:'sale_id'::uuid,'CI reversal','ci-reversal-1')).id AS reversal_id \gset
SELECT set_config('test.sale_id', :'sale_id', false);

DO $
DECLARE n numeric;
BEGIN
  SELECT COALESCE(SUM(gross_amount),0) INTO n FROM sales_ledger WHERE station_id='22222222-2222-2222-2222-222222222222';
  IF n <> 0 THEN RAISE EXCEPTION 'Sale + reversal must net to zero, got %', n; END IF;
  IF NOT EXISTS(SELECT 1 FROM tank_movements WHERE reference_type='sales_ledger') THEN
    RAISE EXCEPTION 'Automatic tank movement was not created';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM canonical_station_daily_summary WHERE station_id='22222222-2222-2222-2222-222222222222') THEN
    RAISE EXCEPTION 'Canonical report view returned no row';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE sales_ledger SET gross_amount=1 WHERE id=current_setting('test.sale_id')::uuid;
    RAISE EXCEPTION 'Immutable ledger update unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Immutable ledger update unexpectedly succeeded' THEN RAISE; END IF;
  END;
END $$;
