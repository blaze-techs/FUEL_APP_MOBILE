import { NAVIGATION_WORKSPACES } from "@/react-app/config/navigation-config";
import { SUBTAB_ENTRIES } from "@/react-app/config/subtab-registry";

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

/** Canonical workspace/module targets derived from the real navigation registry. */
export const SITE_NAVIGATION: SubTabEntry[] = NAVIGATION_WORKSPACES.flatMap(
  (workspace) =>
    workspace.modules.map((moduleId) => ({
      hostTab: moduleId,
      subId: "",
      label: moduleId,
      description: workspace.description,
      keywords: workspace.label,
    })),
);

/**
 * Every internal view in the site, derived from the canonical sub-tab
 * registry.
 *
 * This used to be a hand-maintained 500-line list, which is exactly how it
 * drifted: Compliance had zero entries, and newer sub-tabs (Quotations,
 * Teams, Leave, Loyalty Tiers, Punch Cards, Hardware, Call Center, …) were
 * unsearchable. Deriving it means a new sub-tab is searchable the moment it
 * is registered — and `subtab-registry.test.ts` keeps the registry itself
 * honest against the components.
 */
export const SITE_SUBTABS: SubTabEntry[] = SUBTAB_ENTRIES.map((entry) => ({
  hostTab: entry.hostTab,
  subId: entry.id,
  label: entry.label,
  description: entry.description,
  keywords: entry.keywords,
}));

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
  const scored = [...SITE_NAVIGATION, ...SITE_SUBTABS]
    .filter((e) => {
      const label = e.label.toLowerCase();
      const keywords = (e.keywords || "").toLowerCase();
      const description = (e.description || "").toLowerCase();
      return (
        label.includes(q) || keywords.includes(q) || description.includes(q)
      );
    })
    .map((e) => {
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
