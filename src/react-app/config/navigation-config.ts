/**
 * FuelPro canonical information architecture.
 *
 * This registry is the single source of truth for workspace/module grouping.
 * Existing module IDs are deliberately preserved so navigation reorganization
 * never requires destructive route or data migrations.
 *
 * Hierarchy:
 *   Workspace -> Module -> module-owned SubTabBar -> contextual actions
 *
 * Rule: a new feature should normally be placed inside an existing module
 * before a new workspace/module is introduced.
 *
 * Ordering principle (modules and sub-tabs alike): what an attendant or
 * manager does every shift comes first, then periodic work, then reporting,
 * then configuration. The first module is where a workspace lands when its
 * tab is clicked, so it should be the busiest screen, e.g. Fuel Offloading
 * (daily) ahead of Stock Management (weekly), Invoice and M-PESA (every sale)
 * ahead of the monthly Fuel Sales Report.
 */
export interface NavigationWorkspace {
  id: string;
  label: string;
  description: string;
  modules: string[];
}

export const NAVIGATION_WORKSPACES: NavigationWorkspace[] = [
  {
    id: "home",
    label: "Home",
    description: "Start here: monitor the station, reports and performance.",
    modules: ["dashboard", "reports", "analytics"],
  },
  {
    id: "forecourt",
    label: "Forecourt",
    description: "Run pumps, sales, shifts and live station operations.",
    modules: ["pos", "sales", "livetransaction", "pumpmapping"],
  },
  {
    id: "stock-supply",
    label: "Stock & Supply",
    description:
      "Manage fuel, tanks, deliveries, suppliers, prices and equipment.",
    modules: [
      "offloading",
      "delivery",
      "inventory",
      "suppliers",
      "price-finder",
      "maintenance",
    ],
  },
  {
    id: "sales-payments",
    label: "Sales & Payments",
    description: "Manage customers, sales, invoices, credit and payments.",
    modules: ["invoice", "mpesa", "credit", "customers", "fuelsalesreport"],
  },
  {
    id: "people",
    label: "People",
    description: "Manage staff, shifts, payroll, projects and communication.",
    modules: ["team", "payroll", "projtime", "communication"],
  },
  {
    id: "finance",
    label: "Finance & Control",
    description:
      "Control expenses, compliance, audit and financial governance.",
    modules: ["expenses", "regional", "audit"],
  },
  {
    id: "business",
    label: "Documents & Business",
    description: "Manage documents, agreements, web content and news.",
    modules: ["documents", "agreements", "webstudio", "news"],
  },
  {
    id: "connected",
    label: "Connected Systems",
    description: "Connect external services, automation and station devices.",
    modules: ["integration", "automation", "terminal"],
  },
  {
    id: "administration",
    label: "Administration",
    description:
      "Configure the station, data, subscription and system preferences.",
    modules: ["fueltypes", "data", "subscription", "settings"],
  },
  {
    id: "utilities",
    label: "Utilities",
    description: "Optional entertainment and secondary tools.",
    modules: ["videogames"],
  },
];

export const NAVIGATION_MODULE_TO_WORKSPACE = Object.fromEntries(
  NAVIGATION_WORKSPACES.flatMap((workspace) =>
    workspace.modules.map((moduleId) => [moduleId, workspace.id]),
  ),
) as Record<string, string>;

export const NAVIGATION_LEGACY_ALIASES: Record<string, string> = {
  shifts: "team",
  quality: "regional",
  priceboard: "price-finder",
  "sales-invoices": "invoice",
  "integrations-settings": "integration",
  products: "inventory",
};

export const NAVIGATION_WORKSPACE_ORDER = NAVIGATION_WORKSPACES.map(
  (workspace) => workspace.id,
);
