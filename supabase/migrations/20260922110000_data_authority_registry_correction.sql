-- FuelPro authority registry correction: distinguish current operational stores
-- from the relational canonical target that is not yet populated for all legacy flows.

DELETE FROM data_authority_registry
WHERE entity_key IN (
  'station','fuel_catalog','fuel_price_history','shift','meter_reading',
  'fuel_sale','product_sale','payment','mpesa_feed'
);

INSERT INTO data_authority_registry(entity_key,authoritative_store,read_model,cache_keys,notes)
VALUES
 ('station_core','public.stations','StationContext.currentStation',ARRAY['localStorage:stations','FuelContext.currentStationId'],
  'Core station identity/profile fields live in stations. Local StationContext/FuelContext copies are UI/cache mirrors.'),
 ('station_payload','app_kv:station_data_<station>','StationContext.currentStation.data',ARRAY['localStorage:stations.data','FuelContext.stationData'],
  'Station.data is a separate payload because the stations table does not contain the full payload. The app_kv station_data row is its current system of record; other copies are mirrors.'),
 ('fuel_catalog','app_kv:fuel_types_config','useStationFuelTypes.activeFuelTypes',ARRAY['FuelContext.fuelTypes','localStorage'],
  'Current Fuel Type Manager registration is station-scoped app_kv. The relational fuel_types/pump_nozzles model is the migration target but is not yet populated for all stations.'),
 ('fuel_price_current','app_kv:fuel_types_config','PriceBoard/SalesTracking',ARRAY['FuelContext.fuelPricesByType','legacy scalar prices','localStorage'],
  'Current station price is owned by the station fuel catalog; UI maps/scalars are compatibility projections.'),
 ('fuel_price_history','app_kv:price_history_data','RateHistory/PriceHistory',ARRAY['FuelContext legacy price fields'],
  'Historical price events currently come from the station-scoped price history store until nozzle_price_history is populated.'),
 ('shift_current','app_kv:FuelContext_compact + shift-specific keys','SalesTracking/ShiftManagement',ARRAY['localStorage','FuelContext'],
  'Legacy shift UI currently persists in app_kv snapshots. operational_shifts is the target immutable shift SOR; it currently has no rows in the live database and must not be used as a silent fallback.'),
 ('meter_reading_current','app_kv:FuelContext_compact.salesHistory','SalesTracking',ARRAY['localStorage','FuelContext'],
  'Current legacy meter snapshots remain in the station-scoped compact record until SalesTracking is bridged to operational_shift_meters.'),
 ('fuel_sale_target','public.sales_ledger','canonical reports',ARRAY['FuelContext.salesHistory','pos_transactions'],
  'sales_ledger is the intended immutable SOR, but the live database currently has no sales_ledger rows. Do not substitute it for legacy reports until the posting bridge is active.'),
 ('product_sale','public.sales_enhanced','SalesInvoices/fetchSales',ARRAY['pos_transactions'],
  'Enhanced/product POS sales are authoritative in sales_enhanced. pos_transactions must not be merged into this dataset when sales_enhanced returns successfully.'),
 ('payment_canonical_target','public.payment_transactions','canonical reconciliation',ARRAY['mpesa_transactions','pos_transactions'],
  'payment_transactions is the target canonical payment SOR; the live database currently has no rows, so legacy payment feeds remain separate until bridged.'),
 ('mpesa_feed','app_kv:mpesa_transactions','LiveTransaction/MPESAAnalyzer',ARRAY['FuelContext.mpesaTransactions','app_kv:live_transactions'],
  'Unified M-Pesa feed is current operational source for the analyzer/monitor. live_transactions is deprecated and must never become a second feed.')
ON CONFLICT(entity_key) DO UPDATE SET
 authoritative_store=EXCLUDED.authoritative_store,
 read_model=EXCLUDED.read_model,
 cache_keys=EXCLUDED.cache_keys,
 notes=EXCLUDED.notes,
 updated_at=NOW();
