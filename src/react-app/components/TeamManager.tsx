import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Users,
  Link2,
  Plus,
  Clock,
  UserCheck,
  User,
  Eye,
  Fuel,
  Calendar,
  Copy,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Ban,
  Mail,
  MessageCircle,
  ToggleLeft,
  ToggleRight,
  Crown,
  KeyRound,
  Settings2,
  Trash2,
  BadgeCheck,
  ShieldAlert,
  Share2,
  UserPlus,
  Search,
  Download,
  Activity,
  Zap,
  Lock,
  Unlock,
  Users2,
  TrendingUp,
  X,
  CheckSquare,
  Square,
  UserX,
  ClipboardList,
  Target,
  Radio,
  Wifi,
  WifiOff,
  Layers,
  GitBranch,
  Phone,
  IdCard,
  Building2,
  Edit3,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import {
  usePermissions,
  type UserRole,
  type BaseUserRole,
  type CustomRole,
  type PermissionConfig,
  DEFAULT_ROLE_TABS,
  rankOf,
} from "@/react-app/context/PermissionContext";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import SubTabBar from "@/react-app/components/SubTabBar";
import MemberSuggestionsPanel from "@/react-app/components/MemberSuggestionsPanel";
import ShiftManagement from "@/react-app/components/ShiftManagement";
import AttendantPerformance from "@/react-app/components/AttendantPerformance";
import {
  getAccessCodes,
  createAccessCode,
  deleteAccessCode,
  toggleAccessCode,
  updateAccessCodeMode,
  accessModeLabel,
  type AccessMode,
  type StationAccessCode,
} from "@/react-app/lib/station-access-code-service";
import {
  publishStationSnapshot,
  type StationSnapshot,
} from "@/react-app/lib/station-snapshot-service";
import { getDetectedCurrency } from "@/react-app/lib/currency";
import {
  normalizeFuelType,
  getFuelLabel,
  getFuelCode,
} from "@/react-app/config/pricing";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { useSubTabDeepLink } from "@/react-app/hooks/useSubTabDeepLink";

const BASE_ROLES: BaseUserRole[] = ["manager", "staff", "auditor"];

const ROLE_LABELS: Record<
  string,
  { label: string; color: string; desc: string }
> = {
  owner: {
    label: "Owner",
    color:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    desc: "Full access, cannot be revoked. Root authority.",
  },
  manager: {
    label: "Manager",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    desc: "Operational control, can invite Staff/Auditor (if delegated).",
  },
  staff: {
    label: "Staff",
    color:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    desc: "Daily tasks, assigned pumps/shifts.",
  },
  auditor: {
    label: "Auditor",
    color:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    desc: "Read-only audit and reports.",
  },
};

const ROLE_ICONS: Record<string, any> = {
  owner: Crown,
  manager: UserCheck,
  staff: User,
  auditor: Eye,
};

// Safe accessors with fallback so an unknown/custom role never crashes the UI.
const getRoleIcon = (role: string): any => ROLE_ICONS[role] || BadgeCheck;
const getRoleLabel = (role: string) =>
  ROLE_LABELS[role] || {
    label: role.charAt(0).toUpperCase() + role.slice(1),
    color:
      "bg-gray-100 text-gray-700 dark:bg-white dark:bg-gray-900/30 dark:text-gray-300",
    desc: "Custom role defined by the Owner.",
  };

// Human-readable labels for the PermissionConfig booleans (grouped).
const PERMISSION_GROUPS: {
  group: string;
  perms: { key: keyof PermissionConfig; label: string }[];
}[] = [
  {
    group: "Sales & POS",
    perms: [
      { key: "canViewSales", label: "View Sales" },
      { key: "canCreateSales", label: "Create Sales" },
      { key: "canEditSales", label: "Edit Sales" },
      { key: "canViewPOS", label: "View POS" },
      { key: "canUsePOS", label: "Use POS" },
      { key: "canViewLiveTransactions", label: "Live Transactions" },
    ],
  },
  {
    group: "Inventory & Fuel",
    perms: [
      { key: "canViewInventory", label: "View Inventory" },
      { key: "canManageInventory", label: "Manage Inventory" },
      { key: "canViewFuelPrices", label: "View Fuel Prices" },
      { key: "canEditFuelPrices", label: "Edit Fuel Prices" },
      { key: "canChangePumpCount", label: "Change Pump Count" },
      { key: "canManageFuelTypes", label: "Manage Fuel Types" },
    ],
  },
  {
    group: "Money & Payments",
    perms: [
      { key: "canViewMpesa", label: "View M-PESA" },
      { key: "canProcessMpesa", label: "Process M-PESA" },
      { key: "canViewCredit", label: "View Credit" },
      { key: "canManageCredit", label: "Manage Credit" },
      { key: "canViewDebt", label: "View Debts" },
      { key: "canManageDebt", label: "Manage Debts" },
      { key: "canViewLoyalty", label: "View Loyalty" },
      { key: "canManageLoyalty", label: "Manage Loyalty" },
    ],
  },
  {
    group: "People & HR",
    perms: [
      { key: "canViewEmployees", label: "View Team" },
      { key: "canManageEmployees", label: "Manage Team" },
      { key: "canViewPayroll", label: "View Payroll" },
      { key: "canRunPayroll", label: "Run Payroll" },
      { key: "canViewShifts", label: "View Shifts" },
      { key: "canManageShifts", label: "Manage Shifts" },
      { key: "canAssignPumps", label: "Assign Pumps" },
      { key: "canAssignShifts", label: "Assign Shifts" },
    ],
  },
  {
    group: "Reports & Audit",
    perms: [
      { key: "canViewReports", label: "View Reports" },
      { key: "canExportReports", label: "Export Reports" },
      { key: "canViewAnalytics", label: "View Analytics" },
      { key: "canViewAudit", label: "View Audit Trail" },
      { key: "canManageAudit", label: "Manage Audit Trail" },
    ],
  },
  {
    group: "System & Documents",
    perms: [
      { key: "canViewDocuments", label: "View Documents" },
      { key: "canManageDocuments", label: "Upload/Manage Docs" },
      { key: "canViewSettings", label: "View Settings" },
      { key: "canManageSettings", label: "Manage Settings" },
      { key: "canViewIntegrations", label: "View Integrations" },
      { key: "canManageIntegrations", label: "Manage Integrations" },
      { key: "canViewCloud", label: "View Cloud Data" },
      { key: "canManageCloud", label: "Manage Cloud Data" },
      { key: "canViewRegional", label: "Regional/Compliance" },
      { key: "canViewCommunication", label: "Communication" },
      { key: "canViewNews", label: "News" },
      { key: "canViewAI", label: "View AI" },
      { key: "canUseAI", label: "Use AI" },
    ],
  },
  {
    group: "Delegation & Invite Power",
    perms: [
      { key: "canInviteManager", label: "Invite Managers" },
      { key: "canInviteStaff", label: "Invite Staff" },
      { key: "canInviteAuditor", label: "Invite Auditors" },
      { key: "canCreateSubUsers", label: "Create Sub-Users (delegation)" },
      { key: "canGrantPermissions", label: "Grant Permissions (delegation)" },
      { key: "canRevokeAccess", label: "Revoke Access" },
      { key: "canSetTimeLimits", label: "Set Time Limits" },
      { key: "canManageTabs", label: "Manage Tab Access" },
    ],
  },
];

// Shift templates — configurable labels that match ShiftManagement's
// templates. These are display labels; the actual shift schedule is
// managed in the Shifts sub-tab. Kept here for the pump/shift assignment UI.
const SHIFT_TEMPLATES = [
  { id: "morning", label: "Morning (06:00-14:00)" },
  { id: "afternoon", label: "Afternoon (14:00-22:00)" },
  { id: "night", label: "Night (22:00-06:00)" },
];

// Quick role presets — one-click templates for common station roles.
// Each preset pre-fills the custom-role creator with a sensible default
// permission set. The owner can still fine-tune after creation.
const ROLE_PRESETS: {
  slug: string;
  label: string;
  base: BaseUserRole;
  description: string;
  perms: Partial<PermissionConfig>;
}[] = [
  {
    slug: "cashier",
    label: "Cashier",
    base: "staff",
    description: "Front-desk POS sales + basic inventory view.",
    perms: {
      canUsePOS: true,
      canViewPOS: true,
      canCreateSales: true,
      canViewSales: true,
      canViewInventory: true,
      canViewFuelPrices: true,
      canViewLiveTransactions: true,
      canProcessMpesa: true,
    },
  },
  {
    slug: "accountant",
    label: "Accountant",
    base: "manager",
    description: "Financial reporting, invoices, credit, expenses.",
    perms: {
      canViewSales: true,
      canViewReports: true,
      canExportReports: true,
      canViewAnalytics: true,
      canViewCredit: true,
      canManageCredit: true,
      canViewDebt: true,
      canManageDebt: true,
      canViewAudit: true,
      canViewInvoices: true,
    },
  },
  {
    slug: "pump-attendant",
    label: "Pump Attendant",
    base: "staff",
    description: "Pump operations + sales tracking only.",
    perms: {
      canUsePOS: true,
      canViewPOS: true,
      canCreateSales: true,
      canViewFuelPrices: true,
      canViewShifts: true,
    },
  },
  {
    slug: "supervisor",
    label: "Shift Supervisor",
    base: "manager",
    description: "Manage shifts, assign pumps, view all operational data.",
    perms: {
      canViewSales: true,
      canCreateSales: true,
      canEditSales: true,
      canViewPOS: true,
      canUsePOS: true,
      canManageShifts: true,
      canAssignShifts: true,
      canAssignPumps: true,
      canViewEmployees: true,
      canManageEmployees: true,
      canViewInventory: true,
      canManageInventory: true,
    },
  },
  {
    slug: "auditor-readonly",
    label: "Read-Only Auditor",
    base: "auditor",
    description: "Full read-only access to all reports + audit trail.",
    perms: {
      canViewSales: true,
      canViewReports: true,
      canExportReports: true,
      canViewAnalytics: true,
      canViewAudit: true,
      canViewInventory: true,
      canViewCredit: true,
      canViewDebt: true,
      canViewPayroll: true,
      canViewFuelPrices: true,
    },
  },
];

function makeInviteLink(inv: any, station: any): string {
  const payload = JSON.stringify({
    id: inv.id,
    role: inv.role,
    stationName: station?.name || "Fuel Station",
    stationId: station?.id || "default",
    createdBy: inv.createdBy,
    createdByName: inv.createdByName,
    createdByUniqueId: inv.createdByUniqueId,
    expiresAt: inv.expiresAt,
    maxUses: inv.maxUses,
    canCreateSubUsers: inv.canCreateSubUsers,
    canGrantPermissions: inv.canGrantPermissions,
    // NOTE: permissionsSnapshot is intentionally omitted from the URL payload
    // to keep the link short (URLs > 2000 chars are truncated by some
    // browsers/email clients). The snapshot is re-resolved from the owner's
    // cloud config on acceptance via PermissionContext.
    tabGrants: inv.tabGrants,
  });
  const base64 = btoa(payload)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return window.location.origin + "/#/join/" + base64;
}

export default function TeamManager() {
  const { user, bindings, terminateRole } = useAuth();
  const { currentStation } = useStations();
  const { state } = useFuel();
  const stationId = currentStation?.id;
  // Canonical fuel types (fuel_types_config, via useStationFuelTypes).
  // `state.fuelTypes` is never populated — reading it produced an EMPTY
  // shared snapshot even when the owner set prices in Fuel Type Manager.
  const fuelTypeApi = useStationFuelTypes(stationId);
  const {
    role,
    team,
    invites,
    customRoles,
    hasPermission,
    isOwner,
    canInviteRole,
    createInvite,
    revokeMember,
    extendAccess,
    assignPumps,
    assignShifts,
    roleTabGrants,
    setRoleTabGrants,
    grantTabToRole,
    revokeTabFromRole,
    setRolePermission,
    createCustomRole,
    deleteCustomRole,
    updateCustomRole,
    resolvePermissions,
    resolveTabGrants,
    outranks,
  } = usePermissions();
  const [showCreate, setShowCreate] = useState(false);
  const [inviteRole, setInviteRole] = useState<UserRole>("staff");
  const [expireDays, setExpireDays] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [inviteCanCreateSubUsers, setInviteCanCreateSubUsers] = useState(false);
  const [inviteCanGrantPermissions, setInviteCanGrantPermissions] =
    useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  // Per-member extend-days state so editing one member doesn't change another's.
  const [extendDaysByMember, setExtendDaysByMember] = useState<
    Record<string, string>
  >({});
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);
  const [showFeatureGrant, setShowFeatureGrant] = useState(false);
  // Custom role creator state
  const [showRoleCreator, setShowRoleCreator] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newRoleBase, setNewRoleBase] = useState<BaseUserRole>("staff");
  // Per-role permission editor state: which role's permission panel is open
  const [permEditorRole, setPermEditorRole] = useState<string | null>(null);
  // Inner sub-tab: "Team" (this component, now includes Access Codes) vs
  // "Roles & Permissions" vs "Shifts" (the formerly-standalone ShiftManagement
  // module, now hosted here) vs "Activity" (new: team activity + health).
  const [activeView, setActiveView] = useState<
    "team" | "shifts" | "roles" | "activity" | "performance"
  >("team");
  // Deep-link: QuickSearch/AIChatbot can jump straight into a sub-tab.
  useSubTabDeepLink("team", setActiveView);

  // ── Search + filter for the team members roster ──
  const [memberSearch, setMemberSearch] = useState("");
  const [memberFilterRole, setMemberFilterRole] = useState<string>("all");
  const [memberFilterMethod, setMemberFilterMethod] = useState<string>("all");
  const [memberFilterStatus, setMemberFilterStatus] = useState<string>("all");

  // ── Bulk select for members (bulk enable/disable/delete) ──
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const [showBulkActions, setShowBulkActions] = useState(false);

  // ── Toast notification ──
  const [toast, setToast] = useState("");
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  // ── Access Codes (lifted into the main component so the unified Team
  //    Access view can show combined stats + a combined member list that
  //    blends invite-accepted members with access-code members). Previously
  //    this state lived only inside AccessCodesView.
  const [accessCodes, setAccessCodes] = useState<StationAccessCode[]>([]);
  // Unified "Add Team Member" entry: "invite" (full account via link) or
  // "code" (no-signup access code). Blend the two access methods into one
  // entry point.
  const [addMode, setAddMode] = useState<"invite" | "code">("invite");

  // ── Member detail drawer (replaces the inline expand for richer detail).
  //    Binds the 6 areas: clicking a member opens a slide-over panel showing
  //    their role, access method, assigned pumps/shifts, audit log, and the
  //    quick actions (extend, revoke, enable/disable) in one place.
  const [drawerMemberId, setDrawerMemberId] = useState<string | null>(null);

  // ── Live sync status — shows whether the access-code store is synced to
  //    the cloud (green) or stale/offline (amber). Bind to the cloudStorage
  //    service realtime subscription so the badge reflects the real state.
  const [syncOnline, setSyncOnline] = useState(true);

  // ── Onboarding checklist — defined later (after combinedMembers/invites)

  // Tab ID to human-readable label mapping
  const tabIdToLabel: Record<string, string> = {
    dashboard: "Dashboard",
    sales: "Sales",
    pos: "POS",
    inventory: "Inventory",
    livetransaction: "M-PESA Live",
    offloading: "Offloading",
    delivery: "Deliveries",
    invoice: "Invoices",
    credit: "Credit",
    debt: "Debts",
    mpesa: "M-PESA",
    payroll: "Payroll",
    shifts: "Shifts",
    customers: "Customers",
    quality: "Quality",
    fuelsalesreport: "Fuel Report",
    reports: "Reports",
    analytics: "Analytics",
    audit: "Audit Trail",
    communication: "Communication",
    news: "News",
    data: "Data Manager",
    integration: "Integrations",
    regional: "Regional",
    fueltypes: "Fuel Types",
    team: "Team Manager",
    documents: "Documents",
  };

  const currentBinding = bindings.find(
    (b) => b.active && b.authId === user?.authId,
  );

  // The current user can manage permissions if they are the Owner OR have the
  // canGrantPermissions delegation flag.
  const canManagePermissions = isOwner || hasPermission("canGrantPermissions");
  const canRevoke = isOwner || hasPermission("canRevokeAccess");
  const canSetLimits = isOwner || hasPermission("canSetTimeLimits");
  const canAssign =
    isOwner ||
    hasPermission("canAssignPumps") ||
    hasPermission("canAssignShifts");
  // Can create custom roles: Owner, or a delegated role with canCreateSubUsers.
  const canCreateRoles = isOwner || hasPermission("canCreateSubUsers");

  // Derive the real pump options from the station's configured pumps so pump
  // assignments reference actual pumps (not the old hardcoded PMS-/AGO-/IK-
  // list which rarely matched a station's real pumps). Includes ALL fuel
  // types (petrol, diesel, kerosene, LPG, V-Power, etc.) so a station with
  // 5 fuel types shows all its pumps. Falls back to sensible defaults only
  // when no pumps are configured yet (pre-setup wizard).
  const pumpOptions: { id: string; label: string }[] = (() => {
    const out: { id: string; label: string }[] = [];
    const addPumps = (
      pumps: { id: string; name?: string }[] | undefined,
      fallbackPrefix: string,
    ) => {
      if (pumps && pumps.length > 0) {
        pumps.forEach((p, i) =>
          out.push({
            id: p.id || `${fallbackPrefix}-${i + 1}`,
            label: p.name || `${fallbackPrefix.toUpperCase()} Pump ${i + 1}`,
          }),
        );
      }
    };
    addPumps(state.pmsPumps as { id: string; name?: string }[], "pms");
    addPumps(state.agoPumps as { id: string; name?: string }[], "ago");
    // Also include pumps for non-petrol/diesel fuel types (kerosene, LPG,
    // V-Power, etc.) stored in state.fuelPumpsByType.
    if (state.fuelPumpsByType) {
      for (const [canonical, pumps] of Object.entries(state.fuelPumpsByType)) {
        if (canonical === "petrol" || canonical === "diesel") continue;
        addPumps(pumps as { id: string; name?: string }[], canonical);
      }
    }
    // Fallback when the station has no pumps configured yet.
    if (out.length === 0) {
      return [
        { id: "pms-1", label: "PMS Pump 1" },
        { id: "pms-2", label: "PMS Pump 2" },
        { id: "ago-1", label: "AGO Pump 1" },
        { id: "ago-2", label: "AGO Pump 2" },
        { id: "ik-1", label: "IK Pump 1" },
        { id: "lpg-1", label: "LPG Pump 1" },
        { id: "vpw-1", label: "VPW Pump 1" },
      ];
    }
    return out;
  })();

  // Shift options — derived from SHIFT_TEMPLATES so labels stay in sync with
  // the ShiftManagement module. Used for the pump/shift assignment UI.
  const shiftOptions = SHIFT_TEMPLATES.map((s) => s.label);

  const handleCreateInvite = () => {
    const r = inviteRole;
    // Escalation guard: the context's createInvite also guards, but we check
    // here so the UI can disable the button.
    if (!canInviteRole(r)) return;
    const days = expireDays ? parseInt(expireDays) : undefined;
    const uses = parseInt(maxUses) || 1;
    // Pass the delegation options. The context clamps them to what the
    // inviter is actually allowed to grant (escalation guard).
    createInvite(r, days, uses, {
      canCreateSubUsers: inviteCanCreateSubUsers,
      canGrantPermissions: inviteCanGrantPermissions,
    });
    // Reset delegation toggles for the next invite.
    setInviteCanCreateSubUsers(false);
    setInviteCanGrantPermissions(false);
    setShowCreate(false);
  };

  const getLink = (inv: (typeof invites)[0]) =>
    makeInviteLink(inv, currentStation);

  const copyToClipboard = async (text: string): Promise<boolean> => {
    // Try modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        /* fallback */
      }
    }
    // Fallback: create textarea and use execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyLink = async (inv: (typeof invites)[0]) => {
    const link = getLink(inv);
    const ok = await copyToClipboard(link);
    if (ok) {
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(""), 3000);
    }
  };

  const handleShareWhatsApp = (inv: (typeof invites)[0]) => {
    const link = encodeURIComponent(getLink(inv));
    const text = encodeURIComponent(
      `You're invited to join ${currentStation?.name || "Fuel Station"} as ${inv.role}! Click the link to accept:`,
    );
    window.open(`https://wa.me/?text=${text}%20${link}`, "_blank");
  };

  const handleShareEmail = (inv: (typeof invites)[0]) => {
    const link = getLink(inv);
    const subject = encodeURIComponent(
      `Invitation to join ${currentStation?.name || "Fuel Station"}`,
    );
    const body = encodeURIComponent(
      `Hello,\n\nYou've been invited to join ${currentStation?.name || "Fuel Station"} as a ${inv.role}.\n\nClick the link below to accept your invitation:\n\n${link}\n\nThis link works on any device.`,
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  // Build the list of roles the current user can invite into. Uses the
  // escalation-aware canInviteRole helper so a delegated Manager sees only
  // roles below their rank (staff/auditor/custom), and the Owner sees all.
  const availableRoles: { id: string; label: string }[] = [];
  for (const r of BASE_ROLES) {
    if (canInviteRole(r))
      availableRoles.push({ id: r, label: getRoleLabel(r).label });
  }
  for (const cr of customRoles) {
    if (canInviteRole(cr.name)) {
      availableRoles.push({ id: cr.name, label: cr.label });
    }
  }

  const activeInvites = invites.filter(
    (i) => !i.usedBy && (!i.expiresAt || new Date(i.expiresAt) > new Date()),
  );
  const usedInvites = invites.filter((i) => i.usedBy);
  const expiredInvites = invites.filter(
    (i) => i.expiresAt && new Date(i.expiresAt) < new Date() && !i.usedBy,
  );

  // Load access codes (lifted) so the unified stats + member list can
  // reference them alongside invite-accepted members.
  const loadAccessCodes = useCallback(async () => {
    try {
      const data = await getAccessCodes(currentStation?.id);
      setAccessCodes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load access codes:", err);
    }
  }, [currentStation?.id]);
  useEffect(() => {
    loadAccessCodes();
  }, [loadAccessCodes]);

  // Build + publish a read-only snapshot of the station's operational data
  // to a PUBLIC Supabase Storage object, so members logged in via access
  // code (no Supabase session) can view the approved sections read-only.
  const [publishing, setPublishing] = useState(false);
  const [lastPublished, setLastPublished] = useState<number | null>(null);

  const publishSnapshot = useCallback(async () => {
    if (!stationId) return;
    setPublishing(true);
    try {
      // Fuel prices — canonical fuel_types_config (Fuel Type Manager +
      // Price Scheduler source), fall back to legacy pmsPrice/agoPrice only
      // for stations that haven't configured fuel types yet.
      const fuelPrices: StationSnapshot["fuelPrices"] = [];
      for (const ft of fuelTypeApi.fuelTypes) {
        if (ft.active === false) continue;
        fuelPrices.push({
          label: ft.localName || getFuelLabel(ft.name || ""),
          price: Number(ft.price) || 0,
          code: ft.code || getFuelCode(ft.name || ""),
        });
      }
      if (fuelPrices.length === 0) {
        // Legacy fallback
        if (state.pmsPrice)
          fuelPrices.push({
            label: "Super Petrol",
            price: state.pmsPrice,
            code: "PMS",
          });
        if (state.agoPrice)
          fuelPrices.push({
            label: "Diesel",
            price: state.agoPrice,
            code: "AGO",
          });
      }

      // Pumps — count per fuel type
      const pumps: StationSnapshot["pumps"] = [];
      if (state.fuelPumpsByType) {
        for (const [canonical, pumpArr] of Object.entries(
          state.fuelPumpsByType,
        )) {
          pumps.push({
            fuel: getFuelLabel(canonical),
            count: Array.isArray(pumpArr) ? pumpArr.length : 0,
          });
        }
      }
      if (pumps.length === 0) {
        pumps.push({
          fuel: "Super Petrol",
          count: state.pmsPumps?.length || 0,
        });
        pumps.push({ fuel: "Diesel", count: state.agoPumps?.length || 0 });
      }

      // Tank levels — per fuel type
      const tankLevels: StationSnapshot["tankLevels"] = [];
      if (state.fuelTankValuesByType) {
        for (const [canonical, v] of Object.entries(
          state.fuelTankValuesByType,
        )) {
          tankLevels.push({
            fuel: getFuelLabel(canonical),
            opening: Number(v?.opening) || 0,
            closing: Number(v?.closing) || 0,
          });
        }
      }
      if (tankLevels.length === 0) {
        tankLevels.push({
          fuel: "Super Petrol",
          opening: state.pmsTankOpening || 0,
          closing: state.pmsTankClosing || 0,
        });
        tankLevels.push({
          fuel: "Diesel",
          opening: state.agoTankOpening || 0,
          closing: state.agoTankClosing || 0,
        });
      }

      // Recent sales — from salesHistory (compact blob)
      const salesArr = Object.values(state.salesHistory || {}).flat() as any[];
      const recentSales: StationSnapshot["recentSales"] = salesArr
        .slice(-20)
        .reverse()
        .map((s: any) => ({
          invoice: s.invoiceNumber || s.invoice || s.id,
          date: s.date || s.createdAt,
          total: Number(s.total || s.totalAmount || s.amount) || 0,
          fuel:
            s.fuelType ||
            s.fuel ||
            getFuelLabel(normalizeFuelType(s.fuelType || s.fuel || "")) ||
            "",
          litres: Number(s.litres || s.litresSold || s.quantity) || 0,
          payment: s.paymentMethod || s.payment || "",
        }));

      // Sales KPIs
      const totalRevenue = recentSales.reduce(
        (sum, s) => sum + (s.total || 0),
        0,
      );
      const totalFuelSold = recentSales.reduce(
        (sum, s) => sum + (s.litres || 0),
        0,
      );

      // Invoices
      const invoicesArr = Object.values(state.invoices || {}) as any[];
      const invoices: StationSnapshot["invoices"] = invoicesArr
        .slice(-20)
        .reverse()
        .map((inv: any) => ({
          number: inv.invoiceNumber || inv.number || inv.id,
          customer: inv.customer || inv.clientName || "",
          total: Number(inv.totalAmount || inv.total || inv.amount) || 0,
          date: inv.date || inv.createdAt || inv.issueDate,
          status: inv.status || inv.paid ? "paid" : "unpaid",
        }));

      // Offloading
      const offloading: StationSnapshot["offloading"] = (
        state.offloadingRecords || []
      )
        .slice(-20)
        .reverse()
        .map((o: any) => ({
          truck: o.truckNumber || o.truck || o.vehicle,
          fuel:
            o.fuelType ||
            getFuelLabel(normalizeFuelType(o.fuelType || "")) ||
            "",
          litres: Number(o.litres || o.quantity || o.volume) || 0,
          date: o.date || o.offloadDate,
        }));

      // Expenses
      const expenses: StationSnapshot["expenses"] = (state.expenses || [])
        .slice(-20)
        .reverse()
        .map((e: any) => ({
          category: e.category || e.type || "Other",
          amount: Number(e.amount || e.cost) || 0,
          date: e.date || e.createdAt,
        }));

      // Employees (team)
      const employees: StationSnapshot["employees"] = (state.employees || [])
        .slice(0, 50)
        .map((e: any) => ({
          name: e.name || e.fullName || e.employeeName || "",
          role: e.role || e.position || "",
          status: e.status || (e.active ? "active" : "inactive"),
        }));

      // Credit accounts (read-only names + balances) — loaded from the
      // credit_accounts cloud key via cloudStorageService. We read it here
      // so the member sees real credit data without a Supabase session.
      let creditAccounts: StationSnapshot["creditAccounts"] = [];
      try {
        const { cloudStorageService } =
          await import("@/react-app/lib/cloud-storage-service");
        const accts = await cloudStorageService.get<any[]>(
          "credit_accounts",
          stationId,
        );
        if (Array.isArray(accts)) {
          creditAccounts = accts.slice(0, 50).map((a: any) => ({
            name: a.customerName || a.name || "",
            balance: Number(a.balance || a.outstandingBalance || 0) || 0,
            limit: Number(a.creditLimit || a.limit || 0) || 0,
            status: a.status || "active",
          }));
        }
      } catch {
        /* credit optional */
      }

      // ── Extended coverage (member full-site portal) ────────────────────
      // Each fetch is optional + best-effort; a missing set simply yields []
      // for that section. We gate on the member's OWN cloud via the public
      // snapshot, so NO RLS secrets ever leak — only what the owner shares.
      const getCloud = async <T = any[],>(key: string): Promise<T> => {
        try {
          const { cloudStorageService } =
            await import("@/react-app/lib/cloud-storage-service");
          const val = await cloudStorageService.get<T>(key, stationId);
          return val;
        } catch {
          return undefined as unknown as T;
        }
      };

      // Deliveries — from the compact blob (deliveryData.rows)
      const deliveries: StationSnapshot["deliveries"] = Array.isArray(
        state.deliveryData?.rows,
      )
        ? state.deliveryData.rows
            .slice(-30)
            .reverse()
            .map((d: any) => ({
              date: d.date,
              reg: d.reg || d.vehicle || d.truck,
              fuel: d.fuel || "",
              litres: Number(d.litres || 0),
              amount: Number(d.amount || 0),
              name: d.name || "",
              debt: Number(d.debt || 0),
            }))
        : [];

      // Customers — from state.clients (record) + loyalty_customers fallback
      let customers: StationSnapshot["customers"] = [];
      try {
        const clientsObj = state.clients || ({} as any);
        customers = Object.values(clientsObj)
          .slice(0, 50)
          .map((c: any) => ({
            name: c.name || c.customerName || "",
            phone: c.phone || c.contact || "",
            email: c.email || "",
          }));
      } catch {
        /* customers optional */
      }
      if (customers.length === 0) {
        const loy = await getCloud<any[]>("loyalty_customers");
        if (Array.isArray(loy)) {
          customers = loy.slice(0, 50).map((c: any) => ({
            name: c.name || c.customerName || "",
            phone: c.phone || "",
            email: c.email || "",
          }));
        }
      }

      // Suppliers + purchase orders
      const purchases: StationSnapshot["purchases"] = [];
      const suppliers = await getCloud<any[]>("suppliers_data");
      if (Array.isArray(suppliers)) {
        suppliers.slice(0, 50).forEach((s: any) =>
          purchases.push({
            type: "supplier",
            name: s.name || s.supplierName || "",
            amount: Number(s.balance || s.totalDue || 0) || 0,
            date: s.createdAt || s.date || "",
            status: s.status || "active",
          }),
        );
      }
      const purchaseOrders = await getCloud<any[]>("purchase_orders");
      if (Array.isArray(purchaseOrders)) {
        purchaseOrders.slice(0, 50).forEach((po: any) =>
          purchases.push({
            type: "purchase-order",
            name: po.supplierName || po.supplier || "Purchase Order",
            amount: Number(po.total || po.amount || 0) || 0,
            date: po.createdAt || po.date || "",
            status: po.status || "open",
          }),
        );
      }

      // Maintenance records
      const maintenance: StationSnapshot["maintenance"] = [];
      const maintArr = await getCloud<any[]>("maintenance_records");
      if (Array.isArray(maintArr)) {
        maintArr.slice(0, 50).forEach((m: any) =>
          maintenance.push({
            title: m.title || m.description || m.equipment || "Maintenance",
            equipment: m.equipment || m.category || "",
            cost: Number(m.cost || m.amount || 0) || 0,
            status: m.status || "open",
            date: m.date || m.createdAt || "",
          }),
        );
      }

      // Communication contacts
      const contacts: StationSnapshot["contacts"] = [];
      const commArr = await getCloud<any[]>("comm_contacts");
      if (Array.isArray(commArr)) {
        commArr.slice(0, 50).forEach((c: any) =>
          contacts.push({
            name: c.name || "",
            phone: c.phone || "",
            email: c.email || "",
            tags: Array.isArray(c.tags)
              ? c.tags.join(", ")
              : typeof c.tags === "string"
                ? c.tags
                : "",
            starred: Boolean(c.starred),
          }),
        );
      }

      // Fuel quality tests
      const quality: StationSnapshot["quality"] = [];
      const qualArr = await getCloud<any[]>("fuel_quality_tests");
      if (Array.isArray(qualArr)) {
        qualArr.slice(0, 50).forEach((q: any) =>
          quality.push({
            fuel: q.fuelType || q.fuel || "",
            testType: q.testType || q.test || q.type || "Quality Test",
            result: q.result || q.reading || "",
            status: q.passed ? "Pass" : q.status || "Pending",
            date: q.date || q.createdAt || "",
          }),
        );
      }

      // Shift employees
      const shifts: StationSnapshot["shifts"] = [];
      const shiftArr = await getCloud<any[]>("shift_employees");
      if (Array.isArray(shiftArr)) {
        shiftArr.slice(0, 50).forEach((e: any) =>
          shifts.push({
            name: e.name || e.fullName || e.employeeName || "",
            role: e.role || e.position || "",
            phone: e.phone || "",
            active: e.active !== false,
          }),
        );
      }

      // Payment transactions summary (mpesa_transactions)
      const payments: StationSnapshot["payments"] = [];
      const payArr = await getCloud<any[]>("mpesa_transactions");
      if (Array.isArray(payArr)) {
        payArr
          .slice(-30)
          .reverse()
          .forEach((p: any) =>
            payments.push({
              ref: p.transaction_ref || p.reference || p.ref || p.receipt || "",
              amount: Number(p.amount || 0) || 0,
              status: p.status || "",
              origin: p.origin || p.source || "",
              date: p.transaction_time || p.date || p.createdAt || "",
            }),
          );
      }

      // Report/analytics KPIs
      const payable = purchases
        .filter((p) => p.type === "purchase-order")
        .reduce((sum, p) => sum + (p.amount || 0), 0);
      const reportKpis: StationSnapshot["reportKpis"] = {
        totalDebt: state.deliveryData?.totals?.balanceDue || 0,
        totalExpenses: expenses.reduce((sum, e) => sum + (e.amount || 0), 0),
        totalCreditOutstanding: creditAccounts.reduce(
          (sum, c) => sum + (c.balance || 0),
          0,
        ),
        totalPayables: payable,
        totalDeliveries: deliveries.length,
        totalOffloading: offloading.length,
        totalTeamMembers: employees.length,
        totalActiveShifts: shifts.filter((s) => s.active !== false).length,
      };

      const snapshot: Omit<StationSnapshot, "updatedAt"> = {
        stationId,
        stationName:
          currentStation?.name || state.companyData?.name || "Station",
        stationLocation:
          currentStation?.location || state.companyData?.physicalAddress,
        currency: state.companyData?.currency || getDetectedCurrency() || "USD",
        country: currentStation?.country,
        fuelPrices,
        pumps,
        tankLevels,
        recentSales,
        salesKpis: {
          totalRevenue,
          totalFuelSold,
          transactionCount: recentSales.length,
        },
        creditAccounts,
        expenses,
        invoices,
        offloading,
        employees,
        companyData: {
          name: state.companyData?.name || currentStation?.name,
          phone: state.companyData?.contacts,
          email: state.companyData?.email,
          kraPin: state.companyData?.kraPin,
          vatNumber: state.companyData?.vatRegNo,
        },
        deliveries,
        customers,
        purchases,
        maintenance,
        contacts,
        quality,
        shifts,
        payments,
        reportKpis,
      };

      const ok = await publishStationSnapshot(stationId, snapshot);
      if (ok) setLastPublished(Date.now());
    } catch (err) {
      console.error("Failed to publish station snapshot:", err);
    } finally {
      setPublishing(false);
    }
  }, [currentStation, state, fuelTypeApi.fuelTypes, stationId]);

  // Auto-publish the snapshot whenever access codes change (so a freshly
  // created code has data to show) + on mount.
  useEffect(() => {
    if (accessCodes.length > 0 && currentStation?.id) {
      publishSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCodes.length, currentStation?.id]);

  // Combined member list: invite-accepted members (full accounts) +
  // access-code members (no-signup). Each entry carries an `accessMethod`
  // badge so the UI can show "Invite" vs "Code" in one blended list.
  const codeMembers = useMemo(
    () =>
      accessCodes.map((c) => ({
        id: c.id,
        username: c.username,
        memberName: c.memberName,
        role: c.memberRole,
        invitedBy: "Access Code",
        invitedByUniqueId: undefined as string | undefined,
        invitedAt: c.createdAt,
        expiresAt: undefined as number | undefined,
        email: undefined as string | undefined,
        uniqueId: undefined as string | undefined,
        assignedPumps: [] as string[],
        active: c.enabled,
        accessMethod: "code" as const,
        readOnly: c.readOnly,
        accessMode: c.accessMode,
        accessCount: c.accessCount,
        lastAccessedAt: c.lastAccessedAt,
      })),
    [accessCodes],
  );
  const inviteMembers = useMemo(
    () =>
      team.map((m) => ({
        ...m,
        accessMethod: "invite" as const,
        readOnly: false,
        accessCount: undefined as number | undefined,
        lastAccessedAt: undefined as number | null | undefined,
      })),
    [team],
  );
  const combinedMembers = useMemo(
    () => [...inviteMembers, ...codeMembers],
    [inviteMembers, codeMembers],
  );

  // ── Onboarding checklist — guides the owner through the 6 areas in a
  //    professional "setup progress" banner. Each item links to its area.
  //    Persisted to localStorage so it survives reloads (per-station).
  const checklistKey = `fuelpro_team_checklist_${currentStation?.id || "default"}`;
  const [checklist, setChecklist] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(
        `fuelpro_team_checklist_${currentStation?.id || "default"}`,
      );
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const checklistItems = useMemo(
    () => [
      {
        id: "add-member",
        label: "Add a team member",
        desc: "Invite via link or create an access code",
        done: combinedMembers.length > 0,
        action: () => {
          setActiveView("team");
          setShowCreate(true);
        },
      },
      {
        id: "share-invite",
        label: "Share an invite link",
        desc: "Copy/WhatsApp/email an active invite",
        done: activeInvites.length > 0,
        action: () => setActiveView("team"),
      },
      {
        id: "publish-snapshot",
        label: "Publish shared snapshot",
        desc: "So access-code members see real data",
        done: lastPublished !== null,
        action: () => publishSnapshot(),
      },
      {
        id: "configure-roles",
        label: "Configure role permissions",
        desc: "Grant/revoke tab access per role",
        done: Object.keys(roleTabGrants).length > 0,
        action: () => setActiveView("roles"),
      },
      {
        id: "assign-pumps",
        label: "Assign pumps/shifts to members",
        desc: "Map members to station pumps + shifts",
        done: combinedMembers.some(
          (m: any) =>
            (m.assignedPumps && m.assignedPumps.length > 0) ||
            (m.assignedShifts && m.assignedShifts.length > 0),
        ),
        action: () => setActiveView("team"),
      },
      {
        id: "review-health",
        label: "Review team health",
        desc: "Check activity metrics + recommendations",
        done: false,
        action: () => setActiveView("activity"),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      combinedMembers,
      activeInvites,
      lastPublished,
      roleTabGrants,
      currentStation?.id,
    ],
  );
  const checklistDone = checklistItems.filter((i) => i.done).length;
  useEffect(() => {
    try {
      localStorage.setItem(checklistKey, JSON.stringify(checklist));
    } catch {
      /* ignore */
    }
  }, [checklist, checklistKey]);

  // ── Member detail drawer content (computed from the selected member). ──
  const drawerMember = useMemo(
    () => combinedMembers.find((m) => m.id === drawerMemberId) || null,
    [combinedMembers, drawerMemberId],
  );

  // ── Filtered members (search + filter) ──
  const filteredMembers = useMemo(() => {
    return combinedMembers.filter((m) => {
      // Search: name, username, email, uniqueId
      if (memberSearch.trim()) {
        const q = memberSearch.toLowerCase().trim();
        const haystack = [
          m.username || "",
          (m as { memberName?: string }).memberName || m.username || "",
          m.email || "",
          m.uniqueId || "",
          m.role || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      // Filter: role
      if (memberFilterRole !== "all" && m.role !== memberFilterRole)
        return false;
      // Filter: access method
      if (memberFilterMethod !== "all" && m.accessMethod !== memberFilterMethod)
        return false;
      // Filter: status
      if (memberFilterStatus === "active" && !m.active) return false;
      if (memberFilterStatus === "inactive" && m.active) return false;
      return true;
    });
  }, [
    combinedMembers,
    memberSearch,
    memberFilterRole,
    memberFilterMethod,
    memberFilterStatus,
  ]);

  // ── Bulk select helpers ──
  const toggleSelectMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedMembers.size === filteredMembers.length) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(filteredMembers.map((m) => m.id)));
    }
  };

  // ── Bulk actions ──
  const handleBulkEnableCodes = async () => {
    const ids = filteredMembers.filter(
      (m) => selectedMembers.has(m.id) && m.accessMethod === "code",
    );
    for (const m of ids) {
      if (!m.active) await toggleAccessCode(m.id, currentStation?.id);
    }
    await loadAccessCodes();
    showToast(`Enabled ${ids.length} access code(s)`);
    setSelectedMembers(new Set());
  };
  const handleBulkDisableCodes = async () => {
    const ids = filteredMembers.filter(
      (m) => selectedMembers.has(m.id) && m.accessMethod === "code",
    );
    for (const m of ids) {
      if (m.active) await toggleAccessCode(m.id, currentStation?.id);
    }
    await loadAccessCodes();
    showToast(`Disabled ${ids.length} access code(s)`);
    setSelectedMembers(new Set());
  };
  const handleBulkDeleteCodes = async () => {
    if (!confirm(`Delete ${selectedMembers.size} selected access code(s)?`))
      return;
    const ids = filteredMembers.filter(
      (m) => selectedMembers.has(m.id) && m.accessMethod === "code",
    );
    for (const m of ids) {
      await deleteAccessCode(m.id, currentStation?.id);
    }
    await loadAccessCodes();
    showToast(`Deleted ${ids.length} access code(s)`);
    setSelectedMembers(new Set());
  };
  const handleBulkRevokeMembers = async () => {
    if (!confirm(`Revoke ${selectedMembers.size} selected member(s)?`)) return;
    const ids = filteredMembers.filter(
      (m) => selectedMembers.has(m.id) && m.accessMethod === "invite",
    );
    for (const m of ids) {
      if (m.role !== "owner") revokeMember(m.id);
    }
    showToast(`Revoked ${ids.length} member(s)`);
    setSelectedMembers(new Set());
  };

  // ── CSV export of team members ──
  const exportMembersCSV = () => {
    const rows: string[][] = [
      [
        "Name",
        "Username",
        "Role",
        "Access Method",
        "Status",
        "Email",
        "Unique ID",
        "Invited By",
        "Invited At",
        "Expires At",
        "Read-Only",
        "Access Count",
        "Last Accessed",
      ],
    ];
    for (const m of filteredMembers) {
      rows.push([
        (m as { memberName?: string }).memberName || m.username || "",
        m.username || "",
        m.role || "",
        m.accessMethod || "",
        m.active ? "Active" : "Inactive",
        m.email || "",
        m.uniqueId || "",
        m.invitedBy || "",
        m.invitedAt ? new Date(m.invitedAt).toISOString() : "",
        m.expiresAt ? new Date(m.expiresAt).toISOString() : "",
        m.readOnly ? "Yes" : "No",
        String(m.accessCount ?? ""),
        m.lastAccessedAt ? new Date(m.lastAccessedAt).toISOString() : "",
      ]);
    }
    const csv = rows
      .map((r) => r.map((c) => `"${(c || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported team members to CSV");
  };

  // ── Team health metrics ──
  const teamHealth = useMemo(() => {
    const total = combinedMembers.length;
    const active = combinedMembers.filter((m) => m.active).length;
    const inviteCount = combinedMembers.filter(
      (m) => m.accessMethod === "invite",
    ).length;
    const codeCount = combinedMembers.filter(
      (m) => m.accessMethod === "code",
    ).length;
    const managers = combinedMembers.filter((m) => m.role === "manager").length;
    const staff = combinedMembers.filter((m) => m.role === "staff").length;
    const auditors = combinedMembers.filter((m) => m.role === "auditor").length;
    const custom = combinedMembers.filter(
      (m) => !["owner", "manager", "staff", "auditor"].includes(m.role),
    ).length;
    const readOnlyCount = combinedMembers.filter((m) => m.readOnly).length;
    const expired = combinedMembers.filter(
      (m) => m.expiresAt && new Date(m.expiresAt) < new Date(),
    ).length;
    const activeInvitesCount = activeInvites.length;
    const totalCodes = accessCodes.length;
    const enabledCodes = accessCodes.filter((c) => c.enabled).length;
    const healthScore =
      total === 0
        ? 0
        : Math.round(
            ((active / total) * 0.4 +
              (enabledCodes / Math.max(totalCodes, 1)) * 0.3 +
              (1 - expired / Math.max(total, 1)) * 0.3) *
              100,
          );

    return {
      total,
      active,
      inactive: total - active,
      inviteCount,
      codeCount,
      managers,
      staff,
      auditors,
      custom,
      readOnlyCount,
      expired,
      activeInvitesCount,
      totalCodes,
      enabledCodes,
      disabledCodes: totalCodes - enabledCodes,
      healthScore,
    };
  }, [combinedMembers, activeInvites.length, accessCodes]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* ── Professional header ── */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-5 text-gray-900 dark:text-white shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/20 rounded-xl">
              <Users size={24} className="text-gray-900 dark:text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Team Manager</h2>
              <p className="text-sm text-gray-900 dark:text-white/80">
                Manage access, roles, shifts &amp; permissions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="bg-white/20 rounded-lg px-3 py-1.5 text-center">
              <p className="text-lg font-bold leading-none">
                {combinedMembers.filter((m) => m.active).length}
              </p>
              <p className="text-gray-900 dark:text-white/70 text-[10px]">
                Members
              </p>
            </div>
            <div className="bg-white/20 rounded-lg px-3 py-1.5 text-center">
              <p className="text-lg font-bold leading-none">
                {activeInvites.length}
              </p>
              <p className="text-gray-900 dark:text-white/70 text-[10px]">
                Invites
              </p>
            </div>
            <div className="bg-white/20 rounded-lg px-3 py-1.5 text-center">
              <p className="text-lg font-bold leading-none">
                {accessCodes.filter((c) => c.enabled).length}
              </p>
              <p className="text-gray-900 dark:text-white/70 text-[10px]">
                Codes
              </p>
            </div>
          </div>
        </div>
        {/* ── Live sync status + quick-action toolbar ── */}
        <div className="mt-3 flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-white/20">
          <div className="flex items-center gap-2 text-xs text-gray-900 dark:text-white/80">
            {syncOnline ? (
              <span className="flex items-center gap-1 bg-green-400/20 px-2 py-1 rounded-full">
                <Wifi size={12} /> Cloud synced
              </span>
            ) : (
              <span className="flex items-center gap-1 bg-amber-400/20 px-2 py-1 rounded-full">
                <WifiOff size={12} /> Offline — changes save locally
              </span>
            )}
            {lastPublished && (
              <span className="flex items-center gap-1 bg-gray-100 dark:bg-white/10 px-2 py-1 rounded-full">
                <Radio size={12} /> Snapshot{" "}
                {new Date(lastPublished).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => publishSnapshot()}
              disabled={publishing || !currentStation?.id}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 disabled:opacity-40 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="Publish a read-only snapshot for access-code members"
            >
              <Share2 size={13} className={publishing ? "animate-spin" : ""} />
              {publishing ? "Publishing…" : "Publish Snapshot"}
            </button>
            <button
              onClick={() => setActiveView("activity")}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Activity size={13} /> Health
            </button>
            <button
              onClick={() => exportMembersCSV()}
              disabled={combinedMembers.length === 0}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 disabled:opacity-40 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <Download size={13} /> Export
            </button>
            <button
              onClick={() =>
                window.dispatchEvent(new CustomEvent("open-station-manager"))
              }
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="Open Station Manager — manage stations & access"
            >
              <Building2 size={13} /> Stations
            </button>
          </div>
        </div>
      </div>

      {/* ── Onboarding checklist (only for owner, only when incomplete) ── */}
      {isOwner && checklistDone < checklistItems.length && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-xl border border-amber-200 dark:border-amber-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-amber-600" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                Team Setup Checklist
              </h3>
              <span className="text-xs text-gray-500">
                {checklistDone}/{checklistItems.length} done
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-32 h-2 bg-amber-100 dark:bg-amber-900/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{
                    width: `${(checklistDone / checklistItems.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {checklistItems.map((item) => (
              <button
                key={item.id}
                onClick={item.action}
                className={`flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors ${item.done ? "bg-green-50 dark:bg-green-900/20" : "bg-white dark:bg-gray-800 hover:bg-amber-50 dark:hover:bg-amber-900/10"} border border-gray-200 dark:border-gray-700`}
              >
                {item.done ? (
                  <CheckCircle2
                    size={16}
                    className="text-green-500 flex-shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-amber-300 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs font-semibold ${item.done ? "text-green-700 dark:text-green-300 line-through" : "text-gray-900 dark:text-gray-900 dark:text-white"}`}
                  >
                    {item.label}
                  </p>
                  <p className="text-[10px] text-gray-500">{item.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Sub-tab switcher ── */}
      <SubTabBar
        tabs={[
          { id: "team", label: "Team Access", icon: Users },
          { id: "roles", label: "Roles & Permissions", icon: KeyRound },
          { id: "shifts", label: "Shifts", icon: Calendar },
          { id: "performance", label: "Performance", icon: Activity },
          { id: "activity", label: "Activity & Health", icon: Activity },
        ]}
        active={activeView}
        onChange={(id) =>
          setActiveView(
            id as "team" | "shifts" | "roles" | "activity" | "performance",
          )
        }
      />

      {activeView === "shifts" ? (
        <ShiftManagement />
      ) : activeView === "roles" ? (
        <RolesAndPermissionsView
          isOwner={isOwner}
          canManagePermissions={canManagePermissions}
          canCreateRoles={canCreateRoles}
          customRoles={customRoles}
          resolvePermissions={resolvePermissions}
          resolveTabGrants={resolveTabGrants}
          roleTabGrants={roleTabGrants}
          setRolePermission={setRolePermission}
          grantTabToRole={grantTabToRole}
          revokeTabFromRole={revokeTabFromRole}
          setRoleTabGrants={setRoleTabGrants}
          createCustomRole={createCustomRole}
          deleteCustomRole={deleteCustomRole}
          updateCustomRole={updateCustomRole}
          outranks={outranks}
          hasPermission={hasPermission}
          tabIdToLabel={tabIdToLabel}
          permEditorRole={permEditorRole}
          setPermEditorRole={setPermEditorRole}
          showRoleCreator={showRoleCreator}
          setShowRoleCreator={setShowRoleCreator}
          newRoleName={newRoleName}
          setNewRoleName={setNewRoleName}
          newRoleLabel={newRoleLabel}
          setNewRoleLabel={setNewRoleLabel}
          newRoleBase={newRoleBase}
          setNewRoleBase={setNewRoleBase}
        />
      ) : activeView === "performance" ? (
        <AttendantPerformance />
      ) : activeView === "activity" ? (
        <>
          <MemberSuggestionsPanel />
          <ActivityHealthView
            teamHealth={teamHealth}
            combinedMembers={combinedMembers}
            accessCodes={accessCodes}
            activeInvites={activeInvites}
            usedInvites={usedInvites}
            expiredInvites={expiredInvites}
            getRoleLabel={getRoleLabel}
            exportMembersCSV={exportMembersCSV}
            showToast={showToast}
          />
        </>
      ) : (
        <>
          {/* ── Current User + Hierarchy banner ── */}
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${getRoleLabel(role).color}`}
                >
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Your access level
                </p>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Hierarchy: Owner &gt; Manager &gt; Staff &gt; Auditor
              </p>
            </div>

            {!isOwner && currentBinding && (
              <div className="mt-3 pt-3 border-t border-purple-200 dark:border-purple-700">
                {showTerminateConfirm ? (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-red-600 dark:text-red-400 flex-1">
                      Are you sure? You will lose access to this station.
                    </p>
                    <button
                      onClick={() => setShowTerminateConfirm(false)}
                      className="px-2 py-1 text-[11px] text-gray-500 hover:text-gray-700 rounded"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        terminateRole(currentBinding.stationId);
                        setShowTerminateConfirm(false);
                        import("@/react-app/lib/app-reloader").then(
                          ({ triggerSoftReload }) => triggerSoftReload(500),
                        );
                      }}
                      className="px-3 py-1 text-[11px] bg-red-600 hover:bg-red-700 text-gray-900 dark:text-white rounded font-medium"
                    >
                      Confirm
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowTerminateConfirm(true)}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 flex items-center gap-1"
                  >
                    <Ban size={12} /> Terminate My Role
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Professional 2-column layout: actions (left) + roster (right) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* LEFT column (2/5) — Add Member, Invites, Access Codes */}
            <div className="lg:col-span-2 space-y-4">
              {/* ── Add Team Member ── */}
              {availableRoles.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <UserPlus
                      size={16}
                      className="text-indigo-600 dark:text-indigo-400"
                    />
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                      Add Team Member
                    </h3>
                  </div>
                  {!showCreate ? (
                    <div className="space-y-2">
                      <button
                        onClick={() => {
                          setAddMode("invite");
                          setShowCreate(true);
                        }}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg"
                      >
                        <Plus size={18} /> Invite by Link
                      </button>
                      <button
                        onClick={() => {
                          setAddMode("code");
                          setShowCreate(true);
                        }}
                        className="w-full py-2.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors border border-blue-200 dark:border-blue-800"
                      >
                        <KeyRound size={14} /> Quick Access Code (no signup)
                      </button>
                    </div>
                  ) : (
                    <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4 space-y-3">
                      {/* Mode switcher */}
                      <div className="flex gap-2 p-1 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                        <button
                          onClick={() => setAddMode("invite")}
                          className={`flex-1 px-3 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${addMode === "invite" ? "bg-indigo-600 text-gray-900 dark:text-white shadow" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white dark:bg-gray-800"}`}
                        >
                          <Link2 size={14} /> Invite Link
                          <span className="text-[9px] opacity-80">
                            (full account)
                          </span>
                        </button>
                        <button
                          onClick={() => setAddMode("code")}
                          className={`flex-1 px-3 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${addMode === "code" ? "bg-blue-600 text-gray-900 dark:text-white shadow" : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white dark:bg-gray-800"}`}
                        >
                          <KeyRound size={14} /> Access Code
                          <span className="text-[9px] opacity-80">
                            (no signup)
                          </span>
                        </button>
                      </div>

                      {addMode === "code" ? (
                        <AccessCodeForm
                          stationId={currentStation?.id}
                          availableRoles={availableRoles}
                          getRoleLabel={getRoleLabel}
                          tabIdToLabel={tabIdToLabel}
                          stationName={currentStation?.name}
                          stationOwnerId={user?.authId}
                          onCreated={() => {
                            loadAccessCodes();
                            setShowCreate(false);
                          }}
                          onCancel={() => setShowCreate(false)}
                        />
                      ) : (
                        <>
                          <div>
                            <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400 block mb-2">
                              Role
                            </label>
                            <div className="flex flex-wrap gap-2">
                              {availableRoles.map((r) => (
                                <button
                                  key={r.id}
                                  onClick={() => setInviteRole(r.id)}
                                  className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${inviteRole === r.id ? getRoleLabel(r.id).color + " ring-2 ring-offset-1 ring-indigo-400" : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"}`}
                                >
                                  {r.label}
                                </button>
                              ))}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {getRoleLabel(inviteRole).desc}
                            </p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400 block mb-1">
                                Expires in (days) - optional
                              </label>
                              <input
                                type="number"
                                value={expireDays}
                                onChange={(e) => setExpireDays(e.target.value)}
                                placeholder="Never"
                                className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-600 dark:text-gray-500 dark:text-gray-400 block mb-1">
                                Max uses
                              </label>
                              <input
                                type="number"
                                value={maxUses}
                                onChange={(e) => setMaxUses(e.target.value)}
                                min="1"
                                className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                              />
                            </div>
                          </div>
                          {(isOwner || hasPermission("canCreateSubUsers")) && (
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                                <ShieldAlert size={12} /> Delegation (optional)
                              </p>
                              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={inviteCanCreateSubUsers}
                                  onChange={(e) =>
                                    setInviteCanCreateSubUsers(e.target.checked)
                                  }
                                  disabled={
                                    !isOwner &&
                                    !hasPermission("canCreateSubUsers")
                                  }
                                />
                                Allow this sub-user to create further sub-users
                              </label>
                              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={inviteCanGrantPermissions}
                                  onChange={(e) =>
                                    setInviteCanGrantPermissions(
                                      e.target.checked,
                                    )
                                  }
                                  disabled={
                                    !isOwner &&
                                    !hasPermission("canGrantPermissions")
                                  }
                                />
                                Allow this sub-user to grant permissions to
                                others
                              </label>
                              {!isOwner && (
                                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                  You can only delegate powers you yourself
                                  hold.
                                </p>
                              )}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={handleCreateInvite}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
                            >
                              <Link2 size={14} /> Generate Link
                            </button>
                            <button
                              onClick={() => setShowCreate(false)}
                              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── Active Invites ── */}
              {activeInvites.length > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Link2 size={16} className="text-amber-600" />
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                      Active Invites
                      <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400 font-normal">
                        ({activeInvites.length})
                      </span>
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {activeInvites.map((inv) => (
                      <div
                        key={inv.id}
                        className="bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div
                              className={`px-2 py-1 rounded text-[10px] font-medium ${getRoleLabel(inv.role).color}`}
                            >
                              {getRoleLabel(inv.role).label}
                            </div>
                            <code className="text-[10px] text-gray-500 font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                              {inv.id}
                            </code>
                          </div>
                          <div className="flex items-center gap-2">
                            {inv.expiresAt && (
                              <span className="text-[10px] text-gray-500 flex items-center gap-1">
                                <Clock size={10} />{" "}
                                {new Date(inv.expiresAt).toLocaleDateString()}
                              </span>
                            )}
                            <span className="text-[10px] text-gray-500">
                              {inv.uses}/{inv.maxUses}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            readOnly
                            value={getLink(inv)}
                            className="flex-1 px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-[10px] font-mono dark:text-gray-300 truncate"
                          />
                          <button
                            onClick={() => handleCopyLink(inv)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors flex-shrink-0 ${copiedId === inv.id ? "bg-green-100 text-green-700" : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"}`}
                          >
                            {copiedId === inv.id ? (
                              <>
                                <CheckCircle2 size={12} /> Copied
                              </>
                            ) : (
                              <>
                                <Copy size={12} /> Copy
                              </>
                            )}
                          </button>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            onClick={() => handleShareWhatsApp(inv)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-[10px] font-medium rounded-lg"
                          >
                            <MessageCircle size={12} /> WhatsApp
                          </button>
                          <button
                            onClick={() => handleShareEmail(inv)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-[10px] font-medium rounded-lg"
                          >
                            <Mail size={12} /> Email
                          </button>
                          <button
                            onClick={() => {
                              const link = getLink(inv);
                              if (navigator.share) {
                                navigator
                                  .share({
                                    title: "FuelPro Invite",
                                    text: `Join ${currentStation?.name || "Fuel Station"} as ${inv.role}`,
                                    url: link,
                                  })
                                  .catch(() => handleCopyLink(inv));
                              } else {
                                handleCopyLink(inv);
                              }
                            }}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-[10px] font-medium rounded-lg"
                          >
                            <Link2 size={12} /> Share
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Shared snapshot publisher ── */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Share2 size={16} className="text-indigo-600" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                    Shared Snapshot
                  </h3>
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  Publishes a read-only snapshot so access-code members can view
                  station data without a Supabase session.
                  {lastPublished && (
                    <span className="block mt-1 text-gray-500 dark:text-gray-400">
                      Last published:{" "}
                      {new Date(lastPublished).toLocaleTimeString()}
                    </span>
                  )}
                </p>
                <button
                  onClick={() => publishSnapshot()}
                  disabled={publishing || !currentStation?.id}
                  className="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
                >
                  <RefreshCw
                    size={14}
                    className={publishing ? "animate-spin" : ""}
                  />
                  {publishing ? "Publishing…" : "Refresh shared snapshot"}
                </button>
              </div>
            </div>

            {/* RIGHT column (3/5) — Team Members + Feature Access + History */}
            <div className="lg:col-span-3 space-y-4">
              {/* ── Stats grid ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: "Active Members",
                    value: combinedMembers.filter((m) => m.active).length,
                    icon: UserCheck,
                    color: "text-purple-600",
                    bg: "bg-purple-50 dark:bg-purple-900/20",
                  },
                  {
                    label: "Managers",
                    value: combinedMembers.filter((m) => m.role === "manager")
                      .length,
                    icon: Crown,
                    color: "text-blue-600",
                    bg: "bg-blue-50 dark:bg-blue-900/20",
                  },
                  {
                    label: "Staff",
                    value: combinedMembers.filter((m) => m.role === "staff")
                      .length,
                    icon: User,
                    color: "text-green-600",
                    bg: "bg-green-50 dark:bg-green-900/20",
                  },
                  {
                    label: "Access Codes",
                    value: accessCodes.filter((c) => c.enabled).length,
                    icon: KeyRound,
                    color: "text-indigo-600",
                    bg: "bg-indigo-50 dark:bg-indigo-900/20",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className={`rounded-xl p-3 border border-gray-200 dark:border-gray-700 ${s.bg}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <s.icon size={14} className={s.color} />
                    </div>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-gray-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* ── Feature Access Control (collapsible) ── */}
              {canManagePermissions && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <button
                    onClick={() => setShowFeatureGrant(!showFeatureGrant)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                        <Settings2
                          size={16}
                          className="text-indigo-600 dark:text-indigo-400"
                        />
                      </div>
                      <div className="text-left">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                          Feature Access Control
                        </h3>
                        <p className="text-xs text-gray-500">
                          Grant or revoke tab access per role
                        </p>
                      </div>
                    </div>
                    {showFeatureGrant ? (
                      <ChevronUp
                        size={16}
                        className="text-gray-500 dark:text-gray-400"
                      />
                    ) : (
                      <ChevronDown
                        size={16}
                        className="text-gray-500 dark:text-gray-400"
                      />
                    )}
                  </button>

                  {showFeatureGrant && (
                    <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <ToggleRight size={14} className="text-green-500" />{" "}
                          Allowed
                        </span>
                        <span className="flex items-center gap-1">
                          <ToggleLeft
                            size={14}
                            className="text-gray-500 dark:text-gray-400"
                          />{" "}
                          Denied
                        </span>
                        <span className="ml-auto text-gray-500 dark:text-gray-400">
                          Click to toggle
                        </span>
                      </div>
                      {(
                        [
                          ...BASE_ROLES,
                          ...customRoles
                            .filter((c) => outranks(c.name))
                            .map((c) => c.name),
                        ] as string[]
                      ).map((targetRole) => (
                        <div key={targetRole}>
                          <h4
                            className={`text-xs font-semibold mb-2 px-2 py-1 rounded inline-block ${getRoleLabel(targetRole).color}`}
                          >
                            {getRoleLabel(targetRole).label} Access
                          </h4>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {Object.keys(tabIdToLabel).map((tabId) => {
                              const isAllowed =
                                resolveTabGrants(targetRole).includes(tabId);
                              return (
                                <button
                                  key={tabId}
                                  onClick={() => {
                                    if (isAllowed)
                                      revokeTabFromRole(
                                        targetRole as UserRole,
                                        tabId,
                                      );
                                    else
                                      grantTabToRole(
                                        targetRole as UserRole,
                                        tabId,
                                      );
                                  }}
                                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                                    isAllowed
                                      ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800"
                                      : "bg-gray-50 dark:bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700"
                                  }`}
                                >
                                  {isAllowed ? (
                                    <ToggleRight size={16} />
                                  ) : (
                                    <ToggleLeft size={16} />
                                  )}
                                  <span>{tabIdToLabel[tabId]}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          if (
                            confirm("Reset all role tab grants to default?")
                          ) {
                            setRoleTabGrants({
                              manager: [...DEFAULT_ROLE_TABS.manager],
                              staff: [...DEFAULT_ROLE_TABS.staff],
                              auditor: [...DEFAULT_ROLE_TABS.auditor],
                            });
                          }
                        }}
                        className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg transition-colors"
                      >
                        Reset to Default Access
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Team Members roster (with search + filter + bulk actions) ── */}
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Users size={16} className="text-purple-600" />
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                      Team Members
                      <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-400 font-normal">
                        ({filteredMembers.length}
                        {filteredMembers.length !== combinedMembers.length
                          ? ` of ${combinedMembers.length}`
                          : ""}
                        )
                      </span>
                    </h3>
                  </div>
                  {combinedMembers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowBulkActions(!showBulkActions)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${showBulkActions ? "bg-indigo-600 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                        title="Toggle bulk select"
                      >
                        {showBulkActions ? (
                          <CheckSquare size={14} />
                        ) : (
                          <Square size={14} />
                        )}
                        Bulk
                      </button>
                      <button
                        onClick={exportMembersCSV}
                        className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
                        title="Export to CSV"
                      >
                        <Download size={14} /> CSV
                      </button>
                    </div>
                  )}
                </div>

                {/* Search + filter bar */}
                {combinedMembers.length > 0 && (
                  <div className="mb-3 space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search
                          size={14}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
                        />
                        <input
                          type="text"
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          placeholder="Search by name, username, email, ID..."
                          className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs dark:text-gray-900 dark:text-white"
                        />
                        {memberSearch && (
                          <button
                            onClick={() => setMemberSearch("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-600"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={memberFilterRole}
                        onChange={(e) => setMemberFilterRole(e.target.value)}
                        className="px-2 py-1.5 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-[11px] dark:text-gray-900 dark:text-white"
                      >
                        <option value="all">All Roles</option>
                        <option value="owner">Owner</option>
                        <option value="manager">Manager</option>
                        <option value="staff">Staff</option>
                        <option value="auditor">Auditor</option>
                        {customRoles.map((cr) => (
                          <option key={cr.name} value={cr.name}>
                            {cr.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={memberFilterMethod}
                        onChange={(e) => setMemberFilterMethod(e.target.value)}
                        className="px-2 py-1.5 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-[11px] dark:text-gray-900 dark:text-white"
                      >
                        <option value="all">All Methods</option>
                        <option value="invite">Invite Link</option>
                        <option value="code">Access Code</option>
                      </select>
                      <select
                        value={memberFilterStatus}
                        onChange={(e) => setMemberFilterStatus(e.target.value)}
                        className="px-2 py-1.5 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-[11px] dark:text-gray-900 dark:text-white"
                      >
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                      {(memberSearch ||
                        memberFilterRole !== "all" ||
                        memberFilterMethod !== "all" ||
                        memberFilterStatus !== "all") && (
                        <button
                          onClick={() => {
                            setMemberSearch("");
                            setMemberFilterRole("all");
                            setMemberFilterMethod("all");
                            setMemberFilterStatus("all");
                          }}
                          className="px-2 py-1.5 text-[11px] text-gray-500 hover:text-gray-700 flex items-center gap-1"
                        >
                          <X size={12} /> Clear
                        </button>
                      )}
                    </div>

                    {/* Bulk actions bar */}
                    {showBulkActions && filteredMembers.length > 0 && (
                      <div className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800 flex-wrap">
                        <button
                          onClick={toggleSelectAll}
                          className="text-xs text-indigo-700 dark:text-indigo-300 font-medium flex items-center gap-1"
                        >
                          {selectedMembers.size === filteredMembers.length
                            ? "Deselect All"
                            : "Select All"}
                        </button>
                        {selectedMembers.size > 0 && (
                          <>
                            <span className="text-xs text-gray-500">
                              {selectedMembers.size} selected
                            </span>
                            <button
                              onClick={handleBulkEnableCodes}
                              className="px-2.5 py-1 bg-green-100 text-green-700 text-[11px] font-medium rounded-lg flex items-center gap-1 hover:bg-green-200"
                            >
                              <Unlock size={12} /> Enable Codes
                            </button>
                            <button
                              onClick={handleBulkDisableCodes}
                              className="px-2.5 py-1 bg-amber-100 text-amber-700 text-[11px] font-medium rounded-lg flex items-center gap-1 hover:bg-amber-200"
                            >
                              <Lock size={12} /> Disable Codes
                            </button>
                            <button
                              onClick={handleBulkRevokeMembers}
                              className="px-2.5 py-1 bg-red-100 text-red-700 text-[11px] font-medium rounded-lg flex items-center gap-1 hover:bg-red-200"
                            >
                              <Ban size={12} /> Revoke Members
                            </button>
                            <button
                              onClick={handleBulkDeleteCodes}
                              className="px-2.5 py-1 bg-red-100 text-red-700 text-[11px] font-medium rounded-lg flex items-center gap-1 hover:bg-red-200"
                            >
                              <Trash2 size={12} /> Delete Codes
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {combinedMembers.length === 0 && (
                  <div className="text-center py-8">
                    <UserPlus
                      size={32}
                      className="mx-auto text-gray-300 dark:text-gray-600 mb-2"
                    />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No team members yet.
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Add a member via an invite link or access code.
                    </p>
                  </div>
                )}
                {combinedMembers.length > 0 && filteredMembers.length === 0 && (
                  <div className="text-center py-8">
                    <Search
                      size={28}
                      className="mx-auto text-gray-300 dark:text-gray-600 mb-2"
                    />
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No members match your search.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {filteredMembers.map((member) => {
                    const isExpanded = expandedMember === member.id;
                    const RoleIcon = getRoleIcon(member.role);
                    const roleInfo = getRoleLabel(member.role);
                    const isExpired =
                      member.expiresAt &&
                      new Date(member.expiresAt) < new Date();
                    const isCode = member.accessMethod === "code";
                    return (
                      <div
                        key={member.id}
                        className={`bg-white dark:bg-gray-800 rounded-xl border overflow-hidden ${isExpired ? "border-red-200 dark:border-red-800 opacity-60" : "border-gray-200 dark:border-gray-700"}`}
                      >
                        <div
                          className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                          onClick={() =>
                            setExpandedMember(isExpanded ? null : member.id)
                          }
                        >
                          {showBulkActions && (
                            <input
                              type="checkbox"
                              checked={selectedMembers.has(member.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelectMember(member.id);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0"
                            />
                          )}
                          <div
                            className={`p-2 rounded-lg ${roleInfo.color.split(" ")[0]}`}
                          >
                            <RoleIcon size={18} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                                {isCode ? member.memberName : member.username}
                              </p>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${roleInfo.color}`}
                              >
                                {roleInfo.label}
                              </span>
                              {/* Access-method badge — Invite vs Code. */}
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isCode ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"}`}
                              >
                                {isCode ? "Code" : "Invite"}
                              </span>
                              {isCode && member.readOnly && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-500">
                                  Read-Only
                                </span>
                              )}
                              {isExpired && (
                                <span className="text-[10px] px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                                  Expired
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500">
                              Invited by {member.invitedBy}
                              {member.invitedByUniqueId && (
                                <span className="text-gray-500 dark:text-gray-400">
                                  {" "}
                                  (ID: {member.invitedByUniqueId})
                                </span>
                              )}{" "}
                              on{" "}
                              {new Date(member.invitedAt).toLocaleDateString()}
                            </p>
                            {(member.email || member.uniqueId) && (
                              <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                                {member.email && (
                                  <span className="flex items-center gap-1">
                                    <Mail size={9} /> {member.email}
                                  </span>
                                )}
                                {member.uniqueId && (
                                  <span className="ml-2">
                                    ID: {member.uniqueId}
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {member.expiresAt && (
                              <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                <Clock size={10} />{" "}
                                {new Date(
                                  member.expiresAt,
                                ).toLocaleDateString()}
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDrawerMemberId(member.id);
                              }}
                              className="px-2 py-1 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded-lg text-[10px] font-medium flex items-center gap-1 transition-colors"
                              title="Open member detail panel"
                            >
                              <Eye size={11} /> Details
                            </button>
                            {isExpanded ? (
                              <ChevronUp
                                size={16}
                                className="text-gray-500 dark:text-gray-400"
                              />
                            ) : (
                              <ChevronDown
                                size={16}
                                className="text-gray-500 dark:text-gray-400"
                              />
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-3">
                            {isCode ? (
                              /* Access-code member actions: enable/disable, delete,
                           and a read-out of access usage. These interlink with
                           the AccessCodesView list below (same cloud store). */
                              <>
                                <div className="text-xs text-gray-500 space-y-1">
                                  <p>
                                    <KeyRound
                                      size={10}
                                      className="inline mr-1"
                                    />
                                    Username:{" "}
                                    <code className="font-mono bg-gray-100 dark:bg-white dark:bg-gray-900 px-1 rounded">
                                      {member.username}
                                    </code>
                                  </p>
                                  <p>
                                    Accessed {member.accessCount ?? 0} time
                                    {(member.accessCount ?? 0) !== 1 ? "s" : ""}
                                    {member.lastAccessedAt
                                      ? ` · Last: ${new Date(member.lastAccessedAt).toLocaleString()}`
                                      : ""}
                                  </p>
                                  <p className="text-gray-500 dark:text-gray-400">
                                    Access method: Access Code (no signup
                                    needed). Manage in the Access Codes panel
                                    below.
                                  </p>
                                </div>
                                <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                  <button
                                    onClick={async () => {
                                      await toggleAccessCode(
                                        member.id,
                                        currentStation?.id,
                                      );
                                      loadAccessCodes();
                                    }}
                                    className="px-3 py-1.5 bg-blue-50 text-blue-700 text-[11px] font-medium rounded-lg flex items-center gap-1"
                                  >
                                    <KeyRound size={10} />
                                    {member.active ? "Disable" : "Enable"}
                                  </button>
                                  <button
                                    onClick={async () => {
                                      if (
                                        confirm(
                                          `Delete the access code for ${member.memberName}? They will no longer be able to log in.`,
                                        )
                                      ) {
                                        await deleteAccessCode(
                                          member.id,
                                          currentStation?.id,
                                        );
                                        loadAccessCodes();
                                      }
                                    }}
                                    className="px-3 py-1.5 bg-red-50 text-red-700 text-[11px] font-medium rounded-lg flex items-center gap-1"
                                  >
                                    <Trash2 size={10} /> Delete Code
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                {canAssign && (
                                  <>
                                    <div>
                                      <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                                        <Fuel size={10} /> Assigned Pumps
                                      </label>
                                      <div className="flex flex-wrap gap-1">
                                        {pumpOptions.length === 0 && (
                                          <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                            No pumps configured for this
                                            station.
                                          </span>
                                        )}
                                        {pumpOptions.map((p) => {
                                          const selected =
                                            member.assignedPumps.includes(p.id);
                                          return (
                                            <button
                                              key={p.id}
                                              onClick={() => {
                                                const next = selected
                                                  ? member.assignedPumps.filter(
                                                      (x: string) => x !== p.id,
                                                    )
                                                  : [
                                                      ...member.assignedPumps,
                                                      p.id,
                                                    ];
                                                assignPumps(member.id, next);
                                              }}
                                              className={`text-[10px] px-2 py-1 rounded-full border transition-all ${selected ? "bg-green-100 text-green-700 border-green-300" : "bg-gray-50 text-gray-500 border-gray-200"}`}
                                            >
                                              {p.label}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                    <div>
                                      <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                                        <Calendar size={10} /> Assigned Shifts
                                      </label>
                                      <div className="flex flex-wrap gap-1">
                                        {shiftOptions.map((s) => (
                                          <button
                                            key={s}
                                            onClick={() => {
                                              const next =
                                                member.assignedShifts.includes(
                                                  s,
                                                )
                                                  ? member.assignedShifts.filter(
                                                      (x: string) => x !== s,
                                                    )
                                                  : [
                                                      ...member.assignedShifts,
                                                      s,
                                                    ];
                                              assignShifts(member.id, next);
                                            }}
                                            className={`text-[10px] px-2 py-1 rounded-full border transition-all ${member.assignedShifts.includes(s) ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-gray-50 text-gray-500 border-gray-200"}`}
                                          >
                                            {s}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                  {canSetLimits && (
                                    <div className="flex items-center gap-2 flex-1">
                                      <input
                                        type="number"
                                        value={
                                          extendDaysByMember[member.id] ?? "30"
                                        }
                                        onChange={(e) =>
                                          setExtendDaysByMember((prev) => ({
                                            ...prev,
                                            [member.id]: e.target.value,
                                          }))
                                        }
                                        className="w-16 px-2 py-1 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded text-xs dark:text-gray-900 dark:text-white"
                                        placeholder="Days"
                                      />
                                      <button
                                        onClick={() =>
                                          extendAccess(
                                            member.id,
                                            parseInt(
                                              extendDaysByMember[member.id] ??
                                                "30",
                                            ) || 30,
                                          )
                                        }
                                        className="px-3 py-1.5 bg-blue-50 text-blue-700 text-[11px] font-medium rounded-lg flex items-center gap-1"
                                      >
                                        <RefreshCw size={10} /> Extend
                                      </button>
                                    </div>
                                  )}
                                  {canRevoke && member.role !== "owner" && (
                                    <button
                                      onClick={() => {
                                        if (
                                          confirm(
                                            `Remove ${member.username}'s access?`,
                                          )
                                        )
                                          revokeMember(member.id);
                                      }}
                                      className="px-3 py-1.5 bg-red-50 text-red-700 text-[11px] font-medium rounded-lg flex items-center gap-1"
                                    >
                                      <Ban size={10} /> Revoke
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Invite History (used/expired) ── */}
              {(usedInvites.length > 0 || expiredInvites.length > 0) && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock
                      size={16}
                      className="text-gray-500 dark:text-gray-400"
                    />
                    <h3 className="text-sm font-bold text-gray-500 dark:text-gray-500 dark:text-gray-400">
                      Invite History
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {usedInvites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg text-xs text-gray-500"
                      >
                        <CheckCircle2 size={14} className="text-green-400" />
                        <span
                          className={`px-2 py-0.5 rounded ${getRoleLabel(inv.role).color}`}
                        >
                          {getRoleLabel(inv.role).label}
                        </span>
                        <span>
                          used by <strong>{inv.usedBy}</strong> on{" "}
                          {inv.usedAt
                            ? new Date(inv.usedAt).toLocaleDateString()
                            : "unknown"}
                        </span>
                      </div>
                    ))}
                    {expiredInvites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg text-xs text-gray-500"
                      >
                        <AlertTriangle size={14} className="text-amber-400" />
                        <span
                          className={`px-2 py-0.5 rounded ${getRoleLabel(inv.role).color}`}
                        >
                          {getRoleLabel(inv.role).label}
                        </span>
                        <span>
                          expired on{" "}
                          {inv.expiresAt
                            ? new Date(inv.expiresAt).toLocaleDateString()
                            : "unknown"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Access Codes panel (full-width below the grid) ── */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 mb-3">
              <KeyRound size={16} className="text-blue-600" />
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                Access Codes
              </h3>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 font-normal">
                No-signup access for team members
              </span>
            </div>
            <AccessCodesView
              stationId={currentStation?.id}
              stationOwnerId={user?.authId}
              stationName={currentStation?.name}
              codes={accessCodes}
              availableRoles={availableRoles}
              tabIdToLabel={tabIdToLabel}
              onRefresh={loadAccessCodes}
            />
          </div>
        </>
      )}
      {/* ── Member Detail Drawer (slide-over) ── */}
      {drawerMember && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setDrawerMemberId(null)}
          />
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white dark:bg-gray-900 shadow-2xl z-50 overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-indigo-600 text-gray-900 dark:text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  {(() => {
                    const Icon = getRoleIcon(drawerMember.role);
                    return <Icon size={20} />;
                  })()}
                </div>
                <div>
                  <h3 className="font-bold text-lg leading-tight">
                    {drawerMember.accessMethod === "code"
                      ? drawerMember.memberName
                      : drawerMember.username}
                  </h3>
                  <p className="text-xs text-gray-900 dark:text-white/80">
                    {getRoleLabel(drawerMember.role).label} ·{" "}
                    {drawerMember.accessMethod === "code"
                      ? "Access Code"
                      : "Invite Link"}
                    {drawerMember.accessMethod === "code" &&
                      ` · ${accessModeLabel(
                        drawerMember.accessMode ||
                          (drawerMember.readOnly ? "read" : "full"),
                      )}`}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDrawerMemberId(null)}
                className="p-2 hover:bg-white/20 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Identity */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <IdCard size={12} /> Identity
                </h4>
                {drawerMember.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail
                      size={14}
                      className="text-gray-500 dark:text-gray-400"
                    />
                    <span className="text-gray-700 dark:text-gray-300 truncate">
                      {drawerMember.email}
                    </span>
                  </div>
                )}
                {drawerMember.uniqueId && (
                  <div className="flex items-center gap-2 text-sm">
                    <IdCard
                      size={14}
                      className="text-gray-500 dark:text-gray-400"
                    />
                    <span className="text-gray-700 dark:text-gray-300 font-mono text-xs">
                      {drawerMember.uniqueId}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Clock
                    size={14}
                    className="text-gray-500 dark:text-gray-400"
                  />
                  <span className="text-gray-700 dark:text-gray-300">
                    Joined{" "}
                    {new Date(drawerMember.invitedAt).toLocaleDateString()}
                  </span>
                </div>
                {drawerMember.invitedBy && (
                  <div className="flex items-center gap-2 text-sm">
                    <GitBranch
                      size={14}
                      className="text-gray-500 dark:text-gray-400"
                    />
                    <span className="text-gray-700 dark:text-gray-300">
                      Invited by {drawerMember.invitedBy}
                      {drawerMember.invitedByUniqueId &&
                        ` (${drawerMember.invitedByUniqueId})`}
                    </span>
                  </div>
                )}
              </div>

              {/* Access activity (code members) */}
              {drawerMember.accessMethod === "code" && (
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 space-y-2">
                  <h4 className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide flex items-center gap-1">
                    <Activity size={12} /> Access Activity
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 text-center">
                      <p className="text-xl font-bold text-blue-600">
                        {drawerMember.accessCount ?? 0}
                      </p>
                      <p className="text-[10px] text-gray-500">Logins</p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 rounded-lg p-2 text-center">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        {drawerMember.lastAccessedAt
                          ? new Date(
                              drawerMember.lastAccessedAt,
                            ).toLocaleDateString()
                          : "Never"}
                      </p>
                      <p className="text-[10px] text-gray-500">Last Access</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Assigned pumps/shifts (invite members) */}
              {drawerMember.accessMethod === "invite" && canAssign && (
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-3 space-y-3">
                  <h4 className="text-xs font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide flex items-center gap-1">
                    <Fuel size={12} /> Assignments
                  </h4>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Assigned Pumps
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {pumpOptions.length === 0 && (
                        <span className="text-[10px] text-gray-500 dark:text-gray-400">
                          No pumps configured.
                        </span>
                      )}
                      {pumpOptions.map((p) => {
                        const selected = drawerMember.assignedPumps.includes(
                          p.id,
                        );
                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              const next = selected
                                ? drawerMember.assignedPumps.filter(
                                    (x: string) => x !== p.id,
                                  )
                                : [...drawerMember.assignedPumps, p.id];
                              assignPumps(drawerMember.id, next);
                            }}
                            className={`text-[10px] px-2 py-1 rounded-full border transition-all ${selected ? "bg-green-100 text-green-700 border-green-300" : "bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-600"}`}
                          >
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Assigned Shifts
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {shiftOptions.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            const next = drawerMember.assignedShifts.includes(s)
                              ? drawerMember.assignedShifts.filter(
                                  (x: string) => x !== s,
                                )
                              : [...drawerMember.assignedShifts, s];
                            assignShifts(drawerMember.id, next);
                          }}
                          className={`text-[10px] px-2 py-1 rounded-full border transition-all ${drawerMember.assignedShifts.includes(s) ? "bg-blue-100 text-blue-700 border-blue-300" : "bg-white dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-600"}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                  Quick Actions
                </h4>
                {drawerMember.accessMethod === "code" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={async () => {
                        await toggleAccessCode(
                          drawerMember.id,
                          currentStation?.id,
                        );
                        loadAccessCodes();
                      }}
                      className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <KeyRound size={12} />{" "}
                      {drawerMember.active ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          confirm(
                            `Delete the access code for ${drawerMember.memberName}?`,
                          )
                        ) {
                          await deleteAccessCode(
                            drawerMember.id,
                            currentStation?.id,
                          );
                          loadAccessCodes();
                          setDrawerMemberId(null);
                        }
                      }}
                      className="px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {canSetLimits && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={extendDaysByMember[drawerMember.id] ?? "30"}
                          onChange={(e) =>
                            setExtendDaysByMember((prev) => ({
                              ...prev,
                              [drawerMember.id]: e.target.value,
                            }))
                          }
                          className="w-20 px-2 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded text-xs dark:text-gray-900 dark:text-white"
                          placeholder="Days"
                        />
                        <button
                          onClick={() =>
                            extendAccess(
                              drawerMember.id,
                              parseInt(
                                extendDaysByMember[drawerMember.id] ?? "30",
                              ) || 30,
                            )
                          }
                          className="flex-1 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5"
                        >
                          <RefreshCw size={12} /> Extend Access
                        </button>
                      </div>
                    )}
                    {canRevoke && drawerMember.role !== "owner" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(`Remove ${drawerMember.username}'s access?`)
                          ) {
                            revokeMember(drawerMember.id);
                            setDrawerMemberId(null);
                          }
                        }}
                        className="w-full px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5"
                      >
                        <Ban size={12} /> Revoke Access
                      </button>
                    )}
                  </div>
                )}
                {drawerMember.expiresAt && (
                  <div
                    className={`text-[10px] text-center p-2 rounded-lg ${new Date(drawerMember.expiresAt) < new Date() ? "bg-red-50 dark:bg-red-900/20 text-red-600" : "bg-gray-50 dark:bg-gray-800 text-gray-500"}`}
                  >
                    {new Date(drawerMember.expiresAt) < new Date()
                      ? "Expired"
                      : "Expires"}{" "}
                    on {new Date(drawerMember.expiresAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium z-50 flex items-center gap-2">
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Roles & Permissions View — full per-role permission editor + custom role
// creator. This is the heart of the hierarchy/delegation system: the Owner
// (or a delegated canGrantPermissions role) can toggle every boolean in the
// PermissionConfig for each role, create custom roles (accountant, cashier,
// ...), and the escalation guard prevents granting powers the granter doesn't
// hold themselves.
// =============================================================================

interface RolesAndPermissionsViewProps {
  isOwner: boolean;
  canManagePermissions: boolean;
  canCreateRoles: boolean;
  customRoles: CustomRole[];
  resolvePermissions: (roleName: string) => PermissionConfig;
  resolveTabGrants: (roleName: string) => string[];
  roleTabGrants: Record<string, string[]>;
  setRolePermission: (
    targetRole: UserRole,
    perm: keyof PermissionConfig,
    value: boolean,
  ) => void;
  grantTabToRole: (targetRole: UserRole, tabId: string) => void;
  revokeTabFromRole: (targetRole: UserRole, tabId: string) => void;
  setRoleTabGrants: (grants: Record<string, string[]>) => void;
  createCustomRole: (
    slug: string,
    label: string,
    baseRole?: BaseUserRole,
    rank?: number,
  ) => CustomRole | null;
  deleteCustomRole: (slug: string) => void;
  updateCustomRole: (slug: string, updates: Partial<CustomRole>) => void;
  outranks: (otherRole: string) => boolean;
  hasPermission: (key: keyof PermissionConfig) => boolean;
  tabIdToLabel: Record<string, string>;
  permEditorRole: string | null;
  setPermEditorRole: (r: string | null) => void;
  showRoleCreator: boolean;
  setShowRoleCreator: (v: boolean) => void;
  newRoleName: string;
  setNewRoleName: (v: string) => void;
  newRoleLabel: string;
  setNewRoleLabel: (v: string) => void;
  newRoleBase: BaseUserRole;
  setNewRoleBase: (v: BaseUserRole) => void;
}

function RolesAndPermissionsView(props: RolesAndPermissionsViewProps) {
  const {
    isOwner,
    canManagePermissions,
    canCreateRoles,
    customRoles,
    resolvePermissions,
    setRolePermission,
    createCustomRole,
    deleteCustomRole,
    outranks,
    hasPermission,
    permEditorRole,
    setPermEditorRole,
    showRoleCreator,
    setShowRoleCreator,
    newRoleName,
    setNewRoleName,
    newRoleLabel,
    setNewRoleLabel,
    newRoleBase,
    setNewRoleBase,
    // tabIdToLabel is intentionally not destructured — the per-role tab
    // grants grid lives in the Feature Access Control panel (Team Access
    // sub-tab), not here. Kept on the props interface for future use.
  } = props;

  // All roles the current user can edit: base roles they outrank + custom roles
  // they outrank. Owner outranks everything.
  const allRoles: { id: string; label: string; isCustom: boolean }[] = [];
  for (const r of ["manager", "staff", "auditor"]) {
    if (outranks(r))
      allRoles.push({ id: r, label: getRoleLabel(r).label, isCustom: false });
  }
  for (const cr of customRoles) {
    if (outranks(cr.name)) {
      allRoles.push({ id: cr.name, label: cr.label, isCustom: true });
    }
  }

  const handleCreateRole = () => {
    if (!newRoleName.trim()) return;
    const created = createCustomRole(newRoleName, newRoleLabel, newRoleBase);
    if (created) {
      setNewRoleName("");
      setNewRoleLabel("");
      setShowRoleCreator(false);
      setPermEditorRole(created.name);
    } else {
      toastError(
        "Could not create role. The name may be reserved (owner/manager/staff/auditor) or already exists.",
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg flex items-center justify-center flex-shrink-0">
            <KeyRound
              size={20}
              className="text-indigo-600 dark:text-indigo-400"
            />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Roles &amp; Permissions Hierarchy
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Owner &gt; Manager &gt; Staff &gt; Auditor (+ custom roles).
              {isOwner
                ? " You have full control as the Owner."
                : " You can only manage roles below your rank and grant powers you yourself hold."}
            </p>
          </div>
        </div>
      </div>

      {/* Custom role creator */}
      {canCreateRoles && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          {!showRoleCreator ? (
            <div className="space-y-3">
              {/* Quick presets */}
              <div>
                <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                  <Zap size={12} /> Quick Role Presets — one-click templates
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {ROLE_PRESETS.map((preset) => (
                    <button
                      key={preset.slug}
                      onClick={() => {
                        setNewRoleName(preset.slug);
                        setNewRoleLabel(preset.label);
                        setNewRoleBase(preset.base);
                        setShowRoleCreator(true);
                      }}
                      className="p-2.5 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-800 rounded-lg text-left transition-colors"
                      title={preset.description}
                    >
                      <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">
                        {preset.label}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                        {preset.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setShowRoleCreator(true)}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-gray-900 dark:text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                <Plus size={16} /> Create Custom Role
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                New Custom Role
              </h3>
              <p className="text-xs text-gray-500">
                Custom roles (e.g. Accountant, Cashier) inherit from a base role
                and can be finely tuned below. They always rank below the Owner.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Slug (internal name)
                  </label>
                  <input
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="accountant"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Display label
                  </label>
                  <input
                    value={newRoleLabel}
                    onChange={(e) => setNewRoleLabel(e.target.value)}
                    placeholder="Accountant"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">
                    Inherit from
                  </label>
                  <select
                    value={newRoleBase}
                    onChange={(e) =>
                      setNewRoleBase(e.target.value as BaseUserRole)
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
                  >
                    <option value="manager">Manager</option>
                    <option value="staff">Staff</option>
                    <option value="auditor">Auditor</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateRole}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
                >
                  <Plus size={14} /> Create Role
                </button>
                <button
                  onClick={() => setShowRoleCreator(false)}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Permission editors per role */}
      {allRoles.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No roles available for you to manage.
        </div>
      )}
      {allRoles.map((r) => {
        const isOpen = permEditorRole === r.id;
        const perms = resolvePermissions(r.id);
        const cr = customRoles.find((c) => c.name === r.id);
        return (
          <div
            key={r.id}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <button
              onClick={() => setPermEditorRole(isOpen ? null : r.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${getRoleLabel(r.id).color}`}
                >
                  {r.label}
                </div>
                {r.isCustom && (
                  <span className="text-[10px] px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
                    Custom
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  Rank {rankOf(r.id)}
                </span>
              </div>
              {isOpen ? (
                <ChevronUp
                  size={16}
                  className="text-gray-500 dark:text-gray-400"
                />
              ) : (
                <ChevronDown
                  size={16}
                  className="text-gray-500 dark:text-gray-400"
                />
              )}
            </button>
            {isOpen && (
              <div className="border-t border-gray-100 dark:border-gray-700 p-4 space-y-4">
                {r.isCustom && canManagePermissions && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            `Delete the custom role "${r.label}"? This cannot be undone.`,
                          )
                        ) {
                          deleteCustomRole(r.id);
                          setPermEditorRole(null);
                        }
                      }}
                      className="px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-medium rounded-lg flex items-center gap-1.5 hover:bg-red-100 dark:hover:bg-red-900/40"
                    >
                      <Trash2 size={12} /> Delete Role
                    </button>
                  </div>
                )}
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.group}>
                    <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      {group.group}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {group.perms.map((p) => {
                        const value = Boolean(perms[p.key]);
                        // Escalation guard: the granter must hold the permission
                        // themselves to grant it. The context double-checks.
                        const canToggle =
                          canManagePermissions &&
                          (isOwner ||
                            p.key === "canViewDashboard" || // view-dashboard is safe
                            hasPermission(p.key));
                        return (
                          <label
                            key={String(p.key)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border cursor-pointer transition-all ${
                              value
                                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                                : "bg-gray-50 dark:bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-500"
                            } ${!canToggle ? "opacity-50 cursor-not-allowed" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={value}
                              disabled={!canToggle}
                              onChange={(e) =>
                                setRolePermission(
                                  r.id as UserRole,
                                  p.key,
                                  e.target.checked,
                                )
                              }
                              className="sr-only"
                            />
                            {value ? (
                              <ToggleRight
                                size={16}
                                className="flex-shrink-0"
                              />
                            ) : (
                              <ToggleLeft size={16} className="flex-shrink-0" />
                            )}
                            <span>{p.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {!canManagePermissions && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <ShieldAlert size={12} /> You need the &quot;Grant
                    Permissions&quot; power to edit these settings.
                  </p>
                )}
                {/* Rank display for custom roles */}
                {cr && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700">
                    Base: {cr.label} · Rank: {cr.rank} · Created{" "}
                    {new Date(cr.createdAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// AccessCodeForm — the creation form, extracted so it can be reused BOTH
// from the unified "Add Team Member" card (addMode === "code") AND from the
// AccessCodesView panel below. Uses the SAME role list (availableRoles) as
// the Invite-Link form, and adds an allowedTabs picker (checkboxes from
// tabIdToLabel) so the owner can restrict which tabs an access-code member
// sees — interlinking with the Roles & Permissions concept. empty
// allowedTabs = all tabs (read-only viewers usually want all).
// ============================================================
function AccessCodeForm({
  stationId,
  availableRoles,
  tabIdToLabel,
  stationName,
  onCreated,
  onCancel,
}: {
  stationId?: string;
  availableRoles: { id: string; label: string }[];
  tabIdToLabel: Record<string, string>;
  stationName?: string;
  stationOwnerId?: string;
  getRoleLabel?: (role: string) => {
    label: string;
    color: string;
    desc: string;
  };
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState(
    availableRoles[0]?.id ?? "staff",
  );
  const [accessMode, setAccessMode] = useState<AccessMode>("read");
  const [allowedTabs, setAllowedTabs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleTab = (tabId: string) => {
    setAllowedTabs((prev) =>
      prev.includes(tabId) ? prev.filter((t) => t !== tabId) : [...prev, tabId],
    );
  };

  const handleCreate = async () => {
    setError("");
    if (!username.trim() || !password.trim() || !memberName.trim()) {
      setError("Username, password, and member name are required.");
      return;
    }
    if (password.trim().length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    try {
      await createAccessCode(
        {
          username: username.trim(),
          password: password.trim(),
          memberName: memberName.trim(),
          memberRole,
          allowedTabs,
          readOnly: accessMode === "read",
          accessMode,
        },
        stationId,
      );
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-blue-900 dark:text-blue-300">
        Create Access Code
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">Username *</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
            placeholder="e.g. cashier1"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Password *</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
            placeholder="min 4 characters"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Member Name *</label>
          <input
            type="text"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
            placeholder="e.g. John Mwangi"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Role</label>
          {/* Uses the SAME availableRoles as the Invite-Link form (base +
              custom roles) — no more hardcoded list. */}
          <select
            value={memberRole}
            onChange={(e) => setMemberRole(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-gray-900 dark:text-white"
          >
            {availableRoles.length === 0 && (
              <option value="staff">Staff</option>
            )}
            {availableRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Allowed-tabs picker — interlinks with the Roles & Permissions /
          Feature Access Control concept. Empty = all tabs (recommended for
          read-only viewers). */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">
          Allowed Tabs{" "}
          <span className="text-gray-500 dark:text-gray-400">
            (empty = all tabs · restrict to limit what this member can view)
          </span>
        </label>
        <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          {Object.entries(tabIdToLabel).map(([id, label]) => {
            const selected = allowedTabs.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleTab(id)}
                className={`text-[10px] px-2 py-1 rounded-full border transition-all ${selected ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300" : "bg-white text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:text-gray-400"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
        Access mode — you decide what this member can do
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(["read", "edit", "full"] as AccessMode[]).map((m) => {
          const [label, desc] = {
            read: ["Read only", "View only — no changes"],
            edit: ["Edit only", "Add/update — no deletes"],
            full: ["Normal", "Full access to assigned tabs"],
          }[m];
          return (
            <button
              key={m}
              type="button"
              onClick={() => setAccessMode(m)}
              aria-pressed={accessMode === m}
              title={desc}
              className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg text-[11px] border transition-colors ${
                accessMode === m
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
              }`}
            >
              <span className="font-semibold">{label}</span>
              <span
                className={`text-[9px] ${
                  accessMode === m
                    ? "text-white/80"
                    : "text-gray-400 dark:text-gray-500"
                }`}
              >
                {desc}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm dark:text-gray-900 dark:text-white"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={busy}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
        >
          <KeyRound size={14} /> {busy ? "Creating..." : "Create Code"}
        </button>
      </div>
      {stationName && (
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          For station: {stationName}
        </p>
      )}
    </div>
  );
}

// ============================================================
// AccessCodesView — management panel for access codes. Now receives the
// lifted `codes` + `onRefresh` from the parent (so the blended Team
// Members list + stats stay in sync), plus `availableRoles` +
// `tabIdToLabel` so the inline form uses the SAME role list + tab
// permissions as Invite Links. Also adds WhatsApp/Email share buttons to
// the access link (parity with invite links).
// ============================================================
function AccessCodesView({
  stationId,
  stationOwnerId,
  stationName,
  codes,
  availableRoles,
  tabIdToLabel,
  onRefresh,
}: {
  stationId?: string;
  stationOwnerId?: string;
  stationName?: string;
  codes: StationAccessCode[];
  availableRoles: { id: string; label: string }[];
  tabIdToLabel: Record<string, string>;
  onRefresh: () => void | Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState("");

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Delete this access code? The member will no longer be able to log in.",
      )
    )
      return;
    await deleteAccessCode(id, stationId);
    await onRefresh();
    flash("Access code deleted");
  };

  const handleToggle = async (id: string) => {
    await toggleAccessCode(id, stationId);
    await onRefresh();
  };

  const handleCycleMode = async (id: string, current: AccessMode) => {
    const next: AccessMode =
      current === "read" ? "edit" : current === "edit" ? "full" : "read";
    await updateAccessCodeMode(id, next, stationId);
    await onRefresh();
    flash(`Access mode changed to ${accessModeLabel(next)}`);
  };

  const accessLink = stationOwnerId
    ? `${window.location.origin}/#/station-access?owner=${stationOwnerId}&station=${stationId || ""}`
    : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(accessLink);
      flash("Link copied to clipboard");
    } catch {
      flash("Copy failed — select the link and copy manually");
    }
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(
      `Access ${stationName || "the fuel station"} data. Open the link and enter your access-code username + password:`,
    );
    window.open(
      `https://wa.me/?text=${text}%20${encodeURIComponent(accessLink)}`,
      "_blank",
    );
  };

  const shareEmail = () => {
    const subject = encodeURIComponent(
      `Access code for ${stationName || "fuel station"}`,
    );
    const body = encodeURIComponent(
      `Hello,\n\nUse the link below to access the station data. Enter the username + password I gave you:\n\n${accessLink}\n\nThis works on any device — no signup needed.`,
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
        <h3 className="font-bold text-blue-900 dark:text-blue-200 mb-2">
          Quick Access Codes (No Signup Needed)
        </h3>
        <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
          Create a username + password for a team member. Share the access link
          below — the member enters the credentials to view station data
          (read-only by default) without creating an account. This is the
          lighter-weight counterpart to an Invite Link.
        </p>
        {accessLink && (
          <>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={accessLink}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-blue-300 dark:border-blue-700 rounded-lg text-xs dark:text-gray-900 dark:text-white font-mono"
              />
              <button
                onClick={copyLink}
                className="px-3 py-2 bg-blue-600 text-gray-900 dark:text-white rounded-lg text-xs font-medium flex items-center gap-1"
              >
                <Copy size={12} /> Copy
              </button>
            </div>
            {/* Share buttons — parity with invite links. */}
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={shareWhatsApp}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium rounded-lg transition-colors"
              >
                <MessageCircle size={14} /> WhatsApp
              </button>
              <button
                onClick={shareEmail}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium rounded-lg transition-colors"
              >
                <Mail size={14} /> Email
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-between items-center">
        <h3 className="font-semibold dark:text-gray-900 dark:text-white">
          Access Codes
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Plus size={14} /> New Access Code
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <AccessCodeForm
            stationId={stationId}
            availableRoles={availableRoles}
            tabIdToLabel={tabIdToLabel}
            stationName={stationName}
            stationOwnerId={stationOwnerId}
            onCreated={() => {
              flash("Access code created");
              onRefresh();
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {codes.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          No access codes yet. Create one to let team members log in without
          signing up.
        </p>
      ) : (
        <div className="space-y-2">
          {codes.map((c) => (
            <div
              key={c.id}
              className={`flex items-center justify-between p-3 rounded-lg border ${c.enabled ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}
            >
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm dark:text-gray-900 dark:text-white">
                    {c.memberName}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({c.username})
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
                    {c.memberRole}
                  </span>
                  {(() => {
                    const m = c.accessMode || (c.readOnly ? "read" : "full");
                    const modeCls =
                      m === "full"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : m === "edit"
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-gray-500/10 text-gray-500";
                    return (
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${modeCls}`}
                      >
                        {accessModeLabel(m)}
                      </span>
                    );
                  })()}
                  {c.allowedTabs && c.allowedTabs.length > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600">
                      {c.allowedTabs.length} tab
                      {c.allowedTabs.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${c.enabled ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}
                  >
                    {c.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  Accessed {c.accessCount} time{c.accessCount !== 1 ? "s" : ""}
                  {c.lastAccessedAt
                    ? ` · Last: ${new Date(c.lastAccessedAt).toLocaleString()}`
                    : ""}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleCycleMode(c.id, c.accessMode || "read")}
                  className="p-1.5 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg"
                  title={`Cycle access mode (currently ${accessModeLabel(
                    c.accessMode || (c.readOnly ? "read" : "full"),
                  )}). Read only → Edit only → Normal → Read only`}
                >
                  <Edit3
                    size={14}
                    className={
                      (c.accessMode || "read") !== "read"
                        ? "text-amber-600"
                        : "text-gray-500 dark:text-gray-400"
                    }
                  />
                </button>
                <button
                  onClick={() => handleToggle(c.id)}
                  className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                  title={c.enabled ? "Disable" : "Enable"}
                >
                  <KeyRound
                    size={14}
                    className={
                      c.enabled
                        ? "text-green-600"
                        : "text-gray-500 dark:text-gray-400"
                    }
                  />
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg"
                  title="Delete"
                >
                  <Trash2 size={14} className="text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ActivityHealthView — new 4th sub-tab: team activity, health metrics,
// role distribution, access insights, and quick actions. This is the
// "analytics dashboard" for the Team Manager tab.
// ============================================================

interface ActivityHealthViewProps {
  teamHealth: {
    total: number;
    active: number;
    inactive: number;
    inviteCount: number;
    codeCount: number;
    managers: number;
    staff: number;
    auditors: number;
    custom: number;
    readOnlyCount: number;
    expired: number;
    activeInvitesCount: number;
    totalCodes: number;
    enabledCodes: number;
    disabledCodes: number;
    healthScore: number;
  };
  combinedMembers: any[];
  accessCodes: StationAccessCode[];
  activeInvites: any[];
  usedInvites: any[];
  expiredInvites: any[];
  getRoleLabel: (role: string) => {
    label: string;
    color: string;
    desc: string;
  };
  exportMembersCSV: () => void;
  showToast: (msg: string) => void;
}

function ActivityHealthView({
  teamHealth,
  combinedMembers,
  activeInvites,
  usedInvites,
  expiredInvites,
  getRoleLabel,
  exportMembersCSV,
}: ActivityHealthViewProps) {
  // Shift handovers (Terminal Sessions) — management gets the same live feed
  // so unacknowledged handovers are visible to the incoming team.
  const { data: handovers } = useCloudKV<
    {
      id: string;
      note: string;
      fromShift: string;
      toShift: string;
      acknowledged: boolean;
    }[]
  >("shift_handovers", undefined, []);
  const roleDistribution = useMemo(() => {
    const roles: Record<string, number> = {};
    for (const m of combinedMembers) {
      const r = m.role || "unknown";
      roles[r] = (roles[r] || 0) + 1;
    }
    return Object.entries(roles).sort(
      (a, b) => (b[1] as number) - (a[1] as number),
    );
  }, [combinedMembers]);

  const accessBreakdown = useMemo(() => {
    const total = teamHealth.total || 1;
    return [
      {
        label: "Invite Link",
        count: teamHealth.inviteCount,
        pct: Math.round((teamHealth.inviteCount / total) * 100),
        color: "bg-indigo-500",
        Icon: Link2,
      },
      {
        label: "Access Code",
        count: teamHealth.codeCount,
        pct: Math.round((teamHealth.codeCount / total) * 100),
        color: "bg-blue-500",
        Icon: KeyRound,
      },
    ];
  }, [teamHealth]);

  const mostActiveMembers = useMemo(() => {
    return [...combinedMembers]
      .filter((m) => m.accessCount !== undefined && (m.accessCount ?? 0) > 0)
      .sort((a, b) => (b.accessCount ?? 0) - (a.accessCount ?? 0))
      .slice(0, 5);
  }, [combinedMembers]);

  const recentJoins = useMemo(() => {
    return [...combinedMembers]
      .filter((m) => m.invitedAt)
      .sort(
        (a, b) =>
          new Date(b.invitedAt).getTime() - new Date(a.invitedAt).getTime(),
      )
      .slice(0, 5);
  }, [combinedMembers]);

  const healthColor =
    teamHealth.healthScore >= 75
      ? "text-green-600"
      : teamHealth.healthScore >= 50
        ? "text-amber-600"
        : "text-red-600";

  const totalInvites =
    usedInvites.length + activeInvites.length + expiredInvites.length;
  const conversionRate =
    totalInvites > 0
      ? Math.round((usedInvites.length / totalInvites) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Health Score Banner */}
      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 flex items-center justify-center">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64">
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  className="text-gray-200 dark:text-gray-700"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeDasharray={`${(teamHealth.healthScore / 100) * 176} 176`}
                  className={healthColor}
                  strokeLinecap="round"
                />
              </svg>
              <span className={`text-xl font-bold ${healthColor}`}>
                {teamHealth.healthScore}
              </span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                Team Health Score
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {teamHealth.total === 0
                  ? "No team members yet — add members to see health metrics."
                  : teamHealth.healthScore >= 75
                    ? "Excellent — your team is well-managed and active."
                    : teamHealth.healthScore >= 50
                      ? "Fair — consider enabling inactive codes or revoking expired members."
                      : "Needs attention — check for expired/inactive members."}
              </p>
            </div>
          </div>
          {teamHealth.total > 0 && (
            <button
              onClick={exportMembersCSV}
              className="px-4 py-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium flex items-center gap-2 border border-gray-200 dark:border-gray-600 transition-colors"
            >
              <Download size={14} /> Export Team CSV
            </button>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: "Total Members",
            value: teamHealth.total,
            Icon: Users,
            color: "text-purple-600",
            bg: "bg-purple-50 dark:bg-purple-900/20",
          },
          {
            label: "Active",
            value: teamHealth.active,
            Icon: UserCheck,
            color: "text-green-600",
            bg: "bg-green-50 dark:bg-green-900/20",
          },
          {
            label: "Inactive",
            value: teamHealth.inactive,
            Icon: UserX,
            color: "text-gray-500",
            bg: "bg-gray-50 dark:bg-gray-800",
          },
          {
            label: "Active Invites",
            value: teamHealth.activeInvitesCount,
            Icon: Link2,
            color: "text-amber-600",
            bg: "bg-amber-50 dark:bg-amber-900/20",
          },
          {
            label: "Access Codes",
            value: teamHealth.enabledCodes,
            Icon: KeyRound,
            color: "text-blue-600",
            bg: "bg-blue-50 dark:bg-blue-900/20",
          },
          {
            label: "Expired",
            value: teamHealth.expired,
            Icon: AlertTriangle,
            color: "text-red-600",
            bg: "bg-red-50 dark:bg-red-900/20",
          },
        ].map((s) => (
          <div
            key={s.label}
            className={`rounded-xl p-3 border border-gray-200 dark:border-gray-700 ${s.bg}`}
          >
            <s.Icon size={16} className={s.color} />
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Role Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Crown size={16} className="text-purple-600" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Role Distribution
            </h3>
          </div>
          {roleDistribution.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              No members to analyze yet.
            </p>
          ) : (
            <div className="space-y-2">
              {roleDistribution.map(([role, count]) => {
                const info = getRoleLabel(role);
                const pct = Math.round(
                  ((count as number) / (teamHealth.total || 1)) * 100,
                );
                return (
                  <div key={role}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-600 dark:text-gray-300">
                        {info.label}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Access Method Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users2 size={16} className="text-indigo-600" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Access Method Breakdown
            </h3>
          </div>
          {teamHealth.total === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              No members to analyze yet.
            </p>
          ) : (
            <div className="space-y-3">
              {accessBreakdown.map((am) => (
                <div key={am.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                      <am.Icon size={12} /> {am.label}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {am.count} ({am.pct}%)
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${am.color}`}
                      style={{ width: `${am.pct}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
                {accessBreakdown.map((am) => (
                  <div
                    key={am.label}
                    className={am.color}
                    style={{ width: `${am.pct}%` }}
                    title={`${am.label}: ${am.count}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Most Active Members */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-green-600" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Most Active Members
            </h3>
          </div>
          {mostActiveMembers.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              No access activity recorded yet. Activity is tracked when
              access-code members log in.
            </p>
          ) : (
            <div className="space-y-2">
              {mostActiveMembers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 dark:text-gray-900 dark:text-white truncate">
                      {m.memberName || m.username}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      {m.lastAccessedAt
                        ? `Last: ${new Date(m.lastAccessedAt).toLocaleDateString()}`
                        : "Never accessed"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-indigo-600">
                      {m.accessCount ?? 0}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400">
                      logins
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recently Joined */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-blue-600" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Recently Joined
            </h3>
          </div>
          {recentJoins.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              No members have joined yet.
            </p>
          ) : (
            <div className="space-y-2">
              {recentJoins.map((m) => {
                const Icon = getRoleIcon(m.role);
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg"
                  >
                    <div
                      className={`p-1.5 rounded-lg ${getRoleLabel(m.role).color}`}
                    >
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 dark:text-gray-900 dark:text-white truncate">
                        {m.memberName || m.username}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {getRoleLabel(m.role).label} ·{" "}
                        {new Date(m.invitedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${m.accessMethod === "code" ? "bg-blue-100 text-blue-700" : "bg-indigo-100 text-indigo-700"}`}
                    >
                      {m.accessMethod === "code" ? "Code" : "Invite"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Shift Handovers (from Terminal Sessions) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList size={16} className="text-indigo-600" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            Shift Handovers
          </h3>
        </div>
        {(handovers || []).length === 0 ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
            No handovers yet (Terminal Sessions → Shift Handover).
          </p>
        ) : (
          <div className="space-y-1.5">
            {[...(handovers || [])]
              .reverse()
              .slice(0, 8)
              .map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
                >
                  <input type="checkbox" checked={h.acknowledged} readOnly />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white truncate">
                      {h.note}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {h.fromShift} → {h.toShift}
                    </p>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Invite Activity Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={16} className="text-purple-600" />
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            Invite Activity Summary
          </h3>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <CheckCircle2 size={20} className="mx-auto text-green-500 mb-1" />
            <p className="text-2xl font-bold text-green-600">
              {usedInvites.length}
            </p>
            <p className="text-[10px] text-gray-500">Used Invites</p>
          </div>
          <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
            <Link2 size={20} className="mx-auto text-amber-500 mb-1" />
            <p className="text-2xl font-bold text-amber-600">
              {activeInvites.length}
            </p>
            <p className="text-[10px] text-gray-500">Pending Invites</p>
          </div>
          <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <AlertTriangle size={20} className="mx-auto text-red-500 mb-1" />
            <p className="text-2xl font-bold text-red-600">
              {expiredInvites.length}
            </p>
            <p className="text-[10px] text-gray-500">Expired Invites</p>
          </div>
        </div>
        {totalInvites > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Invite Conversion Rate</span>
              <span className="font-semibold text-gray-700 dark:text-gray-300">
                {conversionRate}%
              </span>
            </div>
            <div className="mt-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500"
                style={{ width: `${conversionRate}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Quick Recommendations */}
      {teamHealth.total > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-amber-600" />
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Quick Recommendations
            </h3>
          </div>
          <div className="space-y-2">
            {teamHealth.expired > 0 && (
              <div className="flex items-start gap-2 p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <AlertTriangle
                  size={14}
                  className="text-red-500 mt-0.5 flex-shrink-0"
                />
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  <strong>{teamHealth.expired}</strong> member(s) have expired
                  access. Consider revoking or extending their access.
                </p>
              </div>
            )}
            {teamHealth.disabledCodes > 0 && (
              <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                <Lock
                  size={14}
                  className="text-amber-500 mt-0.5 flex-shrink-0"
                />
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  <strong>{teamHealth.disabledCodes}</strong> access code(s) are
                  disabled. Re-enable if the member should regain access.
                </p>
              </div>
            )}
            {teamHealth.activeInvitesCount > 3 && (
              <div className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <Link2
                  size={14}
                  className="text-blue-500 mt-0.5 flex-shrink-0"
                />
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  <strong>{teamHealth.activeInvitesCount}</strong> pending
                  invites. Consider cleaning up old unused invite links.
                </p>
              </div>
            )}
            {teamHealth.inactive > 0 && (
              <div className="flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <UserX
                  size={14}
                  className="text-gray-500 dark:text-gray-400 mt-0.5 flex-shrink-0"
                />
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  <strong>{teamHealth.inactive}</strong> member(s) are inactive.
                  Review if they still need access.
                </p>
              </div>
            )}
            {teamHealth.expired === 0 &&
              teamHealth.disabledCodes === 0 &&
              teamHealth.inactive === 0 && (
                <div className="flex items-start gap-2 p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <CheckCircle2
                    size={14}
                    className="text-green-500 mt-0.5 flex-shrink-0"
                  />
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    All members are active and up to date. Great job!
                  </p>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
