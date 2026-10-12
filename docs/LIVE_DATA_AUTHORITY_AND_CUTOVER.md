# Live data authority and migration plan

## Confirmed live state (2026-10-13)
The database has 604 rows in `app_kv`, with 578 in `fuel_data`. Inspected relational counts include:
- `sales_enhanced`: 6 rows
- `sales_ledger`: 0 rows
- `payment_transactions`: 0 rows
- `customers`, `team_members`, `expenses`, `purchase_orders`, `credit_ledger`, and `credit_accounts_ledger`: 0 rows each
- app_kv logical keys include `quotations`, `payroll_employees`, `payroll_settings`, `payroll_payslip_records`, `credit_accounts`, `credit_transactions`, `team_members`, `pos_transactions`, `mpesa_transactions`, and customer portal records.

Several app_kv payloads are compressed envelopes; key-shape inspection shows mixed historical payload shapes. Read/write adapters must use the existing decompression service, preserve station and owner scoping, and avoid hand-parsing compressed JSON.

## Authority rules
1. Do not change a source of truth simply because a normalized table exists.
2. Before cutover, dual-run reads and writes with stable record IDs, compare counts and financial totals, and produce a discrepancy report.
3. Preserve current source keys as migration inputs; never mass-copy by display name.
4. Do not merge `pos_transactions`, `sales_enhanced`, `sales_ledger`, M-Pesa callbacks, and payment transactions as if each row were the same event. They represent different stages or feeds.
5. Customer balances must be computed from confirmed charges/payments/reversals with a reconciliation trail, not a cached snapshot alone.
6. Payroll employees, payroll configuration, generated payslips and payslip shortlinks are separate entities. A shortlink is not a payroll payment.
7. The relationship table stores links only; it does not claim a polymorphic FK to an entity that has not yet been migrated.

## Recommended staged cutover
- Stage A: data authority registry + append-only cross-module relationships, station RLS, idempotency.
- Stage B: customer/credit ledger and invoice/payment allocations with source-ID traceability.
- Stage C: quotations → invoice creation, shared line calculation, receipts and payment allocation.
- Stage D: employee master → tasks/attendance → approved payroll run → payslip/payment status.
- Stage E: accounting journals, period locks, reversal/credit-note workflows and cross-domain integrity reports.
- Stage F: outbox/realtime synchronization, offline conflict resolution and reconciliation monitors.

Every stage requires backfill validation, cross-device tests, permissions tests, duplicate retry tests, reversal tests and financial totals comparison before switching read models.
