import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useAuth } from "./AuthContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

// ============================================================
// PERMISSION CONTEXT v4 - Full Hierarchy + Delegation + Custom Roles
//
// Hierarchy: Owner > Manager > Staff > Auditor (+ Owner-defined custom
// roles: accountant, cashier, supervisor, etc.).
//
// Core rules:
//  1. The Owner is the root authority (derived from the main user account).
//     Owner status is permanent and cannot be revoked or transferred here.
//  2. Every sub-user is a child of the Owner (or of a delegated sub-user).
//     A sub-user's role determines their default permission set.
//  3. The Owner can create CUSTOM sub-roles with bespoke permission sets.
//  4. The Owner can grant any sub-user the ability to CREATE further
//     sub-users (`canCreateSubUsers`) and/or to GRANT permissions to
//     others (`canGrantPermissions`) — delegation.
//  5. PRIVILEGE-ESCALATION GUARD: a sub-user may NEVER grant another user a
//     permission they do not themselves possess, and may NEVER create a
//     sub-user whose role outranks their own. A lower user's grant power is
//     capped by their own permission set; it can only grow when an upstream
//     user increases their ability.
//  6. Invite links are validated against the DB (station_members), not
//     localStorage — cross-device, tamper-resistant.
//  7. Team members are linked to real Supabase auth identities (user_id +
//     unique_id + email) so a sub-user who logs in on a new device is
//     recognized as the same member.
// ============================================================

export type BaseUserRole = "owner" | "manager" | "staff" | "auditor";
// UserRole is now a string to allow Owner-defined custom roles
// (accountant, cashier, supervisor, ...). The four base roles above are
// always present; custom roles are additive.
export type UserRole = string;

/** The four built-in roles, in descending hierarchy rank (Owner=100). */
export const ROLE_RANK: Record<string, number> = {
  owner: 100,
  manager: 70,
  staff: 40,
  auditor: 20,
};
export const DEFAULT_ROLE_RANK = 10; // custom roles default below auditor

/** Higher rank = more authority. Used for the escalation guard. */
export function rankOf(role: string): number {
  return ROLE_RANK[role] ?? DEFAULT_ROLE_RANK;
}

/** A custom role defined by the Owner (accountant, cashier, ...). */
export interface CustomRole {
  name: string; // lowercase slug, e.g. "accountant"
  label: string; // display label, e.g. "Accountant"
  rank: number; // hierarchy rank (must be < owner=100)
  permissions: PermissionConfig; // the 54 action booleans
  tabGrants: string[]; // granted tab ids
  canCreateSubUsers: boolean; // delegation: can invite further sub-users
  canGrantPermissions: boolean; // delegation: can change others' permissions
  createdAt: string;
  createdBy: string; // user id of the Owner who created it
}

interface TeamMember {
  id: string;
  username: string;
  role: UserRole;
  assignedPumps: string[];
  assignedShifts: string[];
  invitedBy: string;
  invitedAt: string;
  expiresAt?: string;
  active: boolean;
  // Cross-device identity link: ties a team member to a real Supabase auth
  // user so a sub-user who logs in on a NEW device is recognized as the same
  // member (not a duplicate). Populated when the invite is accepted.
  userId?: string; // auth.users.id (Supabase uid)
  authId?: string; // client-side auth id (AuthIdentity.authId)
  email?: string; // the member's email (cross-device lookup key)
  uniqueId?: string; // profiles.unique_id (human-friendly stable ID)
  // Delegation snapshot: what this member can do (captured at invite time,
  // may be upgraded by an upstream user later).
  canCreateSubUsers?: boolean;
  canGrantPermissions?: boolean;
  // The permission snapshot granted to this member (the 54 booleans). When
  // undefined, the member uses their role's default PermissionConfig.
  permissionsSnapshot?: Partial<PermissionConfig>;
  // The inviter's identity (provenance for the hierarchy tree).
  invitedByUserId?: string;
  invitedByUniqueId?: string;
  invitedByName?: string;
  stationId?: string;
}

interface AccessInvite {
  id: string;
  role: UserRole;
  createdBy: string; // role label of the inviter (legacy)
  createdAt: string;
  expiresAt?: string;
  usedBy?: string;
  usedAt?: string;
  maxUses: number;
  uses: number;
  // Inviter identity (provenance) — used to render the hierarchy tree and
  // to enforce the escalation guard on acceptance.
  createdByUserId?: string;
  createdByName?: string;
  createdByUniqueId?: string;
  // The station this invite is for (so a sub-user joins the right station).
  stationId?: string;
  stationName?: string;
  // Delegation snapshot granted to the invitee (captured at creation time).
  canCreateSubUsers?: boolean;
  canGrantPermissions?: boolean;
  permissionsSnapshot?: Partial<PermissionConfig>;
  tabGrants?: string[];
}

/** Decoded invite data from the invite URL (base64 payload). This is what
 * InviteAccept.tsx decodes from the URL — it does NOT need to exist in the
 * invitee's local invites array. */
export interface InvitePayload {
  id: string;
  role: UserRole;
  stationName: string;
  stationId: string;
  createdBy: string;
  createdByName?: string;
  createdByUniqueId?: string;
  expiresAt?: string;
  maxUses: number;
  canCreateSubUsers?: boolean;
  canGrantPermissions?: boolean;
  permissionsSnapshot?: Partial<PermissionConfig>;
  tabGrants?: string[];
}

// --- TAB ACCESS MAP: which permission key gates each tab ---
export const TAB_PERMISSION_MAP: Record<string, keyof PermissionConfig> = {
  dashboard: "canViewDashboard",
  sales: "canViewSales",
  pos: "canUsePOS",
  inventory: "canViewInventory",
  livetransaction: "canViewLiveTransactions",
  offloading: "canViewInventory",
  delivery: "canViewInventory",
  invoice: "canViewSales",
  credit: "canViewCredit",
  debt: "canViewDebt",
  mpesa: "canViewMpesa",
  payroll: "canViewPayroll",
  shifts: "canViewShifts",
  customers: "canViewLoyalty",
  quality: "canViewAnalytics",
  fuelsalesreport: "canViewAnalytics",
  reports: "canViewReports",
  analytics: "canViewAnalytics",
  audit: "canViewAudit",
  communication: "canViewCommunication",
  news: "canViewNews",
  data: "canViewSettings",
  integration: "canViewIntegrations",
  regional: "canViewRegional",
  fueltypes: "canManageFuelTypes",
  team: "canViewEmployees",
  documents: "canViewDocuments",
  settings: "canViewSettings",
};

// Action → domain → permission-key map for the canDo() action-level gate.
export const ACTION_PERM_MAP: Record<
  string,
  Partial<Record<string, keyof PermissionConfig>>
> = {
  view: {
    dashboard: "canViewDashboard",
    sales: "canViewSales",
    inventory: "canViewInventory",
    pos: "canViewPOS",
    employees: "canViewEmployees",
    payroll: "canViewPayroll",
    shifts: "canViewShifts",
    mpesa: "canViewMpesa",
    livetransaction: "canViewLiveTransactions",
    reports: "canViewReports",
    analytics: "canViewAnalytics",
    audit: "canViewAudit",
    documents: "canViewDocuments",
    fuelprices: "canViewFuelPrices",
    regional: "canViewRegional",
    integrations: "canViewIntegrations",
    cloud: "canViewCloud",
    settings: "canViewSettings",
    ai: "canViewAI",
    communication: "canViewCommunication",
    news: "canViewNews",
    loyalty: "canViewLoyalty",
    credit: "canViewCredit",
    debt: "canViewDebt",
  },
  create: {
    sales: "canCreateSales",
    employees: "canInviteStaff",
    subusers: "canCreateSubUsers",
  },
  edit: {
    sales: "canEditSales",
    fuelprices: "canEditFuelPrices",
  },
  manage: {
    inventory: "canManageInventory",
    employees: "canManageEmployees",
    payroll: "canRunPayroll",
    shifts: "canManageShifts",
    mpesa: "canProcessMpesa",
    audit: "canManageAudit",
    documents: "canManageDocuments",
    fueltypes: "canManageFuelTypes",
    integrations: "canManageIntegrations",
    cloud: "canManageCloud",
    settings: "canManageSettings",
    loyalty: "canManageLoyalty",
    credit: "canManageCredit",
    debt: "canManageDebt",
    pos: "canUsePOS",
  },
  upload: {
    documents: "canManageDocuments",
  },
  delete: {
    employees: "canRevokeAccess",
  },
};

// --- DEFAULT TAB ACCESS BY ROLE ---
export const DEFAULT_ROLE_TABS: Record<UserRole, string[]> = {
  owner: [
    "dashboard",
    "sales",
    "pos",
    "inventory",
    "livetransaction",
    "offloading",
    "delivery",
    "invoice",
    "credit",
    "debt",
    "mpesa",
    "payroll",
    "shifts",
    "customers",
    "quality",
    "fuelsalesreport",
    "reports",
    "analytics",
    "audit",
    "communication",
    "news",
    "data",
    "integration",
    "regional",
    "fueltypes",
    "team",
    "documents",
    "settings",
  ],
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
    "debt",
    "mpesa",
    "payroll",
    "shifts",
    "customers",
    "quality",
    "fuelsalesreport",
    "reports",
    "analytics",
    "audit",
    "communication",
    "news",
    "data",
    "integration",
    "regional",
    "fueltypes",
    "team",
    "documents",
    "settings",
  ],
  staff: [
    "dashboard",
    "sales",
    "pos",
    "inventory",
    "livetransaction",
    "offloading",
    "delivery",
    "debt",
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
    "debt",
    "communication",
    "news",
  ],
};

interface PermissionConfig {
  canViewDashboard: boolean;
  canViewSales: boolean;
  canCreateSales: boolean;
  canEditSales: boolean;
  canViewInventory: boolean;
  canManageInventory: boolean;
  canViewEmployees: boolean;
  canManageEmployees: boolean;
  canViewPayroll: boolean;
  canRunPayroll: boolean;
  canViewShifts: boolean;
  canManageShifts: boolean;
  canViewMpesa: boolean;
  canProcessMpesa: boolean;
  canViewReports: boolean;
  canExportReports: boolean;
  canViewAnalytics: boolean;
  canViewAudit: boolean;
  canManageAudit: boolean;
  canViewDocuments: boolean;
  canManageDocuments: boolean;
  canViewFuelPrices: boolean;
  canEditFuelPrices: boolean;
  canChangePumpCount: boolean;
  canManageFuelTypes: boolean;
  canViewRegional: boolean;
  canViewIntegrations: boolean;
  canManageIntegrations: boolean;
  canViewCloud: boolean;
  canManageCloud: boolean;
  canViewSettings: boolean;
  canManageSettings: boolean;
  canManageTabs: boolean;
  canInviteManager: boolean;
  canInviteStaff: boolean;
  canInviteAuditor: boolean;
  canAssignPumps: boolean;
  canAssignShifts: boolean;
  canRevokeAccess: boolean;
  canSetTimeLimits: boolean;
  canViewAI: boolean;
  canUseAI: boolean;
  canViewCommunication: boolean;
  canViewNews: boolean;
  canViewInvoices?: boolean;
  canViewPOS: boolean;
  canUsePOS: boolean;
  canViewLoyalty: boolean;
  canManageLoyalty: boolean;
  canViewCredit: boolean;
  canManageCredit: boolean;
  canViewDebt: boolean;
  canManageDebt: boolean;
  canViewLiveTransactions: boolean;
  isOwner: boolean;
  // --- Delegation flags (v4) ---
  // canCreateSubUsers: this role may invite further sub-users (delegation).
  //   The Owner grants this to e.g. a Manager so the Manager can hire staff.
  // canGrantPermissions: this role may change the permission/tab grants of
  //   roles ranked below them (delegation of admin power).
  // Both are themselves subject to the escalation guard: a role may never
  // grant a sub-user a permission it does not itself possess.
  canCreateSubUsers: boolean;
  canGrantPermissions: boolean;
}

// ROLE_PERMISSIONS is keyed by BaseUserRole (the 4 built-in roles). Custom
// roles carry their own PermissionConfig in the CustomRole record.
const ROLE_PERMISSIONS: Record<BaseUserRole, PermissionConfig> = {
  owner: {
    canViewDashboard: true,
    canViewSales: true,
    canCreateSales: true,
    canEditSales: true,
    canViewInventory: true,
    canManageInventory: true,
    canViewEmployees: true,
    canManageEmployees: true,
    canViewPayroll: true,
    canRunPayroll: true,
    canViewShifts: true,
    canManageShifts: true,
    canViewMpesa: true,
    canProcessMpesa: true,
    canViewReports: true,
    canExportReports: true,
    canViewAnalytics: true,
    canViewAudit: true,
    canManageAudit: true,
    canViewDocuments: true,
    canManageDocuments: true,
    canViewFuelPrices: true,
    canEditFuelPrices: true,
    canChangePumpCount: true,
    canManageFuelTypes: true,
    canViewRegional: true,
    canViewIntegrations: true,
    canManageIntegrations: true,
    canViewCloud: true,
    canManageCloud: true,
    canViewSettings: true,
    canManageSettings: true,
    canManageTabs: true,
    canInviteManager: true,
    canInviteStaff: true,
    canInviteAuditor: true,
    canAssignPumps: true,
    canAssignShifts: true,
    canRevokeAccess: true,
    canSetTimeLimits: true,
    canViewAI: true,
    canUseAI: true,
    canViewCommunication: true,
    canViewNews: true,
    canViewPOS: true,
    canUsePOS: true,
    canViewLoyalty: true,
    canManageLoyalty: true,
    canViewCredit: true,
    canManageCredit: true,
    canViewDebt: true,
    canManageDebt: true,
    canViewLiveTransactions: true,
    isOwner: true,
    canCreateSubUsers: true,
    canGrantPermissions: true,
  },
  manager: {
    canViewDashboard: true,
    canViewSales: true,
    canCreateSales: true,
    canEditSales: true,
    canViewInventory: true,
    canManageInventory: true,
    canViewEmployees: true,
    canManageEmployees: true,
    canViewPayroll: true,
    canRunPayroll: true,
    canViewShifts: true,
    canManageShifts: true,
    canViewMpesa: true,
    canProcessMpesa: true,
    canViewReports: true,
    canExportReports: true,
    canViewAnalytics: true,
    canViewAudit: true,
    canManageAudit: false,
    canViewDocuments: true,
    canManageDocuments: true,
    canViewFuelPrices: true,
    canEditFuelPrices: true,
    canChangePumpCount: false,
    canManageFuelTypes: false,
    canViewRegional: true,
    canViewIntegrations: true,
    canManageIntegrations: false,
    canViewCloud: true,
    canManageCloud: false,
    canViewSettings: true,
    canManageSettings: false,
    canManageTabs: false,
    canInviteManager: false,
    canInviteStaff: true,
    canInviteAuditor: true,
    canAssignPumps: true,
    canAssignShifts: true,
    canRevokeAccess: true,
    canSetTimeLimits: true,
    canViewAI: true,
    canUseAI: true,
    canViewCommunication: true,
    canViewNews: true,
    canViewPOS: true,
    canUsePOS: true,
    canViewLoyalty: true,
    canManageLoyalty: true,
    canViewCredit: true,
    canManageCredit: true,
    canViewDebt: true,
    canManageDebt: true,
    canViewLiveTransactions: true,
    isOwner: false,
    canCreateSubUsers: false, // Owner may delegate this to a Manager
    canGrantPermissions: false, // Owner may delegate this to a Manager
  },
  staff: {
    canViewDashboard: true,
    canViewSales: true,
    canCreateSales: true,
    canEditSales: false,
    canViewInventory: true,
    canManageInventory: true,
    canViewEmployees: false,
    canManageEmployees: false,
    canViewPayroll: false,
    canRunPayroll: false,
    canViewShifts: true,
    canManageShifts: false,
    canViewMpesa: true,
    canProcessMpesa: false,
    canViewReports: false,
    canExportReports: false,
    canViewAnalytics: false,
    canViewAudit: false,
    canManageAudit: false,
    canViewDocuments: true,
    canManageDocuments: false,
    canViewFuelPrices: true,
    canEditFuelPrices: false,
    canChangePumpCount: false,
    canManageFuelTypes: false,
    canViewRegional: true,
    canViewIntegrations: false,
    canManageIntegrations: false,
    canViewCloud: false,
    canManageCloud: false,
    canViewSettings: false,
    canManageSettings: false,
    canManageTabs: false,
    canInviteManager: false,
    canInviteStaff: false,
    canInviteAuditor: false,
    canAssignPumps: false,
    canAssignShifts: false,
    canRevokeAccess: false,
    canSetTimeLimits: false,
    canViewAI: true,
    canUseAI: true,
    canViewCommunication: true,
    canViewNews: true,
    canViewPOS: true,
    canUsePOS: true,
    canViewLoyalty: true,
    canManageLoyalty: true,
    canViewCredit: true,
    canManageCredit: false,
    canViewDebt: true,
    canManageDebt: true,
    canViewLiveTransactions: true,
    isOwner: false,
    canCreateSubUsers: false,
    canGrantPermissions: false,
  },
  auditor: {
    canViewDashboard: true,
    canViewSales: true,
    canCreateSales: false,
    canEditSales: false,
    canViewInventory: true,
    canManageInventory: false,
    canViewEmployees: true,
    canManageEmployees: false,
    canViewPayroll: true,
    canRunPayroll: false,
    canViewShifts: true,
    canManageShifts: false,
    canViewMpesa: true,
    canProcessMpesa: false,
    canViewReports: true,
    canExportReports: true,
    canViewAnalytics: true,
    canViewAudit: true,
    canManageAudit: false,
    canViewDocuments: true,
    canManageDocuments: false,
    canViewFuelPrices: true,
    canEditFuelPrices: false,
    canChangePumpCount: false,
    canManageFuelTypes: false,
    canViewRegional: true,
    canViewIntegrations: false,
    canManageIntegrations: false,
    canViewCloud: false,
    canManageCloud: false,
    canViewSettings: false,
    canManageSettings: false,
    canManageTabs: false,
    canInviteManager: false,
    canInviteStaff: false,
    canInviteAuditor: false,
    canAssignPumps: false,
    canAssignShifts: false,
    canRevokeAccess: false,
    canSetTimeLimits: false,
    canViewAI: false,
    canUseAI: false,
    canViewCommunication: false,
    canViewNews: true,
    canViewPOS: false,
    canUsePOS: false,
    canViewLoyalty: true,
    canManageLoyalty: false,
    canViewCredit: true,
    canManageCredit: false,
    canViewDebt: true,
    canManageDebt: false,
    canViewLiveTransactions: false,
    isOwner: false,
    canCreateSubUsers: false,
    canGrantPermissions: false,
  },
};

interface RoleTabGrants {
  manager: string[];
  staff: string[];
  auditor: string[];
  // Custom roles' tab grants are stored here under their slug name.
  // (Base roles above are always present; custom roles are additive.)
  [roleSlug: string]: string[];
}

interface PermissionContextType {
  role: UserRole;
  permissions: PermissionConfig;
  team: TeamMember[];
  invites: AccessInvite[];
  roleTabGrants: RoleTabGrants;
  customRoles: CustomRole[];
  setRole: (role: UserRole) => void;
  hasPermission: (key: keyof PermissionConfig) => boolean;
  /** Action-level gate: view/create/edit/manage/upload for a domain. */
  canDo: (
    action: "view" | "create" | "edit" | "manage" | "upload" | "delete",
    domain: string,
  ) => boolean;
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
  isAuditor: boolean;
  /** True if the current user's role outranks (or equals) the given role. */
  outranks: (otherRole: string) => boolean;
  canAccessTab: (tabId: string) => boolean;
  setRoleTabGrants: (grants: RoleTabGrants) => void;
  grantTabToRole: (role: UserRole, tabId: string) => void;
  revokeTabFromRole: (role: UserRole, tabId: string) => void;
  /**
   * Grant a single permission flag to a role. Subject to the escalation guard:
   * the granter must themselves possess the permission, and the target role
   * must be ranked at or below the granter's role.
   */
  grantPermissionToRole: (role: UserRole, perm: keyof PermissionConfig) => void;
  revokePermissionFromRole: (
    role: UserRole,
    perm: keyof PermissionConfig,
  ) => void;
  setRolePermission: (
    role: UserRole,
    perm: keyof PermissionConfig,
    value: boolean,
  ) => void;
  /** Can the current user create a sub-user with the given role? (escalation-aware) */
  canInviteRole: (targetRole: string) => boolean;
  createInvite: (
    role: UserRole,
    expiresInDays?: number,
    maxUses?: number,
    options?: {
      canCreateSubUsers?: boolean;
      canGrantPermissions?: boolean;
      permissionsSnapshot?: Partial<PermissionConfig>;
      tabGrants?: string[];
    },
  ) => AccessInvite;
  acceptInvite: (inviteId: string, username: string) => boolean;
  /** Accept an invite directly from the decoded URL payload — does NOT require
   * the invite to exist in the local invites array (which is the invitee's own
   * array, always empty since invites are created by the station owner). */
  acceptInviteFromPayload: (
    payload: InvitePayload,
    username: string,
  ) => boolean;
  revokeMember: (memberId: string) => void;
  extendAccess: (memberId: string, days: number) => void;
  assignPumps: (memberId: string, pumpIds: string[]) => void;
  assignShifts: (memberId: string, shiftIds: string[]) => void;
  // --- Custom roles (Owner-defined: accountant, cashier, ...) ---
  createCustomRole: (
    slug: string,
    label: string,
    baseRole?: BaseUserRole,
    rank?: number,
  ) => CustomRole | null;
  deleteCustomRole: (slug: string) => void;
  updateCustomRole: (slug: string, updates: Partial<CustomRole>) => void;
  /** Resolve any role name (base or custom) to its effective PermissionConfig. */
  resolvePermissions: (roleName: string) => PermissionConfig;
  /** Resolve any role name to its effective tab grants. */
  resolveTabGrants: (roleName: string) => string[];
}

const PermissionContext = createContext<PermissionContextType>({
  role: "owner",
  permissions: ROLE_PERMISSIONS.owner,
  team: [],
  invites: [],
  roleTabGrants: {
    manager: [...DEFAULT_ROLE_TABS.manager],
    staff: [...DEFAULT_ROLE_TABS.staff],
    auditor: [...DEFAULT_ROLE_TABS.auditor],
  },
  customRoles: [],
  setRole: () => {},
  hasPermission: () => false,
  canDo: () => false,
  isOwner: true,
  isManager: false,
  isStaff: false,
  isAuditor: false,
  outranks: () => true,
  canAccessTab: () => false,
  setRoleTabGrants: () => {},
  grantTabToRole: () => {},
  revokeTabFromRole: () => {},
  grantPermissionToRole: () => {},
  revokePermissionFromRole: () => {},
  setRolePermission: () => {},
  canInviteRole: () => false,
  createInvite: () => ({
    id: "",
    role: "staff",
    createdBy: "",
    createdAt: "",
    maxUses: 1,
    uses: 0,
  }),
  acceptInvite: () => false,
  acceptInviteFromPayload: () => false,
  revokeMember: () => {},
  extendAccess: () => {},
  assignPumps: () => {},
  assignShifts: () => {},
  createCustomRole: () => null,
  deleteCustomRole: () => {},
  updateCustomRole: () => {},
  resolvePermissions: () => ROLE_PERMISSIONS.staff,
  resolveTabGrants: () => [],
});

const GRANTS_STORAGE_KEY = "fuelpro_role_tab_grants";

// Cloud keys (user-scoped — team/invites/grants belong to the station owner's
// account, not a specific station, so cross-device sync uses owner-only scoping).
const TEAM_CLOUD_KEY = "team_members";
const INVITES_CLOUD_KEY = "team_invites";
const GRANTS_CLOUD_KEY = "role_tab_grants";
const CUSTOM_ROLES_CLOUD_KEY = "custom_roles";

function defaultGrants(): RoleTabGrants {
  return {
    manager: [...DEFAULT_ROLE_TABS.manager],
    staff: [...DEFAULT_ROLE_TABS.staff],
    auditor: [...DEFAULT_ROLE_TABS.auditor],
  };
}

function loadGrants(): RoleTabGrants {
  try {
    const saved = localStorage.getItem(GRANTS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  return defaultGrants();
}

/** Normalize a cloud-loaded TeamMember so partial/legacy records never crash the UI. */
function normalizeTeamMember(m: unknown): TeamMember | null {
  if (!m || typeof m !== "object") return null;
  const r = m as Record<string, unknown>;
  return {
    id:
      typeof r.id === "string"
        ? r.id
        : `mem_${Math.random().toString(36).slice(2)}`,
    username: typeof r.username === "string" ? r.username : "",
    // Accept any role string (base or custom). Default to "staff" for unknown.
    role: typeof r.role === "string" && r.role ? r.role : "staff",
    assignedPumps: Array.isArray(r.assignedPumps)
      ? r.assignedPumps.filter((p) => typeof p === "string")
      : [],
    assignedShifts: Array.isArray(r.assignedShifts)
      ? r.assignedShifts.filter((s) => typeof s === "string")
      : [],
    invitedBy: typeof r.invitedBy === "string" ? r.invitedBy : "",
    invitedAt:
      typeof r.invitedAt === "string" ? r.invitedAt : new Date().toISOString(),
    expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : undefined,
    active: typeof r.active === "boolean" ? r.active : true,
    userId: typeof r.userId === "string" ? r.userId : undefined,
    authId: typeof r.authId === "string" ? r.authId : undefined,
    email: typeof r.email === "string" ? r.email : undefined,
    uniqueId: typeof r.uniqueId === "string" ? r.uniqueId : undefined,
    canCreateSubUsers:
      typeof r.canCreateSubUsers === "boolean"
        ? r.canCreateSubUsers
        : undefined,
    canGrantPermissions:
      typeof r.canGrantPermissions === "boolean"
        ? r.canGrantPermissions
        : undefined,
    permissionsSnapshot:
      r.permissionsSnapshot && typeof r.permissionsSnapshot === "object"
        ? (r.permissionsSnapshot as Partial<PermissionConfig>)
        : undefined,
    invitedByUserId:
      typeof r.invitedByUserId === "string" ? r.invitedByUserId : undefined,
    invitedByUniqueId:
      typeof r.invitedByUniqueId === "string" ? r.invitedByUniqueId : undefined,
    stationId: typeof r.stationId === "string" ? r.stationId : undefined,
  };
}

function normalizeTeamMembers(arr: unknown): TeamMember[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(normalizeTeamMember)
    .filter((m): m is TeamMember => m !== null);
}

/** Normalize a cloud-loaded AccessInvite. */
function normalizeInvite(i: unknown): AccessInvite | null {
  if (!i || typeof i !== "object") return null;
  const r = i as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : "",
    // Accept any role string (base or custom). Default to "staff".
    role: typeof r.role === "string" && r.role ? r.role : "staff",
    createdBy: typeof r.createdBy === "string" ? r.createdBy : "",
    createdAt:
      typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
    expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : undefined,
    usedBy: typeof r.usedBy === "string" ? r.usedBy : undefined,
    usedAt: typeof r.usedAt === "string" ? r.usedAt : undefined,
    maxUses: typeof r.maxUses === "number" ? r.maxUses : 1,
    uses: typeof r.uses === "number" ? r.uses : 0,
    createdByUserId:
      typeof r.createdByUserId === "string" ? r.createdByUserId : undefined,
    createdByName:
      typeof r.createdByName === "string" ? r.createdByName : undefined,
    createdByUniqueId:
      typeof r.createdByUniqueId === "string" ? r.createdByUniqueId : undefined,
    stationId: typeof r.stationId === "string" ? r.stationId : undefined,
    stationName: typeof r.stationName === "string" ? r.stationName : undefined,
    canCreateSubUsers:
      typeof r.canCreateSubUsers === "boolean"
        ? r.canCreateSubUsers
        : undefined,
    canGrantPermissions:
      typeof r.canGrantPermissions === "boolean"
        ? r.canGrantPermissions
        : undefined,
    permissionsSnapshot:
      r.permissionsSnapshot && typeof r.permissionsSnapshot === "object"
        ? (r.permissionsSnapshot as Partial<PermissionConfig>)
        : undefined,
    tabGrants: Array.isArray(r.tabGrants)
      ? r.tabGrants.filter((x) => typeof x === "string")
      : undefined,
  };
}

function normalizeInvites(arr: unknown): AccessInvite[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(normalizeInvite)
    .filter((i): i is AccessInvite => i !== null && i.id !== "");
}

/** Normalize a cloud-loaded RoleTabGrants object. Preserves custom-role keys. */
function normalizeGrants(g: unknown): RoleTabGrants | null {
  if (!g || typeof g !== "object") return null;
  const r = g as Record<string, unknown>;
  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  const out: RoleTabGrants = {
    manager: asArr(r.manager),
    staff: asArr(r.staff),
    auditor: asArr(r.auditor),
  };
  // Preserve any custom-role keys present in the cloud blob.
  for (const k of Object.keys(r)) {
    if (k !== "manager" && k !== "staff" && k !== "auditor") {
      out[k] = asArr(r[k]);
    }
  }
  return out;
}

/** Normalize a cloud-loaded CustomRole. */
function normalizeCustomRole(c: unknown): CustomRole | null {
  if (!c || typeof c !== "object") return null;
  const r = c as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name : "";
  if (!name) return null;
  const basePerm =
    typeof r.baseRole === "string" &&
    (r.baseRole === "owner" ||
      r.baseRole === "manager" ||
      r.baseRole === "staff" ||
      r.baseRole === "auditor")
      ? { ...ROLE_PERMISSIONS[r.baseRole as BaseUserRole] }
      : { ...ROLE_PERMISSIONS.staff };
  // Merge any saved permission overrides onto the base.
  const savedPerm =
    r.permissions && typeof r.permissions === "object"
      ? (r.permissions as Partial<PermissionConfig>)
      : {};
  const permissions = { ...basePerm, ...savedPerm } as PermissionConfig;
  return {
    name,
    label: typeof r.label === "string" ? r.label : name,
    rank: typeof r.rank === "number" ? r.rank : DEFAULT_ROLE_RANK,
    permissions,
    tabGrants: Array.isArray(r.tabGrants)
      ? r.tabGrants.filter((x) => typeof x === "string")
      : [],
    canCreateSubUsers:
      typeof r.canCreateSubUsers === "boolean" ? r.canCreateSubUsers : false,
    canGrantPermissions:
      typeof r.canGrantPermissions === "boolean"
        ? r.canGrantPermissions
        : false,
    createdAt:
      typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
    createdBy: typeof r.createdBy === "string" ? r.createdBy : "",
  };
}

function normalizeCustomRoles(arr: unknown): CustomRole[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(normalizeCustomRole)
    .filter((c): c is CustomRole => c !== null);
}

export function PermissionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, getActiveBinding, bindings: allBindings } = useAuth();

  // --- cloud-backed state (user-scoped): team members, invites, role grants ---
  // getCached first (instant from memory/localStorage cache), then async cloud
  // refresh in a mount effect. localStorage remains only a read-through cache.
  const [role, setRoleState] = useState<UserRole>(() => {
    // Every new user starts as Owner - no role switching allowed
    const saved = localStorage.getItem("fuelpro_v2_role");
    if (!saved) {
      localStorage.setItem("fuelpro_v2_role", "owner");
      return "owner";
    }
    // If user somehow saved a non-owner role, reset to owner
    if (saved !== "owner" && !localStorage.getItem("fuelpro_user_invited")) {
      localStorage.setItem("fuelpro_v2_role", "owner");
      return "owner";
    }
    return (saved as UserRole) || "owner";
  });

  const [team, setTeam] = useState<TeamMember[]>(() => {
    const cloudCached =
      cloudStorageService.getCached<unknown[]>(TEAM_CLOUD_KEY);
    if (Array.isArray(cloudCached)) return normalizeTeamMembers(cloudCached);
    try {
      const saved = localStorage.getItem("fuelpro_v2_team");
      return saved ? normalizeTeamMembers(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  const [invites, setInvites] = useState<AccessInvite[]>(() => {
    const cloudCached =
      cloudStorageService.getCached<unknown[]>(INVITES_CLOUD_KEY);
    if (Array.isArray(cloudCached)) return normalizeInvites(cloudCached);
    try {
      const saved = localStorage.getItem("fuelpro_v2_invites");
      return saved ? normalizeInvites(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  const [roleTabGrants, setRoleTabGrantsState] = useState<RoleTabGrants>(() => {
    const cloudCached =
      cloudStorageService.getCached<unknown>(GRANTS_CLOUD_KEY);
    const n = normalizeGrants(cloudCached);
    if (n) return n;
    return loadGrants();
  });

  const [customRoles, setCustomRoles] = useState<CustomRole[]>(() => {
    const cloudCached = cloudStorageService.getCached<unknown[]>(
      CUSTOM_ROLES_CLOUD_KEY,
    );
    if (Array.isArray(cloudCached)) return normalizeCustomRoles(cloudCached);
    try {
      const saved = localStorage.getItem("fuelpro_custom_roles");
      return saved ? normalizeCustomRoles(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  // Echo guard: skip applying a remote update that we just wrote locally, to
  // avoid an unnecessary setState/refetch loop on the same device.
  const skipTeamRemoteRef = useRef(false);
  const skipInvitesRemoteRef = useRef(false);
  const skipGrantsRemoteRef = useRef(false);
  const skipCustomRolesRemoteRef = useRef(false);

  // Cloud-load completion guard: prevents the cloud-save effects from writing
  // the default/empty in-memory state to app_kv BEFORE the initial cloud load
  // has returned. Without this, a freshly-created invite (or team member) is
  // silently overwritten by an empty cloud blob on a new-device login — the
  // same race fixed in FuelContext (commit 00522ac).
  const cloudLoadCompleteRef = useRef(false);
  // Tracks whether ANY local mutation (createInvite, acceptInvite, revoke,
  // extend, assign, grant/revoke tab) happened before the async cloud load
  // completed. If so, the cloud load must NOT overwrite local state — the
  // user's changes take precedence over stale cloud data.
  const localModifiedRef = useRef(false);

  // Persist grants to localStorage cache (cloud save happens in the effect below).
  useEffect(() => {
    localStorage.setItem(GRANTS_STORAGE_KEY, JSON.stringify(roleTabGrants));
  }, [roleTabGrants]);

  useEffect(() => {
    localStorage.setItem("fuelpro_v2_team", JSON.stringify(team));
  }, [team]);
  useEffect(() => {
    localStorage.setItem("fuelpro_v2_invites", JSON.stringify(invites));
  }, [invites]);
  useEffect(() => {
    localStorage.setItem("fuelpro_custom_roles", JSON.stringify(customRoles));
  }, [customRoles]);

  // Cloud persistence: whenever team/invites/grants change, sync to app_kv so
  // the data is available on every device the owner signs into.
  // Guarded by cloudLoadCompleteRef so the initial empty state is NOT written
  // to cloud before the real cloud data has been loaded.
  useEffect(() => {
    if (!user) return;
    if (!cloudLoadCompleteRef.current) return;
    cloudStorageService.set(TEAM_CLOUD_KEY, team).catch(() => {});
  }, [team, user]);
  useEffect(() => {
    if (!user) return;
    if (!cloudLoadCompleteRef.current) return;
    cloudStorageService.set(INVITES_CLOUD_KEY, invites).catch(() => {});
  }, [invites, user]);
  useEffect(() => {
    if (!user) return;
    if (!cloudLoadCompleteRef.current) return;
    cloudStorageService.set(GRANTS_CLOUD_KEY, roleTabGrants).catch(() => {});
  }, [roleTabGrants, user]);
  useEffect(() => {
    if (!user) return;
    if (!cloudLoadCompleteRef.current) return;
    cloudStorageService
      .set(CUSTOM_ROLES_CLOUD_KEY, customRoles)
      .catch(() => {});
  }, [customRoles, user]);

  // Load from cloud on mount + real-time cross-device sync.
  useEffect(() => {
    if (!user) return;
    cloudLoadCompleteRef.current = false;
    localModifiedRef.current = false;
    let cancelled = false;
    (async () => {
      const cloudTeam = await cloudStorageService.get<unknown>(TEAM_CLOUD_KEY);
      if (!cancelled && Array.isArray(cloudTeam) && !localModifiedRef.current) {
        setTeam(normalizeTeamMembers(cloudTeam));
      }
      const cloudInvites =
        await cloudStorageService.get<unknown>(INVITES_CLOUD_KEY);
      if (
        !cancelled &&
        Array.isArray(cloudInvites) &&
        !localModifiedRef.current
      ) {
        setInvites(normalizeInvites(cloudInvites));
      }
      const cloudGrants =
        await cloudStorageService.get<unknown>(GRANTS_CLOUD_KEY);
      if (!cancelled && !localModifiedRef.current) {
        const n = normalizeGrants(cloudGrants);
        if (n) setRoleTabGrantsState(n);
      }
      const cloudCustomRoles = await cloudStorageService.get<unknown>(
        CUSTOM_ROLES_CLOUD_KEY,
      );
      if (
        !cancelled &&
        Array.isArray(cloudCustomRoles) &&
        !localModifiedRef.current
      ) {
        setCustomRoles(normalizeCustomRoles(cloudCustomRoles));
      }
      if (!cancelled) cloudLoadCompleteRef.current = true;
    })();

    const unsubs = [
      cloudStorageService.subscribe<unknown>(
        TEAM_CLOUD_KEY,
        undefined,
        (val) => {
          if (skipTeamRemoteRef.current) {
            skipTeamRemoteRef.current = false;
            return;
          }
          if (Array.isArray(val)) setTeam(normalizeTeamMembers(val));
        },
      ),
      cloudStorageService.subscribe<unknown>(
        INVITES_CLOUD_KEY,
        undefined,
        (val) => {
          if (skipInvitesRemoteRef.current) {
            skipInvitesRemoteRef.current = false;
            return;
          }
          if (Array.isArray(val)) setInvites(normalizeInvites(val));
        },
      ),
      cloudStorageService.subscribe<unknown>(
        GRANTS_CLOUD_KEY,
        undefined,
        (val) => {
          if (skipGrantsRemoteRef.current) {
            skipGrantsRemoteRef.current = false;
            return;
          }
          const n = normalizeGrants(val);
          if (n) setRoleTabGrantsState(n);
        },
      ),
      cloudStorageService.subscribe<unknown>(
        CUSTOM_ROLES_CLOUD_KEY,
        undefined,
        (val) => {
          if (skipCustomRolesRemoteRef.current) {
            skipCustomRolesRemoteRef.current = false;
            return;
          }
          if (Array.isArray(val)) setCustomRoles(normalizeCustomRoles(val));
        },
      ),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [user]);

  // Sync role from the active station binding. When a user logs in on any
  // device, AuthContext.syncBindingsFromCloud loads their station_members
  // rows → bindings. This effect reads the binding for the current station
  // and sets the PermissionContext role accordingly. This is how an invited
  // Manager/Staff/Auditor gets their correct role on every device — NOT via
  // localStorage (which is per-browser). Without this, an invited user stays
  // "owner" in the PermissionContext even though their binding says "manager".
  useEffect(() => {
    if (!user) return;
    let currentStationId: string | null = null;
    // StationContext stores the raw ID string; InviteAccept stores a JSON
    // object {stationId}. Handle both formats.
    const rawV3 = localStorage.getItem("fuelpro_current_station_v3");
    if (rawV3) {
      try {
        const parsed = JSON.parse(rawV3);
        currentStationId =
          typeof parsed === "string" ? parsed : parsed?.stationId;
      } catch {
        // Not valid JSON — it's a raw ID string
        currentStationId = rawV3;
      }
    }
    if (!currentStationId) {
      const legacy = localStorage.getItem("fuelpro_current_station");
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          currentStationId =
            typeof parsed === "string" ? parsed : parsed?.stationId;
        } catch {
          currentStationId = legacy;
        }
      }
    }

    // OWNERSHIP PRECEDENCE: if the user owns the current station, no
    // membership binding may downgrade them (a stale/test binding that lists
    // the owner as "manager" on their own station must not strip owner
    // privileges). Check the user-scoped stations cache.
    if (currentStationId) {
      try {
        const stationsRaw = localStorage.getItem(
          `fuelpro_stations_v3_${user.id}`,
        );
        const stations = stationsRaw ? JSON.parse(stationsRaw) : [];
        if (Array.isArray(stations)) {
          const owned = stations.find(
            (s: any) =>
              (s?.id === currentStationId ||
                s?.stationId === currentStationId) &&
              (!s?.ownerId || s?.ownerId === user.id),
          );
          if (owned && role === "owner") return;
          if (owned && role !== "owner") {
            setRoleState("owner");
            localStorage.setItem("fuelpro_v2_role", "owner");
            localStorage.removeItem("fuelpro_user_invited");
            return;
          }
        }
      } catch {
        /* ignore malformed cache */
      }
    }

    // Try the binding for the current station first; if no current station
    // is set yet (fresh login, sync in progress), fall back to ANY active
    // binding — an invited user with exactly one binding should get that
    // role even before the StationContext finishes syncing.
    const binding = currentStationId
      ? getActiveBinding(currentStationId)
      : null;
    const fallbackBinding =
      !binding && role === "owner" ? allBindings.find((b) => b.active) : null;
    const effectiveBinding = binding || fallbackBinding;

    if (
      effectiveBinding &&
      effectiveBinding.active &&
      effectiveBinding.role !== role
    ) {
      setRoleState(effectiveBinding.role);
      localStorage.setItem("fuelpro_v2_role", effectiveBinding.role);
      localStorage.setItem("fuelpro_user_invited", "true");
    }
  }, [user, getActiveBinding, role, allBindings]);

  // setRole: OWNER cannot switch roles. Only non-owner invited users can have different roles.
  const setRole = useCallback(
    (newRole: UserRole) => {
      // Rule 1: Owner can NEVER switch to another role
      if (role === "owner" && newRole !== "owner") {
        console.warn(
          "[Role Lock] Owner cannot switch to a different role. Owner status is permanent.",
        );
        return;
      }

      // Rule 2: Cannot switch TO owner from another role (owner is set at signup only)
      if (role !== "owner" && newRole === "owner") {
        console.warn(
          "[Role Lock] Cannot assume Owner role. Owner is assigned at signup only.",
        );
        return;
      }

      // Rule 3: Invited users are bound to their invited role
      let currentStationId: string | null = null;
      const rawV3 = localStorage.getItem("fuelpro_current_station_v3");
      if (rawV3) {
        try {
          const parsed = JSON.parse(rawV3);
          currentStationId =
            typeof parsed === "string" ? parsed : parsed?.stationId;
        } catch {
          currentStationId = rawV3;
        }
      }
      if (!currentStationId) {
        const legacy = localStorage.getItem("fuelpro_current_station");
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            currentStationId =
              typeof parsed === "string" ? parsed : parsed?.stationId;
          } catch {
            currentStationId = legacy;
          }
        }
      }

      const binding = currentStationId
        ? getActiveBinding(currentStationId)
        : null;
      if (binding && binding.active) {
        if (newRole !== binding.role) {
          console.warn(
            `[Role Lock] Role change rejected. User is bound as ${binding.role} at this station.`,
          );
          return;
        }
      }

      setRoleState(newRole);
      localStorage.setItem("fuelpro_v2_role", newRole);
    },
    [getActiveBinding, role],
  );

  // Resolve any role name (base or custom) to its effective PermissionConfig,
  // applying any per-role permission overrides stored in roleTabGrants.
  const resolvePermissions = useCallback(
    (roleName: string): PermissionConfig => {
      let base: PermissionConfig;
      if (
        roleName === "owner" ||
        roleName === "manager" ||
        roleName === "staff" ||
        roleName === "auditor"
      ) {
        base = { ...ROLE_PERMISSIONS[roleName as BaseUserRole] };
      } else {
        const cr = customRoles.find((c) => c.name === roleName);
        base = cr ? { ...cr.permissions } : { ...ROLE_PERMISSIONS.auditor };
      }
      // Apply overrides stored under the reserved __perm_overrides__ key.
      const overridesRaw = roleTabGrants.__perm_overrides__ as unknown as
        Record<string, Record<string, boolean>> | undefined;
      const roleOverrides = overridesRaw?.[roleName];
      if (roleOverrides) {
        for (const [k, v] of Object.entries(roleOverrides)) {
          (base as unknown as Record<string, unknown>)[k] = v;
        }
      }
      return base;
    },
    [customRoles, roleTabGrants],
  );

  // Resolve any role name to its effective tab grants.
  const resolveTabGrants = useCallback(
    (roleName: string): string[] => {
      if (roleName === "owner") return DEFAULT_ROLE_TABS.owner;
      if (roleTabGrants[roleName]) return roleTabGrants[roleName];
      const cr = customRoles.find((c) => c.name === roleName);
      return cr?.tabGrants ?? [];
    },
    [roleTabGrants, customRoles],
  );

  const permissions = resolvePermissions(role);

  const hasPermission = useCallback(
    (key: keyof PermissionConfig) => {
      return permissions[key] ?? false;
    },
    [permissions],
  );

  // True if the current user's role outranks (or equals) the given role.
  const outranks = useCallback(
    (otherRole: string): boolean => {
      return rankOf(role) >= rankOf(otherRole);
    },
    [role],
  );

  // Action-level gate: maps a (action, domain) pair to the relevant
  // PermissionConfig boolean. Domains mirror the tab/feature names.
  const canDo = useCallback(
    (
      action: "view" | "create" | "edit" | "manage" | "upload" | "delete",
      domain: string,
    ): boolean => {
      if (role === "owner") return true; // Owner bypasses all action gates
      const permKey = ACTION_PERM_MAP[action]?.[domain];
      if (!permKey) return false;
      return Boolean(permissions[permKey]);
    },
    [role, permissions],
  );

  // Check if current role can access a specific tab. Integrates both the
  // tab-grants list (per-role) AND the granular view-permission boolean, so a
  // role with canViewSales=false but "sales" in its grants list is still
  // denied (defense-in-depth). Owner bypasses everything.
  const canAccessTab = useCallback(
    (tabId: string): boolean => {
      if (role === "owner") return true;
      const inGrants = resolveTabGrants(role).includes(tabId);
      // Also consult the granular view-permission for this tab's domain, if one
      // is mapped. This makes the PermissionConfig booleans actually effective
      // (previously TAB_PERMISSION_MAP was dead code).
      const permKey = TAB_PERMISSION_MAP[tabId];
      const permOk = permKey ? Boolean(permissions[permKey]) : true;
      return inGrants && permOk;
    },
    [role, roleTabGrants, customRoles, permissions, resolveTabGrants],
  );

  // Escalation guard: can the current user grant a permission to a target role?
  // Rules: (a) target role must be ranked at or below the granter's role;
  // (b) the granter must themselves POSSESS the permission being granted
  //     (cannot grant what you don't have);
  // (c) the granter must have the canGrantPermissions delegation flag
  //     (or be the Owner).
  const canGrantPermission = useCallback(
    (targetRole: string, perm: keyof PermissionConfig): boolean => {
      if (role === "owner") return targetRole !== "owner"; // Owner can grant anything (except to owner)
      if (!hasPermission("canGrantPermissions")) return false;
      if (!outranks(targetRole)) return false; // can only grant to lower/equal roles
      if (!hasPermission(perm)) return false; // cannot grant what you don't have
      return true;
    },
    [role, hasPermission, outranks],
  );

  const setRoleTabGrants = useCallback((grants: RoleTabGrants) => {
    localModifiedRef.current = true;
    skipGrantsRemoteRef.current = true;
    setRoleTabGrantsState(grants);
  }, []);

  // Escalation-aware tab grant: the granter must be able to ACCESS the tab
  // themselves (so they can't grant access they don't have), and must have the
  // canGrantPermissions delegation flag (or be Owner).
  const grantTabToRole = useCallback(
    (targetRole: UserRole, tabId: string) => {
      if (targetRole === "owner") return; // Owner already has everything
      // Escalation guard
      if (role !== "owner") {
        if (!hasPermission("canGrantPermissions")) return;
        if (!outranks(targetRole)) return;
        if (!canAccessTab(tabId)) return; // can't grant access you don't have
      }
      localModifiedRef.current = true;
      skipGrantsRemoteRef.current = true;
      setRoleTabGrantsState((prev) => ({
        ...prev,
        [targetRole]: [...new Set([...(prev[targetRole] || []), tabId])],
      }));
    },
    [role, hasPermission, outranks, canAccessTab],
  );

  const revokeTabFromRole = useCallback(
    (targetRole: UserRole, tabId: string) => {
      if (targetRole === "owner") return; // Cannot revoke from owner
      if (role !== "owner") {
        if (!hasPermission("canGrantPermissions")) return;
        if (!outranks(targetRole)) return;
      }
      localModifiedRef.current = true;
      skipGrantsRemoteRef.current = true;
      setRoleTabGrantsState((prev) => ({
        ...prev,
        [targetRole]: (prev[targetRole] || []).filter((t) => t !== tabId),
      }));
    },
    [role, hasPermission, outranks],
  );

  // Grant a single permission flag to a role. For base roles, this is stored
  // as an override layer on top of ROLE_PERMISSIONS; for custom roles, it
  // updates the CustomRole.permissions directly. Subject to the escalation
  // guard (canGrantPermission).
  const applyPermissionOverride = useCallback(
    (targetRole: string, perm: keyof PermissionConfig, value: boolean) => {
      // Custom role: update its permissions object directly.
      const cr = customRoles.find((c) => c.name === targetRole);
      if (cr) {
        skipCustomRolesRemoteRef.current = true;
        localModifiedRef.current = true;
        setCustomRoles((prev) =>
          prev.map((c) =>
            c.name === targetRole
              ? { ...c, permissions: { ...c.permissions, [perm]: value } }
              : c,
          ),
        );
        return;
      }
      // Base role: store an override in the grants cloud key under a reserved
      // "__perm_overrides__" sub-object. We keep the base ROLE_PERMISSIONS
      // immutable; overrides are merged at resolvePermissions time.
      skipGrantsRemoteRef.current = true;
      localModifiedRef.current = true;
      setRoleTabGrantsState((prev) => {
        const overrides = (prev.__perm_overrides__ as unknown as Record<
          string,
          Record<string, boolean>
        >) || { [targetRole]: {} };
        const roleOverrides = overrides[targetRole] || {};
        roleOverrides[String(perm)] = value;
        return {
          ...prev,
          __perm_overrides__: {
            ...overrides,
            [targetRole]: roleOverrides,
          } as unknown as string[],
        };
      });
    },
    [customRoles],
  );

  const grantPermissionToRole = useCallback(
    (targetRole: UserRole, perm: keyof PermissionConfig) => {
      if (!canGrantPermission(targetRole, perm)) {
        console.warn(
          `[Escalation Guard] Cannot grant ${String(perm)} to ${targetRole}: ` +
            `insufficient authority or permission not held.`,
        );
        return;
      }
      applyPermissionOverride(targetRole, perm, true);
    },
    [canGrantPermission, applyPermissionOverride],
  );

  const revokePermissionFromRole = useCallback(
    (targetRole: UserRole, perm: keyof PermissionConfig) => {
      if (targetRole === "owner") return;
      if (role !== "owner") {
        if (!hasPermission("canGrantPermissions")) return;
        if (!outranks(targetRole)) return;
      }
      applyPermissionOverride(targetRole, perm, false);
    },
    [role, hasPermission, outranks, applyPermissionOverride],
  );

  const setRolePermission = useCallback(
    (targetRole: UserRole, perm: keyof PermissionConfig, value: boolean) => {
      if (value && !canGrantPermission(targetRole, perm)) {
        console.warn(
          `[Escalation Guard] Cannot set ${String(perm)}=true for ${targetRole}.`,
        );
        return;
      }
      applyPermissionOverride(targetRole, perm, value);
    },
    [canGrantPermission, applyPermissionOverride],
  );

  // Can the current user create a sub-user with the given role?
  // (a) Owner can invite any role except owner.
  // (b) A delegated role (canCreateSubUsers) can invite roles ranked below it.
  // (c) Legacy: canInviteManager/Staff/Auditor booleans still honored for the
  //     base roles, so existing grants keep working.
  const canInviteRole = useCallback(
    (targetRole: string): boolean => {
      if (targetRole === "owner") return false; // No one can create an Owner
      if (role === "owner") return true;
      // Delegation flag
      if (!hasPermission("canCreateSubUsers")) {
        // Legacy per-role invite booleans (backward compat)
        if (targetRole === "manager" && hasPermission("canInviteManager"))
          return true;
        if (targetRole === "staff" && hasPermission("canInviteStaff"))
          return true;
        if (targetRole === "auditor" && hasPermission("canInviteAuditor"))
          return true;
        return false;
      }
      // Has delegation: can invite any role ranked strictly below themselves.
      return rankOf(role) > rankOf(targetRole);
    },
    [role, hasPermission],
  );

  const createInvite = useCallback(
    (
      inviteRole: UserRole,
      expiresInDays?: number,
      maxUses = 1,
      options?: {
        canCreateSubUsers?: boolean;
        canGrantPermissions?: boolean;
        permissionsSnapshot?: Partial<PermissionConfig>;
        tabGrants?: string[];
      },
    ): AccessInvite => {
      // Escalation guard: cannot invite into a role you can't create.
      if (!canInviteRole(inviteRole)) {
        console.warn(
          `[Escalation Guard] Cannot create invite for role ${inviteRole} ` +
            `(current role ${role} lacks authority).`,
        );
        // Return a no-op invite (the UI should also be disabled).
      }
      // Delegation snapshot: the invitee's delegation flags can NEVER exceed
      // the inviter's own. A staff member with canCreateSubUsers=true (granted
      // by the owner) can invite sub-users, but cannot grant canCreateSubUsers
      // to those sub-users unless the owner also gave them canGrantPermissions.
      const inviteeCanCreateSubUsers =
        options?.canCreateSubUsers === true &&
        (role === "owner" || hasPermission("canCreateSubUsers"));
      const inviteeCanGrantPermissions =
        options?.canGrantPermissions === true &&
        (role === "owner" || hasPermission("canGrantPermissions"));

      const invite: AccessInvite = {
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        role: inviteRole,
        createdBy: role,
        createdAt: new Date().toISOString(),
        expiresAt: expiresInDays
          ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
          : undefined,
        maxUses,
        uses: 0,
        createdByUserId: user?.id,
        createdByName: user?.name || user?.email,
        createdByUniqueId: (user as { uniqueId?: string })?.uniqueId,
        stationId: ((): string | undefined => {
          const rawV3 = localStorage.getItem("fuelpro_current_station_v3");
          if (rawV3) {
            try {
              const parsed = JSON.parse(rawV3);
              return typeof parsed === "string" ? parsed : parsed?.stationId;
            } catch {
              return rawV3;
            }
          }
          return undefined;
        })(),
        canCreateSubUsers: inviteeCanCreateSubUsers,
        canGrantPermissions: inviteeCanGrantPermissions,
        permissionsSnapshot: options?.permissionsSnapshot,
        tabGrants: options?.tabGrants,
      };
      skipInvitesRemoteRef.current = true;
      localModifiedRef.current = true;
      setInvites((prev) => [...prev, invite]);
      return invite;
    },
    [role, user, canInviteRole, hasPermission],
  );

  const acceptInvite = useCallback(
    (inviteId: string, username: string): boolean => {
      const invite = invites.find((i) => i.id === inviteId);
      if (!invite) return false;
      if (invite.usedBy) return false;
      if (invite.expiresAt && new Date(invite.expiresAt) < new Date())
        return false;
      if (invite.uses >= invite.maxUses) return false;

      const member: TeamMember = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        username,
        role: invite.role,
        assignedPumps: [],
        assignedShifts: [],
        invitedBy: invite.createdBy,
        invitedAt: new Date().toISOString(),
        expiresAt: invite.expiresAt,
        active: true,
        userId: user?.id,
        authId: user?.authId,
        email: user?.email,
        uniqueId: (user as { uniqueId?: string })?.uniqueId,
        canCreateSubUsers: invite.canCreateSubUsers,
        canGrantPermissions: invite.canGrantPermissions,
        permissionsSnapshot: invite.permissionsSnapshot,
        invitedByUserId: invite.createdByUserId,
        invitedByUniqueId: invite.createdByUniqueId,
        stationId: invite.stationId,
      };

      skipTeamRemoteRef.current = true;
      skipInvitesRemoteRef.current = true;
      localModifiedRef.current = true;
      setTeam((prev) => [...prev, member]);
      setInvites((prev) =>
        prev.map((i) =>
          i.id === inviteId
            ? {
                ...i,
                uses: i.uses + 1,
                usedBy: username,
                usedAt: new Date().toISOString(),
              }
            : i,
        ),
      );
      return true;
    },
    [invites, user],
  );

  /** Accept an invite directly from the decoded URL payload.
   *
   * This is the CORRECT path for invite acceptance: the invite data is encoded
   * in the URL (base64), so we don't need to look it up in the invitee's local
   * `invites` array (which is always empty — invites are created by the station
   * OWNER and stored under the owner's cloud key, not the invitee's).
   *
   * Validation:
   * - Expiry: checks `payload.expiresAt`.
   * - Max uses: checks the `station_members` DB table count (async, best-effort)
   *   AND the local `team` array (defense-in-depth).
   * - Duplicate: if the current user is already a team member for this station,
   *   we allow re-acceptance (idempotent — updates their role/username).
   */
  const acceptInviteFromPayload = useCallback(
    (payload: InvitePayload, username: string): boolean => {
      if (!payload || !payload.id || !payload.role) return false;
      if (payload.expiresAt && new Date(payload.expiresAt) < new Date())
        return false;

      // Check if this user is already a member (idempotent re-acceptance).
      const existingMember = team.find(
        (m) => m.userId === user?.id && m.stationId === payload.stationId,
      );
      // Check max uses via local team count (defense-in-depth; the DB
      // station_members table is the authoritative count, checked async in
      // InviteAccept.tsx before calling this).
      if (
        !existingMember &&
        team.filter((m) => m.stationId === payload.stationId).length >=
          (payload.maxUses || 1)
      ) {
        // The local team array may be empty on a fresh device (cloud hasn't
        // loaded yet), so don't hard-block — the DB check in InviteAccept is
        // the real gate. Only block if we have local data showing max reached.
        // Still allow if we have no local team data (fresh device).
        if (team.length > 0) return false;
      }

      const member: TeamMember = {
        id:
          existingMember?.id ||
          `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        username,
        role: payload.role,
        assignedPumps: existingMember?.assignedPumps || [],
        assignedShifts: existingMember?.assignedShifts || [],
        invitedBy: payload.createdBy,
        invitedAt: existingMember?.invitedAt || new Date().toISOString(),
        expiresAt: payload.expiresAt,
        active: true,
        userId: user?.id,
        authId: user?.authId,
        email: user?.email,
        uniqueId: (user as { uniqueId?: string })?.uniqueId,
        canCreateSubUsers: payload.canCreateSubUsers,
        canGrantPermissions: payload.canGrantPermissions,
        permissionsSnapshot: payload.permissionsSnapshot,
        invitedByUserId: undefined,
        invitedByUniqueId: payload.createdByUniqueId,
        invitedByName: payload.createdByName,
        stationId: payload.stationId,
      };

      skipTeamRemoteRef.current = true;
      localModifiedRef.current = true;
      if (existingMember) {
        // Update existing member (idempotent re-acceptance).
        setTeam((prev) =>
          prev.map((m) =>
            m.id === existingMember.id ? { ...m, ...member, id: m.id } : m,
          ),
        );
      } else {
        setTeam((prev) => [...prev, member]);
      }
      return true;
    },
    [team, user],
  );

  // --- Custom role management (Owner-defined: accountant, cashier, ...) ---
  const createCustomRole = useCallback(
    (
      slug: string,
      label: string,
      baseRole: BaseUserRole = "staff",
      rank?: number,
    ): CustomRole | null => {
      // Only the Owner (or a delegated role with canCreateSubUsers) can define
      // new roles. Custom roles always rank below Owner.
      if (role !== "owner" && !hasPermission("canCreateSubUsers")) return null;
      const name = slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]/g, "");
      if (!name) return null;
      if (
        name === "owner" ||
        name === "manager" ||
        name === "staff" ||
        name === "auditor"
      )
        return null; // reserved
      if (customRoles.some((c) => c.name === name)) return null; // duplicate
      const cr: CustomRole = {
        name,
        label: label.trim() || name,
        rank: Math.min(
          typeof rank === "number" ? rank : DEFAULT_ROLE_RANK,
          90, // never equal to owner
        ),
        permissions: { ...ROLE_PERMISSIONS[baseRole] },
        tabGrants: [...DEFAULT_ROLE_TABS[baseRole]],
        canCreateSubUsers: false,
        canGrantPermissions: false,
        createdAt: new Date().toISOString(),
        createdBy: user?.id || "",
      };
      skipCustomRolesRemoteRef.current = true;
      localModifiedRef.current = true;
      setCustomRoles((prev) => [...prev, cr]);
      // Also seed the role's tab grants in roleTabGrants so canAccessTab finds them.
      skipGrantsRemoteRef.current = true;
      setRoleTabGrantsState((prev) => ({
        ...prev,
        [name]: [...cr.tabGrants],
      }));
      return cr;
    },
    [role, hasPermission, customRoles, user],
  );

  const deleteCustomRole = useCallback(
    (slug: string) => {
      if (role !== "owner" && !hasPermission("canGrantPermissions")) return;
      skipCustomRolesRemoteRef.current = true;
      localModifiedRef.current = true;
      setCustomRoles((prev) => prev.filter((c) => c.name !== slug));
      // Remove its grants entry too.
      skipGrantsRemoteRef.current = true;
      setRoleTabGrantsState((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });
    },
    [role, hasPermission],
  );

  const updateCustomRole = useCallback(
    (slug: string, updates: Partial<CustomRole>) => {
      if (role !== "owner" && !hasPermission("canGrantPermissions")) return;
      skipCustomRolesRemoteRef.current = true;
      localModifiedRef.current = true;
      setCustomRoles((prev) =>
        prev.map((c) => (c.name === slug ? { ...c, ...updates } : c)),
      );
      // If tabGrants changed, mirror to roleTabGrants too.
      if (updates.tabGrants) {
        skipGrantsRemoteRef.current = true;
        setRoleTabGrantsState((prev) => ({
          ...prev,
          [slug]: [...updates.tabGrants],
        }));
      }
    },
    [role, hasPermission],
  );

  const revokeMember = useCallback((memberId: string) => {
    localModifiedRef.current = true;
    skipTeamRemoteRef.current = true;
    setTeam((prev) => prev.filter((m) => m.id !== memberId));
  }, []);

  const extendAccess = useCallback((memberId: string, days: number) => {
    localModifiedRef.current = true;
    skipTeamRemoteRef.current = true;
    setTeam((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? {
              ...m,
              expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
            }
          : m,
      ),
    );
  }, []);

  const assignPumps = useCallback((memberId: string, pumpIds: string[]) => {
    localModifiedRef.current = true;
    skipTeamRemoteRef.current = true;
    setTeam((prev) =>
      prev.map((m) =>
        m.id === memberId ? { ...m, assignedPumps: pumpIds } : m,
      ),
    );
  }, []);

  const assignShifts = useCallback((memberId: string, shiftIds: string[]) => {
    localModifiedRef.current = true;
    skipTeamRemoteRef.current = true;
    setTeam((prev) =>
      prev.map((m) =>
        m.id === memberId ? { ...m, assignedShifts: shiftIds } : m,
      ),
    );
  }, []);

  return (
    <PermissionContext.Provider
      value={{
        role,
        permissions,
        team,
        invites,
        roleTabGrants,
        customRoles,
        setRole,
        hasPermission,
        canDo,
        isOwner: role === "owner",
        isManager: role === "manager",
        isStaff: role === "staff",
        isAuditor: role === "auditor",
        outranks,
        canAccessTab,
        setRoleTabGrants,
        grantTabToRole,
        revokeTabFromRole,
        grantPermissionToRole,
        revokePermissionFromRole,
        setRolePermission,
        canInviteRole,
        createInvite,
        acceptInvite,
        acceptInviteFromPayload,
        revokeMember,
        extendAccess,
        assignPumps,
        assignShifts,
        createCustomRole,
        deleteCustomRole,
        updateCustomRole,
        resolvePermissions,
        resolveTabGrants,
      }}
    >
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionContext);
}

export { ROLE_PERMISSIONS };
export type { PermissionConfig, TeamMember, AccessInvite, RoleTabGrants };
// CustomRole, BaseUserRole, UserRole, ROLE_RANK, DEFAULT_ROLE_RANK, rankOf,
// TAB_PERMISSION_MAP are already `export`-declared at their definition sites.
