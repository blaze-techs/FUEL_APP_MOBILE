# Unified data interlinking — implementation contract

## Goal
All FuelPro spaces should reuse the same authoritative records. A tab is a view or workflow over business records, not a separate place to re-key them.

## Contract added
`src/react-app/lib/record-interlink.ts` introduces:
- typed cross-module record references (station, customer, employee, task, payroll, quotation, invoice, receipt, payment, statements, sales, inventory, shifts, accounting and communications);
- station-boundary and self-link validation;
- stable idempotency keys for retry-safe relation creation;
- one shared line/tax/total calculation routine;
- fill-missing-only mapping that preserves explicit user edits;
- employee-ID-based workforce-link gap reporting.

## Workflow wiring currently included in this draft
- Accepted quotation → invoice: the invoice prefill carries customer identity, address/phone, line items, tax, currency and quotation ID. Saving preserves the source quotation ID, marks the source quotation converted in its existing station KV authority, and writes a durable relationship link.
- Saved invoice → draft quotation: copies the invoice customer identity, line items, tax and currency into a new quotation without mutating the invoice; the new quotation preserves its source invoice ID.
- Customer → quotation/invoice: stable customer IDs are carried through document conversion, stored with the invoice/quotation, and linked to the document after its authoritative save.
- Payroll employee → payslip record: a payslip record is persisted to its current station-scoped authority first, then linked using the stable employee ID. Records without a stable employee ID are not silently linked by name.
- Invoice accountability: duplicate invoice-number submissions are blocked, issued invoices are retained, unpaid invoices require a reason to be voided, and the UI no longer lets a user mark an invoice paid without payment evidence. M-Pesa collection uses the invoice number as its account reference.

These are partial workflow integrations. They do not yet implement canonical payment allocations, multi-payment settlement, payroll run approval/payment, task assignment UI, accounting journals or a full customer-portal document query. Those require the canonical stores/adapters described below and must not be represented as complete merely because a relationship helper exists.

## Required integration phases
1. **Inventory and map authoritative sources.** Extend `data_authority_registry` for all real entities and explicitly mark legacy copies as projections. Never pick a new source silently.
2. **Persist relationships transactionally.** Add database-backed links with station membership/RLS, unique idempotency, audit actor/time and optimistic concurrency. Do not store accounting links in localStorage as the system of record.
3. **Connect write workflows.** Every create/update/reverse action publishes a domain event only after its authoritative write succeeds. Subscribers refresh projections and must be idempotent.
4. **Documents.** Quotations, invoices, receipts, payments and statements reference their source IDs. Reuse line items and the shared calculator; payment/receipt must settle an invoice, not silently replace or mutate it. Corrections use reversals/credit notes.
5. **HR and work.** Employee IDs connect recruitment, employee master, task assignments, attendance, approved payroll runs and payslips. Payroll eligibility and approvals remain explicit; never create payments merely because an employee record exists.
6. **Reconciliation and audit.** Add cross-module integrity checks for orphaned links, duplicate people, duplicate payroll/payment, mismatched totals, unassigned tasks and missing source records.
7. **Progressive rollout.** Migrate one domain at a time, dual-read only during a monitored migration, compare totals, then remove the legacy write path. No blanket merges of unlike legacy records.

## Current audit finding
The live database already has a `data_authority_registry`, but its current entries explicitly document that several intended canonical bridges are not active (for example `sales_ledger`, `payment_transactions`, operational shifts/meters and employee shift records). The first rollout must honor those notes rather than redirect live reports to empty target tables. HR/payroll/quotation/receipt also need a confirmed authoritative source map before automation can safely write them.

## Safety invariants
- Scope every relationship by station and tenant.
- No cross-station link unless an explicit, authorized transfer workflow permits it.
- Do not overwrite user-edited destination fields during prefill.
- Recalculate totals from source lines; do not trust copied totals.
- Do not delete posted sales/accounting records; use reversal records.
- A retry must not create a second receipt, payment, payroll line or relation.
- Read-only access never gains write capabilities through auto-sync.
