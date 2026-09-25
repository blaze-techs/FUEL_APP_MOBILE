import {
  resolveAccessMode,
  resolveCapabilities,
  type AccessCapability,
} from "@/react-app/lib/access-mode";
import type { StationAccessSession } from "@/react-app/lib/station-access-code-service";

/** Tabs a role sees when the owner did not pin an explicit list. */
const ROLE_DEFAULT_TABS: Record<string, string[]> = {
  manager: [
    "dashboard",
    "sales",
    "pos",
    "inventory",
    "livetransaction",
    "offloading",
    "delivery",
    "invoice",
    "credit",
    "mpesa",
    "payroll",
    "shifts",
    "customers",
    "fuelsalesreport",
    "reports",
    "analytics",
    "communication",
    "news",
    "data",
    "fueltypes",
    "team",
    "suppliers",
    "maintenance",
    "expenses",
  ],
  staff: [
    "dashboard",
    "sales",
    "pos",
    "inventory",
    "livetransaction",
    "offloading",
    "delivery",
    "mpesa",
    "shifts",
    "customers",
    "communication",
    "news",
    "credit",
  ],
  auditor: [
    "dashboard",
    "sales",
    "inventory",
    "mpesa",
    "payroll",
    "shifts",
    "fuelsalesreport",
    "reports",
    "analytics",
    "audit",
    "customers",
    "credit",
    "communication",
    "news",
    "expenses",
    "delivery",
    "fueltypes",
  ],
};

/** The order tabs appear in, independent of any member's permissions. */
export const ALL_TAB_IDS: string[] = [
  "dashboard",
  "sales",
  "pos",
  "inventory",
  "delivery",
  "offloading",
  "invoice",
  "credit",
  "customers",
  "mpesa",
  "livetransaction",
  "payroll",
  "suppliers",
  "expenses",
  "fueltypes",
  "quality",
  "team",
  "shifts",
  "maintenance",
  "communication",
  "reports",
  "analytics",
  "fuelsalesreport",
  "data",
  "news",
  "settings",
  "audit",
  "automation",
  "documents",
  "integration",
  "price-finder",
  "pumpmapping",
  "regional",
  "terminal",
];

export function normalizeRole(role: string): string {
  const r = (role || "").toLowerCase();
  if (r.includes("manager")) return "manager";
  if (r.includes("staff") || r.includes("cashier") || r.includes("attendant"))
    return "staff";
  if (r.includes("audit")) return "auditor";
  if (r.includes("owner")) return "manager";
  return "staff";
}

/**
 * Tabs that require a specific capability on top of the level. This is what
 * makes "Normal" observably different from "Edit only": both may EDIT, but
 * only Normal reaches station settings and administration.
 */
export const TAB_CAPABILITY_REQUIREMENT: Record<string, AccessCapability> = {
  settings: "settings",
  automation: "settings",
  integration: "settings",
  team: "manage",
  payroll: "manage",
  audit: "manage",
};

/**
 * The effective tab ids for a member, in display order.
 *
 * Two independent restrictions, applied in order:
 *   1. `allowedTabs` — the owner's tab list for this credential (empty =
 *      the role defaults, so a legacy row keeps working unchanged);
 *   2. the LEVEL's tab ceiling (via TAB_CAPABILITY_REQUIREMENT) and the
 *      credential's `scopeTabs`, both of which may only REMOVE tabs.
 *
 * Nothing here can add a tab the owner did not already allow.
 */
export function resolveVisibleTabIds(
  session: StationAccessSession,
): string[] {
  const mode = resolveAccessMode(session);
  const capabilities = resolveCapabilities(mode, {
    tabs: session.scopeTabs ?? [],
    capabilities: session.scopeCapabilities ?? [],
  });
  const allowed = session.allowedTabs ?? [];
  let ids = allowed;
  if (allowed.length === 0) {
    const defaults = ROLE_DEFAULT_TABS[normalizeRole(session.memberRole)];
    ids = defaults ?? ROLE_DEFAULT_TABS.staff;
  }
  const set = new Set(ids);

  // Scope may only narrow: an empty scopeTabs means "no further restriction".
  const scopeTabs = session.scopeTabs ?? [];
  if (scopeTabs.length > 0) {
    const scopeSet = new Set(scopeTabs);
    for (const id of Array.from(set)) {
      if (!scopeSet.has(id)) set.delete(id);
    }
  }

  // Drop tabs whose required capability the level/scope does not grant.
  for (const [tabId, capability] of Object.entries(
    TAB_CAPABILITY_REQUIREMENT,
  )) {
    if (!capabilities.includes(capability)) set.delete(tabId);
  }

  // Always include dashboard even if a weird config omits it.
  set.add("dashboard");
  return ALL_TAB_IDS.filter((id) => set.has(id));
}
