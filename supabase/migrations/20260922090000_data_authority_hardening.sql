-- FuelPro Data Authority Hardening
-- 2026-09-22
--
-- Operational records have one database system of record. UI snapshots,
-- app_kv blobs and browser storage may be projections/caches, but must not
-- compete with the canonical ledgers.

CREATE TABLE IF NOT EXISTS data_authority_registry (
  entity_key TEXT PRIMARY KEY,
  authoritative_store TEXT NOT NULL,
  read_model TEXT,
  cache_keys TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO data_authority_registry(entity_key,authoritative_store,read_model,cache_keys,notes)
VALUES
 ('station','public.stations','StationContext.currentStation',ARRAY['fuelpro_stations_v3_*','app_kv:station_data_*'],
  'stations is authoritative for station identity and core metadata; local and app_kv copies are caches/projections.'),
 ('fuel_catalog','public.fuel_types','useStationFuelTypes.activeFuelTypes',ARRAY['app_kv:fuel_types_config','localStorage'],
  'Station fuel registration is authoritative; legacy/default fuel lists are compatibility fallbacks only.'),
 ('fuel_price_history','public.nozzle_price_history','operational_shift_price_snapshots',ARRAY['app_kv:fuel_types_config','FuelContext.fuelPricesByType'],
  'Historical operational price is resolved from the canonical nozzle/shift snapshot. UI price maps are projections.'),
 ('shift','public.operational_shifts','CanonicalShiftControl',ARRAY['app_kv:FuelContext','app_kv:shift_data','localStorage:fuelpro_shifts'],
  'Open/close/reopen/approval state is canonical in operational_shifts and related immutable close records.'),
 ('meter_reading','public.operational_shift_meters','CanonicalShiftControl',ARRAY['app_kv:FuelContext.salesHistory','localStorage'],
  'Physical meter readings and continuity are canonical in operational_shift_meters.'),
 ('sale','public.sales_ledger','canonical_station_daily_summary',ARRAY['app_kv:FuelContext.salesHistory','app_kv:pos_transactions','localStorage:fuelpro_pos_transactions'],
  'Sales ledger is immutable. UI histories are projections/drafts and must not be treated as the accounting source.'),
 ('payment','public.payment_transactions','canonical_shift_payment_totals',ARRAY['app_kv:mpesa_transactions','app_kv:FuelContext.mpesaTransactions'],
  'Payment transactions and reconciliation are canonical in payment_transactions and shift reconciliation views.'),
 ('expense','app_kv:expenses_data','ReportsCenter.cloudExpenses',ARRAY['localStorage:fuelpro_expenses_v2','FuelContext.expenses'],
  'Expenses remain a separate operational domain from shift snapshots; expenses_data is authoritative for the Expenses module.'),
 ('employee_shift','app_kv:shift_employees','ShiftManagement.employees',ARRAY['localStorage:fuelpro_employees','FuelContext.employees'],
  'Shift-management employee records are authoritative in the dedicated station-scoped key until migrated to a relational employee ledger.'),
 ('mpesa_feed','app_kv:mpesa_transactions','LiveTransaction/MPESAAnalyzer',ARRAY['FuelContext.mpesaTransactions','app_kv:live_transactions'],
  'Unified M-Pesa feed is authoritative for transaction-monitor UI; live_transactions is deprecated and must not be read as a source.')
ON CONFLICT(entity_key) DO UPDATE SET
 authoritative_store=EXCLUDED.authoritative_store,
 read_model=EXCLUDED.read_model,
 cache_keys=EXCLUDED.cache_keys,
 notes=EXCLUDED.notes,
 updated_at=NOW();

-- Business date must follow the operational shift date, not UTC created_at.
CREATE OR REPLACE VIEW canonical_station_daily_summary
WITH (security_invoker=true) AS
SELECT
  sl.station_id,
  COALESCE(os.shift_date, sl.created_at::date) AS business_date,
  SUM(CASE WHEN sl.entry_type='reversal' THEN -sl.quantity_litres ELSE sl.quantity_litres END) AS litres,
  SUM(sl.gross_amount) AS gross_sales,
  SUM(sl.tax_amount) AS tax_amount,
  SUM(sl.net_amount) AS net_sales,
  COUNT(*) FILTER (WHERE sl.entry_type='sale') AS sale_count,
  COUNT(*) FILTER (WHERE sl.entry_type='reversal') AS reversal_count
FROM sales_ledger sl
LEFT JOIN operational_shifts os ON os.id=sl.shift_id
GROUP BY sl.station_id, COALESCE(os.shift_date, sl.created_at::date);

CREATE OR REPLACE VIEW canonical_station_daily_fuel_summary
WITH (security_invoker=true) AS
SELECT
  sl.station_id,
  COALESCE(os.shift_date, sl.created_at::date) AS business_date,
  ft.id AS fuel_type_id,
  ft.name AS fuel_type_name,
  SUM(CASE WHEN sl.entry_type='reversal' THEN -sl.quantity_litres ELSE sl.quantity_litres END) AS litres,
  SUM(sl.gross_amount) AS gross_sales,
  COUNT(*) FILTER (WHERE sl.entry_type='sale') AS sale_count,
  COUNT(*) FILTER (WHERE sl.entry_type='reversal') AS reversal_count
FROM sales_ledger sl
LEFT JOIN operational_shifts os ON os.id=sl.shift_id
LEFT JOIN pump_nozzles pn ON pn.id=sl.nozzle_id
LEFT JOIN fuel_types ft ON ft.id=pn.fuel_type_id
GROUP BY
  sl.station_id,
  COALESCE(os.shift_date, sl.created_at::date),
  ft.id,
  ft.name;

COMMENT ON TABLE data_authority_registry IS
  'FuelPro entity-level source-of-truth registry. Other copies are projections/caches and must never silently override the authoritative store.';
COMMENT ON VIEW canonical_station_daily_summary IS
  'Canonical projection of immutable sales_ledger. Business date follows operational shift date when available.';
COMMENT ON VIEW canonical_station_daily_fuel_summary IS
  'Canonical per-fuel projection of immutable sales_ledger and pump/fuel master data.';
