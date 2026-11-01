/**
 * Sub-tab groups.
 *
 * Modules with many sub-tabs (Settings 19, Stock 16, Customers 8, …) used to
 * render one long horizontally-scrolling strip with the scrollbar hidden, so
 * anything past the right edge was effectively invisible. Related tabs are now
 * collected under short group headings and the strip wraps instead of
 * scrolling, so every tab is on screen at once and sits next to its relatives.
 *
 * Groups only affect presentation. Tab ids/labels still come from the host
 * component (and are validated against `subtab-registry.ts`), so deep links and
 * search are unaffected. Tabs without an entry fall into an unlabeled group.
 * Group order follows the order of first appearance in the host's tab list.
 */
export const SUBTAB_GROUPS: Record<string, Record<string, string>> = {
  settings: {
    general: "Station",
    company: "Station",
    finance: "Station",
    docs: "Station",
    documents: "Station",
    domain: "Station",
    roles: "Access & alerts",
    security: "Access & alerts",
    notifications: "Access & alerts",
    notify: "Access & alerts",
    appearance: "Look & layout",
    tabs: "Look & layout",
    modules: "Look & layout",
    features: "Look & layout",
    integrations: "Connections",
    api: "Connections",
    automation: "Connections",
    deployment: "Connections",
    system: "System",
  },
  credit: {
    accounts: "Accounts",
    reminders: "Collections",
    aging: "Collections",
    statements: "Collections",
    portal: "Customer-facing",
    pricelists: "Customer-facing",
    fleet: "Customer-facing",
  },
  customers: {
    customers: "People",
    history: "People",
    segments: "People",
    tiers: "Rewards",
    punchcards: "Rewards",
    promos: "Rewards",
    complaints: "Service",
    stationpage: "Service",
  },
  fuelsalesreport: {
    report: "Sales",
    analysis: "Sales",
    mix: "Sales",
    vehicles: "Customers & services",
    services: "Customers & services",
    payrecon: "Reconciliation",
  },
  team: {
    team: "People",
    roles: "People",
    teams: "People",
    shifts: "Scheduling",
    leave: "Scheduling",
    performance: "Insights",
    activity: "Insights",
  },
  data: {
    overview: "Overview",
    backup: "Protect",
    recovery: "Protect",
    sync: "Sync",
    cloud: "Sync",
    storage: "Sync",
    diagnostics: "Diagnostics",
  },
  integration: {
    "payment-setup": "Set up",
    connectors: "Set up",
    hardware: "Set up",
    webhooks: "Developers",
    apikeys: "Developers",
    logs: "Developers",
  },
  inventory: {
    products: "Stock",
    adjustments: "Stock",
    transfers: "Stock",
    counts: "Stock",
    wastage: "Stock",
    reorders: "Stock",
    tankmonitor: "Tanks & meters",
    dipcalc: "Tanks & meters",
    calibration: "Tanks & meters",
    meterproving: "Tanks & meters",
    telemetry: "Tanks & meters",
    history: "Reports",
    movement: "Reports",
    valuation: "Reports",
    abc: "Reports",
    enhanced: "Reports",
  },
};

export function groupFor(host: string | undefined, id: string): string {
  return (host && SUBTAB_GROUPS[host]?.[id]) || "";
}
