export type WorkflowStage = "review" | "operate" | "reconcile" | "configure";

export type FeatureContract = {
  id: string;
  purpose: string;
  primaryAction: string;
  subTabs?: string[];
  dataBoundary:
    "station" | "user" | "transaction" | "finance" | "content" | "system";
  supportsOffline?: boolean;
  searchable?: boolean;
  workspace?: string;
  searchAliases?: string[];
  mobilePriority?: "primary" | "secondary" | "utility";
  offlineMode?: "full" | "read-only" | "none";
  workflowStage?: WorkflowStage;
  relatedModules?: string[];
  dataSharing?: string[];
};

const F = (
  id: string,
  workspace: string,
  purpose: string,
  primaryAction: string,
  dataBoundary: FeatureContract["dataBoundary"],
  extra: Partial<FeatureContract> = {},
): FeatureContract => ({
  id,
  workspace,
  purpose,
  primaryAction,
  dataBoundary,
  searchable: true,
  mobilePriority: "secondary",
  offlineMode: "read-only",
  workflowStage: "review",
  ...extra,
});

export const FEATURE_REGISTRY: FeatureContract[] = [
  F(
    "dashboard",
    "home",
    "Station command center",
    "Review station status",
    "station",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      workflowStage: "review",
      relatedModules: ["sales", "inventory", "analytics"],
      dataSharing: ["station status", "sales", "stock", "alerts"],
    },
  ),
  F(
    "reports",
    "home",
    "Operational and financial reporting",
    "Run report",
    "station",
    {
      workflowStage: "reconcile",
      relatedModules: ["analytics", "audit"],
      dataSharing: ["sales", "inventory", "finance", "audit"],
    },
  ),
  F(
    "analytics",
    "home",
    "Performance trends and KPIs",
    "Inspect KPI trend",
    "station",
    {
      workflowStage: "review",
      relatedModules: ["reports", "sales", "inventory"],
      dataSharing: ["sales", "stock", "finance", "operations"],
    },
  ),
  F(
    "pos",
    "forecourt",
    "Create and settle fuel sales",
    "Start sale",
    "transaction",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "operate",
      relatedModules: ["livetransaction", "sales", "mpesa"],
      dataSharing: ["pump mapping", "fuel prices", "customer", "payment"],
    },
  ),
  F(
    "livetransaction",
    "forecourt",
    "Monitor payment and transaction state",
    "Open live transactions",
    "transaction",
    {
      mobilePriority: "primary",
      supportsOffline: true,
      workflowStage: "reconcile",
      relatedModules: ["pos", "mpesa", "credit"],
      dataSharing: ["sale", "payment", "M-PESA receipt"],
    },
  ),
  F(
    "sales",
    "forecourt",
    "Review sales ledger",
    "Review sales",
    "transaction",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "reconcile",
      relatedModules: ["pos", "fuelsalesreport", "reports"],
      dataSharing: ["sales ledger", "pump", "fuel price", "payment"],
    },
  ),
  F(
    "pumpmapping",
    "forecourt",
    "Map pumps, nozzles and fuel products",
    "Manage pump mapping",
    "station",
    {
      workflowStage: "configure",
      relatedModules: ["fueltypes", "pos", "inventory"],
      dataSharing: ["pumps", "nozzles", "fuel products", "prices"],
    },
  ),
  F(
    "inventory",
    "stock-supply",
    "Track stock and tank movements",
    "Record stock movement",
    "station",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "operate",
      relatedModules: ["offloading", "delivery", "suppliers"],
      dataSharing: ["tanks", "deliveries", "sales", "movements"],
    },
  ),
  F(
    "offloading",
    "stock-supply",
    "Record fuel deliveries/offloading",
    "Record offloading",
    "transaction",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "operate",
      relatedModules: ["inventory", "delivery", "suppliers"],
      dataSharing: ["supplier", "delivery", "tank", "meter"],
    },
  ),
  F(
    "delivery",
    "stock-supply",
    "Reconcile supplier deliveries",
    "Review delivery",
    "transaction",
    {
      workflowStage: "reconcile",
      relatedModules: ["offloading", "inventory", "suppliers"],
      dataSharing: ["delivery", "supplier", "invoice", "stock"],
    },
  ),
  F(
    "suppliers",
    "stock-supply",
    "Manage fuel and service suppliers",
    "Add supplier",
    "station",
    {
      workflowStage: "configure",
      relatedModules: ["delivery", "offloading", "maintenance"],
      dataSharing: ["supplier", "contacts", "deliveries"],
    },
  ),
  F(
    "price-finder",
    "stock-supply",
    "Reference current fuel pricing",
    "Find price",
    "station",
    {
      mobilePriority: "utility",
      relatedModules: ["fueltypes", "pumpmapping", "pos"],
      dataSharing: ["fuel price", "market reference"],
    },
  ),
  F(
    "maintenance",
    "stock-supply",
    "Track equipment maintenance",
    "Create maintenance task",
    "station",
    {
      workflowStage: "operate",
      supportsOffline: true,
      offlineMode: "full",
      relatedModules: ["pumpmapping", "inventory"],
      dataSharing: ["equipment", "tasks", "parts"],
    },
  ),
  F(
    "customers",
    "sales-payments",
    "Manage customer accounts and loyalty",
    "Open customer",
    "station",
    {
      relatedModules: ["credit", "invoice", "sales"],
      dataSharing: ["customer", "sales", "credit"],
    },
  ),
  F(
    "invoice",
    "sales-payments",
    "Create and manage invoices",
    "Create invoice",
    "transaction",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "operate",
      relatedModules: ["customers", "credit", "sales"],
      dataSharing: ["customer", "sale", "tax", "payment"],
    },
  ),
  F(
    "credit",
    "sales-payments",
    "Manage customer credit ledger",
    "Open credit account",
    "finance",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "reconcile",
      relatedModules: ["customers", "invoice", "livetransaction"],
      dataSharing: ["customer", "credit ledger", "payments", "debt"],
    },
  ),
  F(
    "mpesa",
    "sales-payments",
    "Reconcile M-PESA payments",
    "Open M-PESA",
    "finance",
    {
      mobilePriority: "primary",
      workflowStage: "reconcile",
      relatedModules: ["livetransaction", "credit", "invoice"],
      dataSharing: ["M-PESA statement", "STK", "receipt", "sale"],
    },
  ),
  F(
    "fuelsalesreport",
    "sales-payments",
    "Analyze fuel sales by product and period",
    "Run fuel sales report",
    "transaction",
    {
      workflowStage: "reconcile",
      relatedModules: ["sales", "analytics", "reports"],
      dataSharing: ["sales", "fuel product", "period"],
    },
  ),
  F(
    "team",
    "people",
    "Manage people, access and workforce",
    "Review team access",
    "station",
    {
      mobilePriority: "primary",
      subTabs: [
        "Team Access",
        "Roles & Permissions",
        "Teams",
        "Shifts",
        "Leave",
        "Performance",
        "Activity & Health",
      ],
      relatedModules: ["payroll", "projtime", "communication"],
      dataSharing: ["members", "roles", "permissions", "shifts", "pumps"],
    },
  ),
  F(
    "payroll",
    "people",
    "Manage payroll records",
    "Review payroll",
    "finance",
    {
      workflowStage: "reconcile",
      relatedModules: ["team", "expenses"],
      dataSharing: ["team", "attendance", "payroll"],
    },
  ),
  F("projtime", "people", "Track projects and time", "Log time", "user", {
    offlineMode: "full",
    supportsOffline: true,
    workflowStage: "operate",
    relatedModules: ["team", "payroll"],
    dataSharing: ["team", "time", "projects"],
  }),
  F(
    "communication",
    "people",
    "Manage staff communication",
    "Send message",
    "station",
    {
      mobilePriority: "utility",
      offlineMode: "full",
      workflowStage: "operate",
      relatedModules: ["team", "news"],
      dataSharing: ["team", "announcements"],
    },
  ),
  F(
    "expenses",
    "finance",
    "Record and review station expenses",
    "Record expense",
    "finance",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "operate",
      relatedModules: ["reports", "audit", "payroll"],
      dataSharing: ["expense", "supplier", "payment"],
    },
  ),
  F(
    "regional",
    "finance",
    "Compliance and regional controls",
    "Review compliance",
    "station",
    {
      workflowStage: "configure",
      relatedModules: ["documents", "settings", "audit"],
      dataSharing: ["permits", "licenses", "expiry"],
    },
  ),
  F(
    "audit",
    "finance",
    "Immutable operational audit trail",
    "Review audit events",
    "station",
    {
      workflowStage: "reconcile",
      relatedModules: ["reports", "team", "settings"],
      dataSharing: ["audit events", "actor", "resource"],
    },
  ),
  F(
    "documents",
    "business",
    "Store and retrieve station documents",
    "Upload document",
    "content",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      supportsOffline: true,
      workflowStage: "operate",
      relatedModules: ["agreements", "regional", "settings"],
      dataSharing: ["files", "permits", "agreements"],
    },
  ),
  F(
    "agreements",
    "business",
    "Manage business agreements",
    "Open agreement",
    "content",
    {
      workflowStage: "reconcile",
      relatedModules: ["documents", "regional"],
      dataSharing: ["contracts", "documents", "expiry"],
    },
  ),
  F(
    "webstudio",
    "business",
    "Manage public website content",
    "Edit site",
    "content",
    {
      workflowStage: "configure",
      offlineMode: "full",
      relatedModules: ["documents", "news", "settings"],
      dataSharing: ["branding", "content", "public site"],
    },
  ),
  F(
    "news",
    "business",
    "Manage station news and media",
    "Publish update",
    "content",
    {
      mobilePriority: "utility",
      offlineMode: "full",
      workflowStage: "operate",
      relatedModules: ["communication", "webstudio"],
      dataSharing: ["announcements", "media"],
    },
  ),
  F(
    "integration",
    "connected",
    "Connect external services",
    "Test integration",
    "system",
    {
      workflowStage: "configure",
      relatedModules: ["automation", "terminal", "mpesa"],
      dataSharing: ["provider credentials", "connection status"],
    },
  ),
  F(
    "automation",
    "connected",
    "Manage scheduled and event automations",
    "Review automations",
    "system",
    {
      workflowStage: "configure",
      relatedModules: ["integration", "reports"],
      dataSharing: ["jobs", "events", "actions"],
    },
  ),
  F(
    "terminal",
    "connected",
    "Manage station terminal sessions",
    "Open terminal session",
    "system",
    {
      mobilePriority: "utility",
      workflowStage: "operate",
      relatedModules: ["integration", "pos"],
      dataSharing: ["device session", "terminal state"],
    },
  ),
  F(
    "fueltypes",
    "administration",
    "Configure fuel products and pricing rules",
    "Manage fuel type",
    "station",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      workflowStage: "configure",
      relatedModules: ["pumpmapping", "price-finder", "pos"],
      dataSharing: ["fuel types", "prices", "scheduler", "quality"],
    },
  ),
  F(
    "data",
    "administration",
    "Manage data import, export and recovery",
    "Open data tools",
    "system",
    {
      workflowStage: "configure",
      offlineMode: "full",
      relatedModules: ["documents", "audit", "settings"],
      dataSharing: ["backup", "export", "import"],
    },
  ),
  F(
    "subscription",
    "administration",
    "Manage FuelPro subscription",
    "Review subscription",
    "system",
    {
      mobilePriority: "utility",
      relatedModules: ["settings"],
      dataSharing: ["plan", "billing", "payment"],
    },
  ),
  F(
    "settings",
    "administration",
    "Manage station and account settings",
    "Open settings",
    "system",
    {
      mobilePriority: "primary",
      offlineMode: "full",
      workflowStage: "configure",
      relatedModules: ["fueltypes", "regional", "documents"],
      dataSharing: ["station profile", "branding", "tax", "preferences"],
    },
  ),
  F(
    "videogames",
    "utilities",
    "Optional station entertainment",
    "Open games",
    "content",
    {
      mobilePriority: "utility",
      relatedModules: ["news"],
      dataSharing: ["media"],
    },
  ),
];

export const FEATURE_BY_ID: Record<string, FeatureContract> =
  Object.fromEntries(FEATURE_REGISTRY.map((feature) => [feature.id, feature]));
export function getFeatureContract(id: string): FeatureContract | undefined {
  return FEATURE_BY_ID[id];
}
export function getWorkspaceModules(workspaceId: string): FeatureContract[] {
  return FEATURE_REGISTRY.filter(
    (feature) => feature.workspace === workspaceId,
  );
}
