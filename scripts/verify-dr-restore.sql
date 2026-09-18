\set ON_ERROR_STOP on
SELECT COUNT(*) > 0 AS has_stations FROM stations;
SELECT COUNT(*) > 0 AS has_sales_ledger FROM sales_ledger;
SELECT COUNT(*) > 0 AS has_shift_ledger FROM operational_shifts;
SELECT COUNT(*) > 0 AS has_payment_ledger FROM payment_transactions;
SELECT COUNT(*) > 0 AS has_audit_log FROM immutable_audit_log;
SELECT COUNT(*) > 0 AS has_migration_verifications FROM migration_verifications;
SELECT COALESCE(SUM(gross_amount),0) AS canonical_sales_total FROM sales_ledger;
SELECT COALESCE(SUM(quantity_litres),0) AS canonical_litres_total FROM sales_ledger;