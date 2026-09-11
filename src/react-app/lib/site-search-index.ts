/**
 * Universal site search index — every searchable target in the app.
 *
 * QuickSearch + AIChatbot search across FOUR categories:
 *  - Navigation (top-level tabs, resolved from the FuelContext registry)
 *  - Sub-tabs (every SubTabBar entry, statically indexed here)
 *  - Quick Actions (common operations that deep-link into a host sub-tab)
 *  - Movies & TV (live catalog search via the same-origin /api/movies proxy)
 *
 * Deep-linking goes through the existing navigateToTab/onTabPayload payload
 * bus — target hosts apply `payload.subTab` via useSubTabDeepLink().
 *
 * Security: this is a static, read-only registry of UI locations. It
 * contains no secrets and performs no data access — it only describes
 * where features live so search can route the user there.
 */

export interface SubTabEntry {
  /** Top-level host tab id (FuelContext registry id). */
  hostTab: string;
  /** The sub-tab id the host component expects. */
  subId: string;
  /** Human label. */
  label: string;
  /** Optional description shown in search results. */
  description?: string;
  /** Extra lowercase keywords that also match. */
  keywords?: string;
}

/** Every sub-tab in the site, grouped by host tab. */
export const SITE_SUBTABS: SubTabEntry[] = [
  // News / entertainment hub
  {
    hostTab: "news",
    subId: "articles",
    label: "News Articles",
    description: "Fuel industry news feed",
  },
  {
    hostTab: "news",
    subId: "movies",
    label: "Movies",
    description: "Streaming catalog — movies, series, documentaries",
    keywords: "film series tv shows watch cinema",
  },
  {
    hostTab: "news",
    subId: "live-tv",
    label: "Live TV",
    description: "1500+ live channels worldwide",
    keywords: "television channels broadcast",
  },
  {
    hostTab: "news",
    subId: "live-radio",
    label: "Live Radio",
    description: "4000+ live stations by genre",
    keywords: "radio stations audio",
  },

  // General Settings (host: settings)
  {
    hostTab: "settings",
    subId: "general",
    label: "General Settings",
    keywords: "station name timezone",
  },
  {
    hostTab: "settings",
    subId: "company",
    label: "Company Profile",
    keywords: "business bank tax",
  },
  {
    hostTab: "settings",
    subId: "tabs",
    label: "Tab Manager",
    keywords: "visibility hidden reorder",
  },
  {
    hostTab: "settings",
    subId: "modules",
    label: "Module Behavior",
    keywords: "pos invoice sales toggles",
  },
  {
    hostTab: "settings",
    subId: "api",
    label: "API & Backend",
    keywords: "endpoints health docs",
  },
  {
    hostTab: "settings",
    subId: "deployment",
    label: "Deployment",
    keywords: "status sync version",
  },
  {
    hostTab: "settings",
    subId: "features",
    label: "Feature Flags",
    keywords: "enable disable modules",
  },
  {
    hostTab: "settings",
    subId: "appearance",
    label: "Appearance",
    keywords: "theme color dark mode",
  },
  {
    hostTab: "settings",
    subId: "finance",
    label: "Tax & Finance",
    keywords: "vat currency rates",
  },
  {
    hostTab: "settings",
    subId: "integrations",
    label: "Integrations Config",
    keywords: "mpesa kopo kopo payhero",
  },
  {
    hostTab: "settings",
    subId: "automation",
    label: "Automation",
    keywords: "rules schedules",
  },
  {
    hostTab: "settings",
    subId: "security",
    label: "Security",
    keywords: "2fa session timeout password",
  },
  {
    hostTab: "settings",
    subId: "notifications",
    label: "Notifications",
    keywords: "alerts email sms",
  },
  {
    hostTab: "settings",
    subId: "system",
    label: "System",
    keywords: "storage cache diagnostics",
  },

  // Credit (host: credit)
  {
    hostTab: "credit",
    subId: "accounts",
    label: "Credit Accounts",
    keywords: "balances limits",
  },
  {
    hostTab: "credit",
    subId: "fleet",
    label: "Fleet & Cards",
    keywords: "fuel cards vehicles",
  },
  {
    hostTab: "credit",
    subId: "reminders",
    label: "Debt Payment Reminders",
    keywords: "overdue collection",
  },
  {
    hostTab: "credit",
    subId: "statements",
    label: "Statements",
    keywords: "account history",
  },
  {
    hostTab: "credit",
    subId: "portal",
    label: "Customer Portal",
    keywords: "share link",
  },
  {
    hostTab: "credit",
    subId: "aging",
    label: "Aging Report",
    keywords: "overdue days",
  },
  {
    hostTab: "credit",
    subId: "pricelists",
    label: "Price Lists",
    keywords: "custom pricing",
  },

  // Customers / Loyalty (host: customers)
  {
    hostTab: "customers",
    subId: "customers",
    label: "Customers",
    keywords: "loyalty members",
  },
  {
    hostTab: "customers",
    subId: "segments",
    label: "Segments & Events",
    keywords: "vip at-risk dormant",
  },
  {
    hostTab: "customers",
    subId: "promos",
    label: "Promotions",
    keywords: "discounts campaigns",
  },
  {
    hostTab: "customers",
    subId: "punchcards",
    label: "Punch Cards",
    keywords: "visits rewards",
  },
  {
    hostTab: "customers",
    subId: "history",
    label: "Purchase History",
    keywords: "customer transactions",
  },
  {
    hostTab: "customers",
    subId: "complaints",
    label: "Complaints",
    keywords: "feedback issues",
  },
  {
    hostTab: "customers",
    subId: "tiers",
    label: "Loyalty Tiers",
    keywords: "gold silver bronze",
  },

  // Documents (host: documents)
  {
    hostTab: "documents",
    subId: "documents",
    label: "Document Center",
    keywords: "files uploads",
  },
  {
    hostTab: "documents",
    subId: "converter",
    label: "Document Converter",
    keywords: "format convert",
  },

  // Fuel Price Finder (host: price-finder)
  {
    hostTab: "price-finder",
    subId: "finder",
    label: "Price Finder",
    keywords: "gps local prices",
  },
  {
    hostTab: "price-finder",
    subId: "auto",
    label: "Auto Fuel Price",
    keywords: "regional epra estimate",
  },

  // Fuel Sales Report (host: fuelsalesreport)
  {
    hostTab: "fuelsalesreport",
    subId: "report",
    label: "Monthly Report",
    keywords: "sales totals",
  },
  {
    hostTab: "fuelsalesreport",
    subId: "analysis",
    label: "Nozzle & Attendant",
    keywords: "pump performance",
  },
  {
    hostTab: "fuelsalesreport",
    subId: "vehicles",
    label: "Vehicle Sales",
    keywords: "fleet breakdown",
  },
  {
    hostTab: "fuelsalesreport",
    subId: "services",
    label: "Services",
    keywords: "wash lube extras",
  },
  {
    hostTab: "fuelsalesreport",
    subId: "payrecon",
    label: "Payment Reconciliation",
    keywords: "cash mpesa card",
  },
  {
    hostTab: "fuelsalesreport",
    subId: "mix",
    label: "Fuel Mix",
    keywords: "product share",
  },

  // Fuel Types (host: fueltypes)
  {
    hostTab: "fueltypes",
    subId: "fueltypes",
    label: "Fuel Types",
    keywords: "pms ago ik lpg vpower",
  },
  {
    hostTab: "fueltypes",
    subId: "priceboard",
    label: "Price Board",
    keywords: "current pump prices",
  },
  {
    hostTab: "fueltypes",
    subId: "scheduler",
    label: "Price Scheduler",
    keywords: "future price changes",
  },
  {
    hostTab: "fueltypes",
    subId: "ratehistory",
    label: "Rate History",
    keywords: "price log",
  },
  {
    hostTab: "fueltypes",
    subId: "quality",
    label: "Fuel Quality",
    keywords: "tests density",
  },

  // Invoice (host: invoice)
  {
    hostTab: "invoice",
    subId: "invoice",
    label: "Invoice Generator",
    keywords: "new create bill",
  },
  {
    hostTab: "invoice",
    subId: "sales-invoices",
    label: "Sales Invoices",
    keywords: "pos sales ledger",
  },

  // Point of Sale (host: pos)
  {
    hostTab: "pos",
    subId: "standard",
    label: "Standard POS",
    keywords: "quick sale cash",
  },
  {
    hostTab: "pos",
    subId: "enhanced",
    label: "Enhanced POS",
    keywords: "advanced checkout",
  },

  // Team Manager (host: team)
  {
    hostTab: "team",
    subId: "team",
    label: "Team Access",
    keywords: "members invites codes",
  },
  {
    hostTab: "team",
    subId: "roles",
    label: "Roles & Permissions",
    keywords: "feature access grants",
  },
  {
    hostTab: "team",
    subId: "shifts",
    label: "Shifts",
    keywords: "schedule employees",
  },
  {
    hostTab: "team",
    subId: "performance",
    label: "Performance",
    keywords: "attendant kpis",
  },
  {
    hostTab: "team",
    subId: "activity",
    label: "Activity & Health",
    keywords: "team metrics audit",
  },

  // Stock Management (host: inventory)
  {
    hostTab: "inventory",
    subId: "products",
    label: "Products",
    keywords: "catalog items",
  },
  {
    hostTab: "inventory",
    subId: "tankmonitor",
    label: "Tank Monitor",
    keywords: "atg levels water",
  },
  {
    hostTab: "inventory",
    subId: "telemetry",
    label: "Telemetry Ingest",
    keywords: "atg gps payloads",
  },
  {
    hostTab: "inventory",
    subId: "calibration",
    label: "Tank Calibration",
    keywords: "dip chart",
  },
  {
    hostTab: "inventory",
    subId: "adjustments",
    label: "Adjustments",
    keywords: "stock corrections",
  },
  {
    hostTab: "inventory",
    subId: "transfers",
    label: "Transfers",
    keywords: "stock moves",
  },
  {
    hostTab: "inventory",
    subId: "counts",
    label: "Stock Counts",
    keywords: "physical audit",
  },
  {
    hostTab: "inventory",
    subId: "wastage",
    label: "Wastage",
    keywords: "losses shrinkage",
  },
  {
    hostTab: "inventory",
    subId: "reorders",
    label: "Auto-Reorders",
    keywords: "low stock replenish",
  },
  {
    hostTab: "inventory",
    subId: "history",
    label: "History",
    keywords: "transactions ledger",
  },
  {
    hostTab: "inventory",
    subId: "movement",
    label: "Item Ledger",
    keywords: "per-item movement",
  },
  {
    hostTab: "inventory",
    subId: "valuation",
    label: "Valuation",
    keywords: "stock value",
  },
  {
    hostTab: "inventory",
    subId: "dipcalc",
    label: "Dip to Litres",
    keywords: "conversion",
  },
  {
    hostTab: "inventory",
    subId: "abc",
    label: "ABC Analysis",
    keywords: "pareto classes",
  },
  {
    hostTab: "inventory",
    subId: "meterproving",
    label: "Meter Proving",
    keywords: "pump calibration",
  },
  {
    hostTab: "inventory",
    subId: "enhanced",
    label: "Pro Inventory",
    keywords: "advanced stock",
  },

  // Suppliers (host: suppliers)
  {
    hostTab: "suppliers",
    subId: "suppliers",
    label: "Suppliers",
    keywords: "vendor directory",
  },
  {
    hostTab: "suppliers",
    subId: "orders",
    label: "Purchase Orders",
    keywords: "po procurement",
  },
  {
    hostTab: "suppliers",
    subId: "purchases",
    label: "Purchases",
    keywords: "bills receipts",
  },
  {
    hostTab: "suppliers",
    subId: "contracts",
    label: "Contracts",
    keywords: "agreements",
  },
  {
    hostTab: "suppliers",
    subId: "scorecard",
    label: "Scorecard",
    keywords: "vendor rating",
  },

  // Analytics (host: analytics)
  {
    hostTab: "analytics",
    subId: "analytics",
    label: "Analytics",
    keywords: "trends kpis",
  },
  {
    hostTab: "analytics",
    subId: "enhanced",
    label: "Enhanced Dashboard",
    keywords: "deep insights",
  },
];

/** Quick actions — common operations, deep-linked into host sub-tabs. */
export interface QuickActionEntry {
  label: string;
  description: string;
  hostTab: string;
  subId?: string;
  keywords?: string;
}

export const SITE_ACTIONS: QuickActionEntry[] = [
  {
    label: "New Sale / POS Checkout",
    description: "Open the point of sale",
    hostTab: "pos",
    keywords: "sell checkout cart",
  },
  {
    label: "New Invoice",
    description: "Create a customer invoice",
    hostTab: "invoice",
    subId: "invoice",
    keywords: "bill customer",
  },
  {
    label: "Collect via M-PESA (STK Push)",
    description: "Send an STK push",
    hostTab: "livetransaction",
    keywords: "payment collect phone",
  },
  {
    label: "Add Employee",
    description: "Team roster",
    hostTab: "team",
    subId: "shifts",
    keywords: "staff hire",
  },
  {
    label: "Add Customer",
    description: "Loyalty register",
    hostTab: "customers",
    keywords: "member register",
  },
  {
    label: "New Expense",
    description: "Record a cost",
    hostTab: "expenses",
    keywords: "cost spend",
  },
  {
    label: "New Supplier",
    description: "Vendor directory",
    hostTab: "suppliers",
    keywords: "vendor add",
  },
  {
    label: "Create Purchase Order",
    description: "Restock products",
    hostTab: "inventory",
    subId: "reorders",
    keywords: "po restock",
  },
  {
    label: "Record Maintenance",
    description: "Equipment service",
    hostTab: "maintenance",
    keywords: "repair service",
  },
  {
    label: "Record Offloading",
    description: "Fuel received",
    hostTab: "offloading",
    keywords: "delivery truck",
  },
  {
    label: "Edit Fuel Prices",
    description: "Price Board",
    hostTab: "fueltypes",
    subId: "priceboard",
    keywords: "change price",
  },
  {
    label: "Watch Movies",
    description: "Streaming catalog",
    hostTab: "news",
    subId: "movies",
    keywords: "play film series",
  },
  {
    label: "Open Live TV",
    description: "Live channels",
    hostTab: "news",
    subId: "live-tv",
    keywords: "television channels",
  },
  {
    label: "Payroll & Payslips",
    description: "Employees + payslip delivery",
    hostTab: "payroll",
    keywords: "salary wages",
  },
  {
    label: "Credit Accounts",
    description: "Customer credit",
    hostTab: "credit",
    subId: "accounts",
    keywords: "debt limit",
  },
  {
    label: "Settings",
    description: "Station configuration",
    hostTab: "settings",
    keywords: "configure preferences",
  },
];

/** Match sub-tabs against a query. Ranked by label > keywords > description. */
export function searchSubTabs(query: string, limit = 8): SubTabEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = SITE_SUBTABS.filter((e) => {
    const label = e.label.toLowerCase();
    const keywords = (e.keywords || "").toLowerCase();
    const description = (e.description || "").toLowerCase();
    return label.includes(q) || keywords.includes(q) || description.includes(q);
  }).map((e) => {
    const label = e.label.toLowerCase();
    const keywords = (e.keywords || "").toLowerCase();
    const description = (e.description || "").toLowerCase();
    let score = 0;
    if (label.startsWith(q)) score += 100;
    else if (label.includes(q)) score += 50;
    if (keywords.includes(q)) score += 20;
    if (description && description.includes(q)) score += 10;
    return { e, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.e);
}

/** Match quick actions against a query. */
export function searchActions(query: string, limit = 5): QuickActionEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = SITE_ACTIONS.filter((a) => {
    const hay = `${a.label} ${a.description} ${a.keywords || ""}`.toLowerCase();
    return hay.includes(q);
  });
  return hits.slice(0, limit);
}
