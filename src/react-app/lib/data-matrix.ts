/**
 * data-matrix.ts — the registry of cross-tab data-sharing contracts.
 *
 * Each entry declares, for a group of related tabs/sub-tabs, which cloud
 * key (or table) is the source of truth for a shared data domain and which
 * components read/write it. The automated test in
 * src/test/data-matrix.test.ts verifies the writer components actually
 * reference the key, so a regression that disconnects a sub-tab from the
 * matrix fails CI.
 *
 * When you add a new tab or sub-tab that shares an existing data domain,
 * add it to the relevant group's consumers so the contract stays enforced.
 */

export interface DataMatrixGroup {
  /** Human name of the tab group (e.g. "Fuel Type Manager"). */
  group: string;
  /** Shared data domain. */
  domain: string;
  /** Cloud key(s) or table(s) that hold the shared data. */
  keys: string[];
  /** Components that write to the shared key(s) — must reference them. */
  writers: string[];
  /** Components that read the shared key(s) — informational. */
  readers: string[];
  /** Notes on the sharing flow. */
  notes?: string;
  /** For components that reach the shared key through a helper module
   *  (e.g. mpesa-integration-service) instead of naming the key directly:
   *  a module path fragment whose source the test should ALSO scan. */
  viaModule?: string;
}

export const DATA_MATRIX: DataMatrixGroup[] = [
  {
    group: "Fuel Type Manager",
    domain: "Fuel types & prices",
    keys: ["fuel_types_config"],
    writers: ["FuelTypesManager.tsx"],
    readers: [
      "PriceBoard.tsx",
      "PriceScheduler.tsx",
      "FuelQualityTesting.tsx",
      "Dashboard.tsx",
      "PointOfSale.tsx",
      "SalesTracking.tsx",
    ],
    notes:
      "Single source of truth. All consumers read via useStationFuelTypes; " +
      "edits propagate via cloud + the fuel-interlink bus.",
  },
  {
    group: "Fuel Type Manager",
    domain: "Price board entries",
    keys: ["priceboard_data"],
    writers: ["PriceBoard.tsx"],
    readers: ["Dashboard.tsx"],
    notes: "PriceBoard is the editor; Dashboard shows the board prices.",
  },
  {
    group: "Fuel Type Manager",
    domain: "Price schedules",
    keys: ["price_schedules"],
    writers: ["PriceScheduler.tsx"],
    readers: ["PriceScheduler.tsx", "FuelContext.tsx"],
    notes:
      "PriceScheduler queues; FuelContext applies due schedules app-wide on " +
      "login (not only when the tab is open).",
  },
  {
    group: "Fuel Type Manager",
    domain: "Price-change audit trail",
    keys: ["price_history_data"],
    writers: ["PriceBoard.tsx"],
    readers: ["FuelRateHistory.tsx", "FuelContext.tsx", "FuelTypesManager.tsx"],
    viaModule: "price-history.ts",
    notes:
      "Central recordPriceChange() (lib/price-history.ts) — every price " +
      "source (Fuel Types, Price Board, Scheduler, Dashboard, Price Finder) " +
      "lands in Rate History. FuelContext/FuelTypesManager write through " +
      "the recorder module.",
  },
  {
    group: "Fuel Type Manager",
    domain: "Fuel quality tests",
    keys: ["fuel_quality_tests"],
    writers: ["FuelQualityTesting.tsx"],
    readers: ["FuelTypesManager.tsx"],
    notes:
      "FuelTypesManager shows a Quality ✓/✗ badge per fuel from the latest test.",
  },
  {
    group: "Stock Management",
    domain: "Products",
    keys: ["products", "inventory_transactions", "stock_transfers"],
    writers: ["InventoryManagement.tsx"],
    // StockValuationReport + HistoryTable receive `products`/transactions
    // from InventoryManagement via props (host-passes-data); AutomationPanel
    // reads the auto_reorders derived store. ItemMovementLedger reads the
    // real inventory_transactions directly.
    readers: ["ItemMovementLedger.tsx"],
    notes:
      "Real stock movements (adjustments, transfers, wastage, restocks, POS " +
      "checkout) live in inventory_transactions; the Item Movement Ledger " +
      "merges them automatically.",
  },
  {
    group: "Stock Management",
    domain: "Tank readings (wet stock)",
    keys: ["tank_monitor_readings"],
    writers: ["TankMonitor.tsx", "TankTelemetry.tsx"],
    readers: [
      "TheftAnomalyDetector.tsx",
      "AutoReplenishment.tsx",
      "EvaporationDriftDetector.tsx",
      "ThresholdAlertRules.tsx",
      "TankWaterTrace.tsx",
      "LossControl.tsx",
    ],
    viaModule: "forecourt-features.ts",
    notes:
      "One shared tank_monitor_readings key (via CLOUD_KEYS.tankReadings) " +
      "drives the entire Tank Monitor intelligence stack (anomaly, " +
      "replenishment, drift, alerts, water).",
  },
  {
    group: "Payments",
    domain: "Unified M-PESA transactions",
    keys: ["mpesa_transactions"],
    writers: ["PointOfSale.tsx", "MPESAAnalyzer.tsx", "LiveTransaction.tsx"],
    readers: [
      "LiveTransaction.tsx",
      "MPESAAnalyzer.tsx",
      "CreditManagement.tsx",
    ],
    viaModule: "mpesa-integration-service.ts",
    notes:
      "STK push, statement import and POS M-Pesa sales share one store (via " +
      "the mpesa-integration-service addTransaction/getTransactions helpers) " +
      "so Live Transaction, M-PESA Analyzer and Credit see the same inflows.",
  },
  {
    group: "Credit",
    domain: "Credit accounts & transactions",
    keys: ["credit_accounts", "credit_transactions"],
    writers: ["CreditManagement.tsx"],
    readers: [
      "CreditAgingReport.tsx",
      "CreditCustomerPortal.tsx",
      "CustomerStatement.tsx",
      "FleetCards.tsx",
    ],
    notes:
      "All Credit sub-tabs (accounts, aging, statements, portal, fleet) read " +
      "the same credit_accounts/credit_transactions cloud keys.",
  },
  {
    group: "Team Manager",
    domain: "Team & shift employees",
    keys: ["shift_employees", "shift_data"],
    writers: ["ShiftManagement.tsx"],
    readers: ["AttendantPerformance.tsx", "TeamManager.tsx"],
    notes:
      "Shift Management is the employee editor; Attendant Performance reads " +
      "the same shift_employees roster.",
  },
  {
    group: "Payroll",
    domain: "Payroll employees & settings",
    keys: ["payroll_employees", "payroll_settings", "payroll_column_names"],
    writers: ["PayrollSystem.tsx"],
    readers: ["PayrollSystem.tsx", "Commissions.tsx"],
    notes: "Payroll is the employee/payroll source of truth.",
  },
  {
    group: "News",
    domain: "Live-feed preferences",
    keys: [
      "live_feed_favorites",
      "live_feed_history",
      "live_feed_reminders",
      "live_feed_analytics",
      "live_feed_subtitle_lang",
      "news_bookmarks",
      "news_read",
    ],
    writers: ["LiveFeedEmbed.tsx", "News.tsx"],
    readers: ["LiveFeedEmbed.tsx", "News.tsx"],
    notes:
      "Favorites/history/reminders/subtitle language are shared between the " +
      "Live Channels, Live TV and Live Radio sub-tabs.",
  },
];
