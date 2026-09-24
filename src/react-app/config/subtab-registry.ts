import { NAVIGATION_MODULE_TO_WORKSPACE } from "@/react-app/config/navigation-config";

/**
 * Canonical sub-tab registry.
 *
 * `navigation-config.ts` owns the top-level hierarchy (Workspace -> Module).
 * This file owns the level below it: every internal view a module renders,
 * and the id the host must accept for a deep link to land on that view.
 *
 * Why it exists: sub-tab ids were declared inline in ~20 components, so three
 * things had silently drifted apart —
 *   1. the search index covered only 10 hosts, so Compliance was completely
 *      undiscoverable and newer sub-tabs (Quotations, Teams, Leave, Loyalty
 *      Tiers, Punch Cards, Hardware, Call Center, …) could not be searched;
 *   2. only 13 hosts registered `useSubTabDeepLink`, so a search result could
 *      navigate to a tab that had no idea what to do with the payload;
 *   3. ids are case- and spelling-sensitive with no build-time check, so a
 *      rename in a component would quietly break search routing.
 *
 * The ids and labels below were extracted from the components themselves, and
 * `subtab-registry.test.ts` re-extracts them on every run: the registry fails
 * CI the moment it and the UI disagree in either direction.
 */

export interface SubTabDefinition {
  /** The id the host component's tab control uses. */
  id: string;
  /** Human label, matching the rendered tab. */
  label: string;
  /** Optional one-line description surfaced in search results. */
  description?: string;
  /** Extra lowercase keywords that also match in search. */
  keywords?: string;
}

export interface SubTabHost {
  /** Top-level tab id (FuelContext registry id). */
  hostTab: string;
  /**
   * How the host renders its internal navigation. `subtabbar` hosts render
   * <SubTabBar>, `buttons` hosts render an inline button row. Both accept the
   * same deep-link payload; the distinction is documentation only.
   */
  kind: "subtabbar" | "buttons";
  subTabs: SubTabDefinition[];
}

export const SUBTAB_REGISTRY: SubTabHost[] = [
  // ── SubTabBar hosts ──────────────────────────────────────────────────────
  {
    hostTab: "news",
    kind: "subtabbar",
    subTabs: [
      {
        id: "articles",
        label: "News Articles",
        description: "Fuel industry news feed",
        keywords: "headlines press market",
      },
      {
        id: "movies",
        label: "Movies",
        description: "Streaming catalog — movies, series, documentaries",
        keywords: "film series tv shows watch cinema",
      },
      {
        id: "live-tv",
        label: "Live TV",
        description: "Live television channels worldwide",
        keywords: "television channels broadcast stream",
      },
      {
        id: "live-radio",
        label: "Live Radio",
        description: "Live radio stations by genre",
        keywords: "radio stations audio music",
      },
    ],
  },
  {
    hostTab: "settings",
    kind: "subtabbar",
    subTabs: [
      { id: "general", label: "General", keywords: "station name timezone" },
      { id: "company", label: "Company Profile", keywords: "logo bank tax" },
      { id: "tabs", label: "Tab Manager", keywords: "layout navigation order" },
      { id: "modules", label: "Module Behavior" },
      { id: "api", label: "API & Backend" },
      { id: "deployment", label: "Deployment" },
      { id: "features", label: "Features", keywords: "feature flags" },
      { id: "appearance", label: "Appearance", keywords: "theme zoom colour" },
      { id: "finance", label: "Tax & Finance", keywords: "currency vat" },
      { id: "domain", label: "Domain" },
      { id: "docs", label: "Invoices & Quotes" },
      { id: "notify", label: "Notify Customers" },
      { id: "roles", label: "Roles & Access", keywords: "permission" },
      { id: "documents", label: "Documents" },
      { id: "integrations", label: "Integrations" },
      { id: "automation", label: "Automation" },
      { id: "security", label: "Security", keywords: "2fa password session" },
      { id: "notifications", label: "Notifications" },
      { id: "system", label: "System" },
    ],
  },
  {
    hostTab: "invoice",
    kind: "subtabbar",
    subTabs: [
      { id: "invoice", label: "Invoice", keywords: "bill customer" },
      { id: "sales-invoices", label: "Sales Invoices", keywords: "pos ledger" },
      { id: "quotations", label: "Quotations", keywords: "quote estimate" },
    ],
  },
  {
    hostTab: "credit",
    kind: "subtabbar",
    subTabs: [
      { id: "accounts", label: "Credit Accounts" },
      { id: "reminders", label: "Debt Payment Reminders" },
      { id: "aging", label: "Aging", keywords: "overdue buckets" },
      { id: "statements", label: "Statements" },
      { id: "portal", label: "Customer Portal" },
      { id: "pricelists", label: "Price Lists", keywords: "contract price" },
      { id: "fleet", label: "Fleet & Cards", keywords: "fuel card vehicle" },
    ],
  },
  {
    hostTab: "customers",
    kind: "subtabbar",
    subTabs: [
      { id: "customers", label: "Customers", keywords: "loyalty member" },
      { id: "segments", label: "Segments & Events", keywords: "tier churn" },
      { id: "promos", label: "Promotions" },
      { id: "punchcards", label: "Punch Cards" },
      { id: "history", label: "Purchase History" },
      { id: "complaints", label: "Complaints", keywords: "feedback issue" },
      { id: "tiers", label: "Loyalty Tiers" },
    ],
  },
  {
    hostTab: "inventory",
    kind: "subtabbar",
    subTabs: [
      { id: "products", label: "Products", keywords: "catalog item" },
      { id: "adjustments", label: "Adjustments" },
      { id: "transfers", label: "Transfers" },
      { id: "counts", label: "Counts", keywords: "stocktake" },
      { id: "wastage", label: "Wastage" },
      { id: "reorders", label: "Auto-Reorders" },
      { id: "history", label: "History" },
      { id: "tankmonitor", label: "Tank Monitor", keywords: "atg dip level" },
      { id: "telemetry", label: "Telemetry Ingest" },
      { id: "calibration", label: "Calibration" },
      { id: "dipcalc", label: "Dip to Litres" },
      { id: "abc", label: "ABC Analysis", keywords: "pareto" },
      { id: "meterproving", label: "Meter Proving" },
      { id: "movement", label: "Item Ledger" },
      { id: "valuation", label: "Valuation", keywords: "fifo stock value" },
      { id: "enhanced", label: "Pro Inventory" },
    ],
  },
  {
    hostTab: "fuelsalesreport",
    kind: "subtabbar",
    subTabs: [
      { id: "report", label: "Report" },
      { id: "analysis", label: "Nozzle & Attendant" },
      { id: "mix", label: "Fuel Mix" },
      { id: "vehicles", label: "Vehicle Sales" },
      { id: "services", label: "Services", keywords: "car wash" },
      { id: "payrecon", label: "Payment Recon" },
    ],
  },
  {
    hostTab: "fueltypes",
    kind: "subtabbar",
    subTabs: [
      { id: "fueltypes", label: "Fuel Types", keywords: "pump setup" },
      { id: "priceboard", label: "Price Board" },
      { id: "scheduler", label: "Price Scheduler" },
      { id: "ratehistory", label: "Rate History" },
      { id: "quality", label: "Fuel Quality", keywords: "testing" },
    ],
  },
  {
    hostTab: "price-finder",
    kind: "subtabbar",
    subTabs: [
      { id: "finder", label: "Nearby Prices", keywords: "gps locator" },
      { id: "auto", label: "Auto Fuel Price" },
    ],
  },
  {
    hostTab: "documents",
    kind: "subtabbar",
    subTabs: [
      { id: "documents", label: "Documents" },
      { id: "converter", label: "Document Converter" },
    ],
  },
  {
    hostTab: "webstudio",
    kind: "buttons",
    subTabs: [
      {
        id: "mini",
        label: "Mini Site",
        description: "Publish a public website for this station",
        keywords: "website public site domain share publish microsite",
      },
      {
        id: "site",
        label: "Site",
        description: "Web Studio site configuration",
        keywords: "branding tagline",
      },
      {
        id: "blog",
        label: "Blog",
        description: "Web Studio news posts",
        keywords: "articles posts",
      },
    ],
  },
  {
    hostTab: "analytics",
    kind: "subtabbar",
    subTabs: [
      { id: "analytics", label: "Analytics" },
      { id: "enhanced", label: "Enhanced Dashboard" },
    ],
  },
  {
    hostTab: "pos",
    kind: "subtabbar",
    subTabs: [
      { id: "standard", label: "Standard POS" },
      { id: "enhanced", label: "Enhanced POS", keywords: "hardware reader" },
    ],
  },
  {
    hostTab: "team",
    kind: "subtabbar",
    subTabs: [
      { id: "team", label: "Team Access", keywords: "members invites" },
      { id: "roles", label: "Roles & Permissions" },
      { id: "teams", label: "Teams" },
      { id: "shifts", label: "Shifts", keywords: "roster schedule" },
      { id: "leave", label: "Leave", keywords: "absence holiday" },
      { id: "performance", label: "Performance", keywords: "kpi attendant" },
      { id: "activity", label: "Activity & Health" },
    ],
  },
  {
    hostTab: "regional",
    kind: "subtabbar",
    subTabs: [
      { id: "rules", label: "Country Rules", keywords: "regulation permit" },
      { id: "documents", label: "My Documents", keywords: "upload expiry" },
      {
        id: "safety",
        label: "Safety & HSSE",
        keywords: "incident permit work",
      },
    ],
  },

  // ── Inline button-row hosts ──────────────────────────────────────────────
  {
    hostTab: "suppliers",
    kind: "buttons",
    subTabs: [
      { id: "suppliers", label: "Suppliers" },
      { id: "orders", label: "Purchase Orders" },
      { id: "purchases", label: "Purchases" },
      { id: "contracts", label: "Contracts", keywords: "agreement" },
      { id: "scorecard", label: "Scorecard", keywords: "performance" },
    ],
  },
  {
    hostTab: "expenses",
    kind: "buttons",
    subTabs: [
      { id: "list", label: "Records" },
      { id: "analytics", label: "Analytics", keywords: "budget trend" },
    ],
  },
  {
    hostTab: "payroll",
    kind: "buttons",
    subTabs: [
      { id: "employees", label: "Employees" },
      { id: "payslip", label: "Payslips" },
      { id: "commissions", label: "Commissions" },
      { id: "settings", label: "Settings" },
      { id: "advances", label: "Advances", keywords: "loan" },
    ],
  },
  {
    hostTab: "communication",
    kind: "buttons",
    subTabs: [
      { id: "contacts", label: "Contacts" },
      { id: "messages", label: "Messages" },
      { id: "templates", label: "Templates" },
      { id: "calls", label: "Call Center" },
      { id: "complaints", label: "Complaints" },
      { id: "settings", label: "Settings" },
    ],
  },
  {
    hostTab: "integration",
    kind: "buttons",
    subTabs: [
      { id: "connectors", label: "Connectors" },
      { id: "webhooks", label: "Webhooks" },
      { id: "apikeys", label: "API Keys" },
      { id: "hardware", label: "Hardware", keywords: "dispenser atg" },
      { id: "logs", label: "Logs" },
      { id: "payment-setup", label: "Payment Setup", keywords: "mpesa" },
    ],
  },
  {
    hostTab: "data",
    kind: "buttons",
    subTabs: [
      { id: "overview", label: "Overview" },
      { id: "storage", label: "Storage & Egress", keywords: "compression" },
      { id: "diagnostics", label: "Cloud Diagnostics" },
      { id: "recovery", label: "Recovery", keywords: "restore" },
      { id: "backup", label: "Backup" },
      { id: "cloud", label: "Cloud Sync" },
      { id: "sync", label: "Cross-Device" },
    ],
  },
];

/** Flat list of every internal view, tagged with its host. */
export const SUBTAB_ENTRIES: Array<SubTabDefinition & { hostTab: string }> =
  SUBTAB_REGISTRY.flatMap((host) =>
    host.subTabs.map((sub) => ({ ...sub, hostTab: host.hostTab })),
  );

/** Every host that publishes internal views, deduped in registry order. */
export const SUBTAB_HOSTS: string[] = [
  ...new Set(SUBTAB_REGISTRY.map((h) => h.hostTab)),
];

/** The workspace id that owns a host tab (for grouped search results). */
export function workspaceForHost(hostTab: string): string | undefined {
  return NAVIGATION_MODULE_TO_WORKSPACE[hostTab];
}

/** Look up a single sub-tab definition. */
export function findSubTab(
  hostTab: string,
  subId: string,
): SubTabDefinition | undefined {
  return SUBTAB_REGISTRY.find((h) => h.hostTab === hostTab)?.subTabs.find(
    (s) => s.id === subId,
  );
}
