# FuelPro Mobile — Site Navigation & Architecture Map (2026-09-02)

This document is the single source of truth for **what is wired where**, what
data each feature owns, what each consumes, and the **boundaries** that govern
every future feature. It is auto-augmented each time a new forecourt vector
ships; extend it rather than starting over.

---

## 1. Navigation map (Host → Sub-tags → Feature)

33 top-level host tabs (registered in `FuelContext.tabConfigurations`); the
case handlers are in `Home.tsx`. **Rule: no new top-level tabs without
review** — every new feature lands as an inner view/sub-panel of an existing
host tab.

| Host (id) | Component | Inner views (SubTabBar / view-toggle) | Cloud stores it reads/writes |
| -- | -- | -- | -- |
| `dashboard` | `Dashboard.tsx` | single | compact blob (`fuel_data`), `fuel_types_config`, `pos_transactions` (read-only) |
| `pos` | `PointOfSale.tsx` | single (main POS) | **writes** `pos_transactions`, `mpesa_transactions` (nested M-Pesa sale), `loyalty_customers`, compact blob |
| `sales` | `SalesTracking.tsx` | single | compact blob (`fuelPumpsByType`, `fuelTankValuesByType`, `fuelPricesByType`) |
| `livetransaction` | `LiveTransaction.tsx` | STK modal, sources | `mpesa_config`, `kopokopo_config`, `payhero_config`, `mpesa_transactions`, `payment_sources` |
| `offloading` | `FuelOffloading.tsx` | records / recon / tankers | compact blob (`offloading_records`), `delivery_recons`, `tankers` |
| `delivery` | `DeliveryTracker.tsx` | single | compact blob (`deliveryRecords`) |
| `inventory` | `InventoryManagement.tsx` | products / tankmonitor / telemetry / calibration / dipcalc / watertrace / abc / meterproving / movements / valuation / adjustments / transfers / counts / wastage / reorders / history / price-scheduler | `products`, `inventory_transactions`, `stock_transfers`, `tank_readings` (`tankReadings`), `theft_anomaly_threshold_pct`, `price_schedules`, `pump_control` (PCB), `auto_replenishment_target_days`, `dip_chart_points`, `meter_proving_log` |
| `fuelsalesreport` | `FuelSalesReport.tsx` | report / analysis / vehicles / services / payrecon / mix | `pos_transactions` (read), `nozzle_analysis` etc. (computed), `fuel_mix` (computed from POS) |
| `invoice` | `Invoice.tsx` | invoice / sales-invoices | compact blob (`invoices`, `clients`), `sales_enhanced` (read) |
| `credit` | `CreditManagement.tsx` | accounts / fleet / reminders / statements / portal / aging / pricelists / emissions | `credit_accounts`, `credit_transactions`, `fleet_cards`, `fleet_telemetry` (alarms), `farm_equipment`, `fleet_emissions`, `customer_price_lists`, `debt_reminders` |
| `customers` | `CustomerLoyalty.tsx` | customers / segments / promos / punchcards / history / complaints / tiers | `loyalty_customers`, `promoRules`, `punch_cards`, `customer_complaints`, `loyalty_tier_config` |
| `mpesa` | `MPESAAnalyzer.tsx` | pattern / AI | `mpesa_transactions` (write/sync via `addBatchTransactions`), `mpesa_config` |
| `payroll` | `PayrollSystem.tsx` | advances, payslip sub-tabs | `payroll_employees`, `payroll_settings`, `staff_loans`, `payroll_payslip_config`, `payroll_payslip_log`, `payroll_shortlink_*` |
| `suppliers` | `SupplierManagement.tsx` | suppliers / orders / purchases / contracts / scorecard | `suppliers_data`, `purchase_orders`, `supplier_contracts` |
| `expenses` | `ExpenseTracker.tsx` | expense / analytics | `expenses_data`, `expense_budget` |
| `fueltypes` | `FuelTypesManager.tsx` | main / priceboard / fuel-quality / rate-history | `fuel_types_config` (+ derives compact-blob prices), `fuel_quality_records`, `price_history_data` |
| `team` | `TeamManager.tsx` | team / role / shifts / activity/health | `team_members`, `team_invites`, `role_tab_grants`, `custom_roles`, `__perm_overrides__`, `shift_data`, `shift_employees`, `station_access_codes` (table), `attendant_kpi` |
| `maintenance` | `MaintenanceTracker.tsx` | maintenance + stacked panels | `maintenance_records`, `generator_fuel_tracker`, `utility_readings`, `power_outages`, `energy_mix_log`, `battery_health`, `hose_log`, `pm_checklists` |
| `reports` | `ReportsCenter.tsx` | overall / daybook / losscontrol / bankledger / cashflow / stationpnl / profit-loss / expenses / vat-return / daily-sales / kra-summary | `daybook_entries` (`daybook`), `bank_ledger_accounts`, `bank_ledger_entries`, derived from POS + compact blob |
| `analytics` | `AdvancedAnalytics.tsx` | single | `sales_enhanced`, `inventory`, `pumps` DB tables (read) + compact blob |
| `audit` | `AuditTrail.tsx` | single | `audit_log` |
| `pumpmapping` | `PumpMappingV1.tsx` | single | `pump_mapping_*` |
| `communication` | `Communication.tsx` | contacts / messages / templates / settings | `comm_contacts`, `comm_messages`, `comm_templates`, `comm_integration_config` |
| `documents` | `DocumentCenter.tsx` | documents / converter | `user_documents` (table), Storage `fuelpro-files/documents/`, `converter_jobs` |
| `data` | `DataManager.tsx` | overview / backup / clear / seed / storage & egress | `erp_export_state`, `app_kv` introspection, `fuelpro_realtime_enabled` flag (localStorage flag mirrors the guard) |
| `integration` | `IntegrationHub.tsx` | connectors / webhooks / apikeys / logs / payment-setup | `in_connectors`, `in_webhooks`, `in_apikeys`, `in_logs`, `mpesa_config`, `kopokopo_config`, `payhero_config` |
| `regional` | `Compliance.tsx` | 10 sections incl. safety + hsse | country-scoped `compliance_permits_<CODE>`, `safety_inspections`, `hsse_permits` |
| `news` | `News.tsx` | articles / channels / tv / radio | `news_bookmarks`, `news_read`, `live_feed_favorites`, `live_feed_history`, `live_feed_analytics`, `live_feed_reminders`, `live_feed_subtitle_lang` |
| `terminal` | `TerminalSessions.tsx` | single (opens/closes sessions) | DB `terminal_sessions` (table), `shift_handovers`, `gift_vouchers`, `discount_approvals` |
| `automation` | `AutomationPanel.tsx` | settings / reorders / log | `automation_config_*`, `automation_reorder_log` |
| `price-finder` | `FuelPriceLocator.tsx` | finder / tracker | `fuel_price_locator_cache`, DB `fuel_prices` |
| `settings` | `GeneralSettings.tsx` | general / module-behavior / api / deployment | general_settings_v1 (cloud), `prefs.defaultTab`, `prefs.rememberLastTab` |
| `documents` (legacy page) | `Documents.tsx` | — | not rendered in Home; kept for reference |

Within InventoryManagement the Tank Monitor stack is now: **TankMonitor +
TheftAnomalyDetector + AutoReplenishment + EvaporationDriftDetector +
ThresholdAlertRules + TamperAlarmLog + TankWaterTrace** — they all read the
same `tankReadings` cloud KV; only TankMonitor/TankTelemetry write it.

---

## 2. Cross-feature data-sharing matrix (who talks to whom)

**Owned data (single-writer principle):** each cloud KV key has exactly one
feature allowed to write it; every other feature MUST read through the same
`useCloudKV`/`cloudStorageService.get` path. This prevents the
"two-writeers-overwrite-each-other" races fixed in 2026-08-09/11/31.

| Data item | Owner (writer) | Readers |
| -- | -- | -- |
| Fuel types + pump counts (`fuel_types_config`) | `FuelTypesManager` (`persist()`) | Dashboard, POS, SalesTracking, PriceBoard, FuelPriceLocator, FuelTracker, Invoice, SupplierManagement, FuelOffloading, AdvancedAnalytics, CustomerLoyalty, useStationFuelTypes |
| Fuel prices (compact blob pmsPrice/agoPrice) | `SetupWizard` + `DeliveryTracker` + `FuelContext.syncPriceToFuelTypes` | all of the above via `useStationFuelTypes.getPriceFor` |
| POS sales (`pos_transactions`) | `PointOfSale.processPayment` | FuelMixReport, AbcInventoryAnalysis, AdvancedAnalytics, SalesTracking (read for prices?), Dashboard, CustomerPurchaseHistory, StationPnlSummary, CombinedStationsView |
| Tank readings (`tank_readings` = `tankMonitor`) | `TankMonitor` + `TankTelemetry` | TheftAnomalyDetector, AutoReplenishment, EvaporationDriftDetector, ThresholdAlertRules, TamperAlarmLog, TankWaterTrace |
| M-Pesa transactions (`mpesa_transactions`) | `LiveTransaction` (add/save), `PointOfSale` (on M-Pesa sale), `MPESAAnalyzer` (import) | LiveTransaction, MPESAAnalyzer shared analytics |
| Credit accounts (`credit_accounts`) | `CreditManagement` | DebtReminder, CustomerStatement, CreditCustomerPortal, CreditAgingReport, CreditConfigPanel (`recordPayment`), StationPnlSummary (indirect) |
| Credit transactions (`credit_transactions`) | `CreditManagement` | CreditAgingReport (aging analysis), CustomerStatement |
| Payment sources (`payment_sources`) | `LiveTransaction` | MPESAAnalyzer |
| Config (mpesa / kopokopo / payhero) | `IntegrationHub` (IntegrationsSettings is its sub-view) | PointOfSale, LiveTransaction (banner/status), MPESAAnalyzer |
| Fuel prices per customer (`customer_price_lists`) | `CustomerPriceLists` (Credit tab) | **POS + Invoice should read this before shows price** (boundary violation tracked below) |
| Loyalty tiers (`loyalty_tier_config`) | `LoyaltyTierConfig` (CustomerLoyalty) | CustomerLoyalty (compute tier), CustomerSegments (segment show), PunchCardLoyalty |
| Complaints (`customer_complaints`) | `CustomerComplaintsLog` | Communication (suggested automatic linking below) |
| Handover notes (`shift_handovers`) | `ShiftHandoverChecklist` (TerminalSessions) | **Team → Shifts + Payroll should subscribe** (boundary violation tracked below) |
| Access codes (`station_access_codes`) | `TeamManager` | `StationAccess.tsx` page, `StationManager` Access sub-tab (read) |
| Permissions (`team_role_grants`, `custom_roles`, `__perm_overrides__`) | `TeamManager` (PermissionContext thinks of ui grid) | `PermissionContext` (`canDo`), `TeamManager.RolesAndPermissionsView` |
| Employee + shifts (`shift_data`, `shift_employees`) | `ShiftManagement` (Team sub tab) | Payroll (employees list for payslip), AttendantPerformance (KPIs), ShiftHandoverChecklist (suggests) |
| Maintenance (`maintenance_records`) | `MaintenanceTracker` | FuelOffloading (trailer status), UtilityTracker (utilities costs), ExpenseTracker (suggest to record expense cross-tab) |
| Purchases (`purchase_orders`) | `SupplierManagement` | SupplierScorecard (scored), DeliveryTracker (delivery assignment), FuelOffloading (delivery amount expectation), StaffAdvanceLoans/LoanRegister (advance deduction from payroll?) |
| Stations (`stations` table) | `StationContext` | every station-scoped feature + CombinedStationsView + FuelContext |
| App KV envelope (`app_kv`) | all cloud features via `cloudStorageService` | DataManager.Storage&Egress introspection, Founder `Cloud KV Inspector` |

---

## 3. Event-driven architecture (existing buses + missing ones)

Two event buses exist today; two **must** exist to avoid the ad-hoc prop
drilling that's already spreading.

### 3.1 `fuel-interlink-bus.ts` (already exists)
Payload: `FuelPriceChangePayload { fuelType, canonical?, price?, amount? }`.
Emitters: `FuelTypesManager` (price edits), `PriceBoard` (price set,
per-entry `source: "user" | "auto"`), `FuelContext` universal
price-propagation effect.
Listeners: all `useStationFuelTypes` consumers (price cards, POS quick-sale,
Invoice etc.).

### 3.2 `mpesa-integration-service.ts` `navigateToTab(tabId, payload)` (already exists)
`changeTab` CustomEvent + deferred `tabPayload` receiver; receivers
register via `onTabPayload(tabId, cb)`. Used for Credit → LiveTransaction
(pre-filled STK), Invoice → Credit, Maintenance → Expense, Payroll →
Expense, Dashboard Quick Actions.

### 3.3 ✅ LANDED 2026-09-02 — `lib/feature-events.ts`
Tyled pub/sub channel (`emitFeatureEvent` / `onFeatureEvent`) with a single
discriminated union `FPFeatureEvent` covering: `discount.approved/rejected`,
`handover.added/acknowledged`, `voucher.issued/redeemed`,
`meter-proving.pass/fail`, `tank-water.alert`, `complaint.opened/resolved`,
`permit.issued/closed`, `power.outage`. Contract: emitters are ONLY the KV
owner of the KVs the event describes; listeners unsubscribe on return.
5 contract tests in `src/test/feature-events.test.ts` (unsub, cross-type
isolation, multilistener blast, throw-isolation).

### 3.4 Event names MUST be scoped + typed
Define in `lib/feature-events.ts`:
```
export type FPFeatureEvent =
  | { type: "discount.approved"; payload: { discountId: string; amount: number } }
  | { type: "handover.acknowledged"; payload: { handoverId: string; by: string } }
  | { type: "voucher.redeemed"; payload: { code: string; amount: number } }
  | { type: "meter-proving.fail"; payload: { nozzle: string; driftPct: number } }
  | { type: "tank-water.alert"; payload: { fuelType: string; waterMm: number } };
```

---

## 4. Boundary rules (what goes in which tab)

1. **One owner per cloud KV key** — the tab naming the key in its
   "Owned data" column above is the ONLY writer. Other writers are bugs.
2. **Sub-view of a host tab does not own a new KV key without the host
   naming it.** New keys are introduced in the host's `CLOUD_KEYS` mapping
   (the inventory tab's `forecourt-features.ts` is the precedent — see the
   2026-08-31 and 2026-09-02 batches).
3. **No new top-level tab without review** — features land as inner views
   inside an existing host tab (SubTabBar or view-toggle).
4. **Cross-tab sharing is via `useCloudKV` (per-key state) or
   `navigateToTab` (action prefill) or the interlink bus (price changes);
   NOT via direct import of another feature's internal logic.**
5. **Computed views stay read-only.** e.g. AbcInventoryAnalysis, FuelMix,
   Aging, Tier, Scorecard — they must read `pos_transactions`,
   `credit_accounts`, `loyalty_customers`, `purchase_orders`, never write.
6. **Shared form/presentational primitives go to `components/ui/` — never
   copied alongside** (no `ComplainForm.tsx` + `ComplaintsRow.tsx`
   duplicating SubTabBar's behavior).
7. **Confirmation & delete modals are reused** (ConfirmationModal,
   DeleteConfirmModal, Modal) — never inline the same shell.
8. **Cloud KV key names are `<feature>_<noun>`** (`tank_readings`,
   `power_outages`, `hsse_permits`) — never a feature name alone.
9. **Any feature that changes shared data MUST emit the proper event
   on the interlink bus or via `navigateToTab`** — silent cross-feature
   side-effects are forbidden (they re-introduce the 2026-08-12 owner-flip
   write races).

---

## 5. Boundary violations found in the 2026-09-02 audit (fix list)

1. ~~**POS doesn't consult `customer_price_lists` before charging**~~ ✅
   FIXED 2026-09-02 — `PointOfSale.addFuelToCart` now falls back to
   `contract-pricing.resolveContractPrice(customerName, label, standardPrice,
   rules)`; the Credit tab → Price Lists contract price wins over the station
   standard price whenever a customer is attached to the sale.
2. ~~**Invoice doesn't consult `customer_price_lists`**~~ ✅ FIXED 2026-09-02 —
   the "use fuel price" button feeds `resolveContractPrice` through the same
   shared helper (`resolveContractPrice` in `lib/contract-pricing.ts`).
3. ~~**ShiftHandoverChecklist doesn't now feed Team → Shifts**~~ ✅ FIXED 2026-09-02 —
   Team tab → Activity & Health now has a "Shift Handovers" panel subscribing
   to the same cloud KV.
4. ~~**Communication doesn't surface open complaints**~~ ✅ FIXED 2026-09-02 —
   Communication has a new "Complaints" sub-tab (read-only for the comms
   team; resolution still lives in CustomerLoyalty). Deep-link "Message"
   jump into Communication.prefill.
5. **TankWaterTrace reads `tankReadings` directly even though the
   owner is TankMonitor** — legal (read-only); starts to emit
   `tank-water.alert` events on crossing 5 mm (open boundary: keep the
   reading-schema marker that the writer must respect).
6. **`LiveTransaction` writes `mpesa_transactions` and `PointOfSale` writes
   it too** — both use `addBatchTransactions` (de-dup by ref), so this is a
   managed multi-writer arrangement — document the rule in the key comment.
7. **Aging computes "days since last purchase" inconsistently because
   writers mix `date` and `createdAt`** — writers must always set both;
   CreditAgingReport normalizes on read today.
8. **Station P&L derives expenses directly from `expenses_data`** —
   read-only, tolerates unknown keys (the `expense_budget` cloud key is
   ignored deliberately); knows to re-audit if ExpenseTracker schema grows.

---

## 6. Checklist for every new feature (mandatory)

- [ ] Cloud KV key added to the canonical map in `forecourt-features.ts` +
      wired to one OWNER feature.
- [ ] Host tab chosen; inner view via SubTabBar or view-toggle.
- [ ] Read-only if computed; writer if stateful.
- [ ] Uses `useCloudKV` (3-ref guard or auto-heal) + `getCached`
      initialization (avoid blank flash).
- [ ] Emits an `emit` on the feature-event bus if the change is meaningful
      to other features (price, discount, handover, voucher, meter, water).
- [ ] `navigateToTab` payload type added to `mpesa-integration-service.ts`
      if the feature deep-links.
- [ ] No new top-level tab; no duplicated modal/confirmation form; no
      direct import of another feature's internal logic.
- [ ] No lint complaints (`Upload`/`Eye` dead imports were found twice in
      the Compliance sub-sections — clean them when you touch the file).
- [ ] ARCHITECTURE.md updated with the row in the host-list + matrix.
