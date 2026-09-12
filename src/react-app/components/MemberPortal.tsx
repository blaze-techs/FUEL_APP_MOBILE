import { useState, useEffect, useMemo, useRef } from "react";
import {
  Fuel,
  LogOut,
  Shield,
  Eye,
  EyeOff,
  RefreshCw,
  QrCode,
  Clock,
  LayoutDashboard,
  TrendingUp,
  ShoppingBag,
  CreditCard,
  Receipt,
  Truck,
  Users,
  Gauge,
  DollarSign,
  Search,
  FileDown,
  Printer,
  Package,
  Fuel as FuelIcon,
  MessageCircle,
  FlaskConical,
  Calendar,
  Wallet,
  LineChart,
  Database,
  MoreHorizontal,
  X,
  Activity,
  FileBarChart,
  Newspaper,
  Wrench,
  AlertCircle,
  Edit3,
  Zap,
} from "lucide-react";
import type { StationAccessSession } from "@/react-app/lib/station-access-code-service";
import { applyMemberEdit } from "@/react-app/lib/station-access-code-service";
import type { StationSnapshot } from "@/react-app/lib/station-snapshot-service";
import { getCurrencySymbol } from "@/react-app/lib/currency";

/** Member access-mode copy used across the portal. */
function memberModeOf(session: StationAccessSession): "read" | "edit" | "full" {
  return (session.accessMode || (session.readOnly ? "read" : "full")) as
    "read" | "edit" | "full";
}

/** ────────────────────────────────────────────────────────────────────────
 * MemberPortal — the FULL-APP, read-only experience for team members who
 * were granted access via a Team Manager invite, an Access Code, a Company
 * QR grant, or a shared station link.
 *
 * These members have NO Supabase session (RLS would block app_kv), so the
 * portal renders the station OWNER's curated public snapshot through the
 * SAME navigation surface the owner uses: header with brand + identity +
 * quick search, a desktop tab bar and mobile bottom nav listing the whole
 * site, and read-only views per tab — restricted to the tabs the owner
 * approved for this member's role.
 *
 * Security model:
 *  - EVERY view is fed from `snapshot` (owner-published, PII-light) — never
 *    a live RLS query.
 *  - Tab access = `session.allowedTabs` when the owner restricted a code,
 *    otherwise the member's ROLE defaults (PermissionContext table shape).
 *  - QR-grant sessions carry a server-enforced expiry; the portal enforces
 *    it client-side too (countdown + auto-logout).
 *  - Read-only everywhere: no forms mutate anything, there is no session to
 *    leak, and printing/export only emits what the member can already see.
 * ──────────────────────────────────────────────────────────────────────── */

// ── Role-based default tab access ──────────────────────────────────────────
// Mirrors PermissionContext.DEFAULT_ROLE_TABS (base roles). When an access
// code leaves allowedTabs empty, the member defaults to these.
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

// ── Full-site tab registry (id → label/icon) ──────────────────────────────
// Every tab the main app exposes. The member sees all of them; each renders
// a read-only view backed by the snapshot (or a "not shared" empty state).
interface PortalTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const ALL_TABS: PortalTab[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sales", label: "Sales", icon: TrendingUp },
  { id: "pos", label: "Point of Sale", icon: ShoppingBag },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "delivery", label: "Deliveries", icon: Truck },
  { id: "offloading", label: "Offloading", icon: Fuel },
  { id: "invoice", label: "Invoices", icon: Receipt },
  { id: "credit", label: "Credit", icon: CreditCard },
  { id: "customers", label: "Customers", icon: Users },
  { id: "mpesa", label: "M-PESA", icon: Wallet },
  { id: "livetransaction", label: "Live Transaction", icon: Activity },
  { id: "payroll", label: "Payroll", icon: Users },
  { id: "suppliers", label: "Suppliers", icon: Truck },
  { id: "expenses", label: "Expenses", icon: DollarSign },
  { id: "fueltypes", label: "Fuel Types", icon: FuelIcon },
  { id: "quality", label: "Fuel Quality", icon: FlaskConical },
  { id: "team", label: "Team", icon: Users },
  { id: "shifts", label: "Shifts", icon: Calendar },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "communication", label: "Communication", icon: MessageCircle },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "analytics", label: "Analytics", icon: LineChart },
  { id: "fuelsalesreport", label: "Fuel Report", icon: TrendingUp },
  { id: "data", label: "Data", icon: Database },
  { id: "news", label: "News", icon: Newspaper },
  { id: "settings", label: "Settings", icon: Gauge },
  { id: "audit", label: "Audit Trail", icon: Activity },
  { id: "automation", label: "Automation", icon: Zap },
  { id: "documents", label: "Documents", icon: FileBarChart },
  { id: "integration", label: "Integration", icon: MessageCircle },
  { id: "price-finder", label: "Fuel Price Finder", icon: TrendingUp },
  { id: "pumpmapping", label: "Pump Mapping", icon: Gauge },
  { id: "regional", label: "Compliance", icon: Shield },
  { id: "terminal", label: "Terminal", icon: Activity },
];

function normalizeRole(role: string): string {
  const r = (role || "").toLowerCase();
  if (r.includes("manager")) return "manager";
  if (r.includes("staff") || r.includes("cashier") || r.includes("attendant"))
    return "staff";
  if (r.includes("audit")) return "auditor";
  if (r.includes("owner")) return "manager";
  return "staff";
}

/** Resolve the effective tab ids for this member. */
function resolveVisibleTabs(session: StationAccessSession): PortalTab[] {
  const allowed = session.allowedTabs ?? [];
  let ids = allowed;
  if (allowed.length === 0) {
    const defaults = ROLE_DEFAULT_TABS[normalizeRole(session.memberRole)];
    ids = defaults ?? ROLE_DEFAULT_TABS.staff;
  }
  const set = new Set(ids);
  // Always include dashboard even if a weird config omits it.
  set.add("dashboard");
  return ALL_TABS.filter((t) => set.has(t.id));
}

interface MemberPortalProps {
  session: StationAccessSession;
  snapshot: StationSnapshot | null;
  snapshotLoading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}

export default function MemberPortal({
  session,
  snapshot,
  snapshotLoading,
  onRefresh,
  onLogout,
}: MemberPortalProps) {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showMore, setShowMore] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // Member contribution (edit/full modes): suggest a change for the owner.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestDone, setSuggestDone] = useState(false);
  const canContribute = memberModeOf(session) !== "read";

  const submitSuggestion = async () => {
    if (!suggestText.trim() || !session.stationOwnerId || !session.stationId)
      return;
    setSuggestBusy(true);
    const res = await applyMemberEdit({
      ownerId: session.stationOwnerId,
      stationId: session.stationId,
      accessCodeId: session.accessCodeId,
      tab: activeTab,
      payload: {
        note: suggestText.trim(),
        section: activeTab,
        member: session.memberName,
      },
    });
    setSuggestBusy(false);
    if (res.ok) {
      setSuggestDone(true);
      setSuggestText("");
      setTimeout(() => {
        setSuggestDone(false);
        setSuggestOpen(false);
      }, 1800);
    } else {
      setSuggestDone(false);
      setSuggestText(`Not saved: ${res.error || "try again later."}`);
    }
  };

  const visibleTabs = useMemo(() => resolveVisibleTabs(session), [session]);

  // QR-grant expiry: client-side countdown + auto-logout (server enforces
  // too via the redeem RPC).
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!session.grantExpiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session.grantExpiresAt]);
  const expired =
    session.grantExpiresAt != null && now >= (session.grantExpiresAt as number);
  useEffect(() => {
    if (expired) onLogout();
  }, [expired, onLogout]);

  // Ctrl/Cmd+K opens the member quick-search.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleTabs.slice(0, 8);
    return visibleTabs.filter((t) =>
      `${t.label} ${t.id}`.toLowerCase().includes(q),
    );
  }, [searchQuery, visibleTabs]);

  const executeSearch = (id: string) => {
    setActiveTab(id);
    setSearchOpen(false);
    setSearchQuery("");
    setShowMore(false);
  };

  const currency = snapshot?.currency || "USD";
  const symbol = getCurrencySymbol(currency);
  const fmt = (n: number | undefined | null) =>
    Number.isFinite(n as number)
      ? `${symbol}${(n as number).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
      : "—";

  const expireInMs = session.grantExpiresAt
    ? (session.grantExpiresAt as number) - now
    : null;

  // Export the CURRENT view as CSV (only what the member can already see).
  const exportView = () => {
    if (!snapshot) return;
    const rows: Record<string, string | number>[] = [];
    const headers: string[] = [];
    switch (activeTab) {
      case "sales":
      case "pos":
        headers.push("Invoice", "Date", "Fuel", "Litres", "Total", "Payment");
        snapshot.recentSales.forEach((s) =>
          rows.push({
            Invoice: s.invoice || "",
            Date: s.date || "",
            Fuel: s.fuel || "",
            Litres: s.litres ?? "",
            Total: s.total ?? "",
            Payment: s.payment || "",
          }),
        );
        break;
      case "delivery":
        headers.push(
          "Date",
          "Registration",
          "Fuel",
          "Litres",
          "Amount",
          "Customer",
          "Debt",
        );
        (snapshot.deliveries ?? []).forEach((d) =>
          rows.push({
            Date: d.date || "",
            Registration: d.reg || "",
            Fuel: d.fuel || "",
            Litres: d.litres ?? "",
            Amount: d.amount ?? "",
            Customer: d.name || "",
            Debt: d.debt ?? "",
          }),
        );
        break;
      case "credit":
        headers.push("Customer", "Balance", "Limit", "Status");
        snapshot.creditAccounts.forEach((c) =>
          rows.push({
            Customer: c.name,
            Balance: c.balance,
            Limit: c.limit,
            Status: c.status || "",
          }),
        );
        break;
      case "invoices":
        headers.push("Invoice #", "Customer", "Total", "Date", "Status");
        snapshot.invoices.forEach((i) =>
          rows.push({
            "Invoice #": i.number || "",
            Customer: i.customer || "",
            Total: i.total ?? "",
            Date: i.date || "",
            Status: i.status || "",
          }),
        );
        break;
      case "customers":
        headers.push("Name", "Phone", "Email");
        (snapshot.customers ?? []).forEach((c) =>
          rows.push({
            Name: c.name,
            Phone: c.phone || "",
            Email: c.email || "",
          }),
        );
        break;
      default:
        headers.push("Section", "Value");
        rows.push({ Section: "Station", Value: snapshot.stationName });
        rows.push({ Section: "Currency", Value: snapshot.currency });
        rows.push({
          Section: "Updated",
          Value: new Date(snapshot.updatedAt).toLocaleString(),
        });
    }
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        headers.map((h) => JSON.stringify(String(r[h] ?? ""))).join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${snapshot.stationName || "station"}-${activeTab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Primary (mobile bottom bar) tabs — first 5 visible.
  const primaryTabs = visibleTabs.slice(0, 5);
  const moreTabs = visibleTabs.slice(5);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center shrink-0">
              <Fuel className="text-green-600" size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold dark:text-white leading-tight truncate">
                {snapshot?.stationName || "Station Access"}
              </h1>
              <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1">
                  <Shield size={11} /> {session.memberName} ·{" "}
                  {session.memberRole}
                </span>
                {(() => {
                  const m =
                    session.accessMode || (session.readOnly ? "read" : "full");
                  const [lbl, cls, Icon] =
                    m === "full"
                      ? ["Normal", "text-green-600", EyeOff]
                      : m === "edit"
                        ? [
                            "Edit only",
                            "text-amber-600 dark:text-amber-400",
                            EyeOff,
                          ]
                        : ["Read-Only", "text-blue-600", Eye];
                  return (
                    <span className={`flex items-center gap-1 ${cls}`}>
                      <Icon size={11} /> {lbl}
                    </span>
                  );
                })()}
                {session.method === "qr-grant" && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-300">
                    <QrCode size={10} /> QR Grant
                  </span>
                )}
                {session.method === "code" && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-300">
                    <Shield size={10} /> Access Code
                  </span>
                )}
                {expireInMs != null && (
                  <span
                    className={`flex items-center gap-1 ${expireInMs < 5 * 60 * 1000 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
                  >
                    <Clock size={11} />
                    {expireInMs <= 0
                      ? "Expired"
                      : `Access ends in ${formatDuration(expireInMs)}`}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium flex items-center gap-1.5"
              title="Quick search (Ctrl+K)"
            >
              <Search size={14} /> Search
            </button>
            <button
              onClick={exportView}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-medium flex items-center gap-1.5"
              title="Export current view as CSV"
            >
              <FileDown size={14} /> Export
            </button>
            {canContribute && (
              <button
                onClick={() => {
                  setSuggestDone(false);
                  setSuggestText("");
                  setSuggestOpen(true);
                }}
                className="px-3 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium flex items-center gap-1.5"
                title="Suggest a change for the station owner"
              >
                <Edit3 size={14} /> Suggest
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="hidden sm:flex px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-medium items-center gap-1.5"
              title="Print current view"
            >
              <Printer size={14} /> Print
            </button>
            <button
              onClick={onLogout}
              className="px-3 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-xs font-medium flex items-center gap-1.5"
            >
              <LogOut size={14} /> Log Out
            </button>
          </div>
        </div>

        {/* ── Desktop tab bar (full site, membership-gated) ───────── */}
        <div className="hidden md:block max-w-6xl mx-auto px-4 pb-2">
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Mobile header row: title + bottom-nav trigger ────────── */}
        <div className="md:hidden max-w-6xl mx-auto px-4 pb-2 flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500 truncate">
            {visibleTabs.find((t) => t.id === activeTab)?.label || "Dashboard"}
          </span>
          <button
            onClick={() => setShowMore(true)}
            className="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg text-xs flex items-center gap-1"
          >
            <MoreHorizontal size={14} /> All Features
          </button>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        {snapshotLoading && !snapshot && (
          <div className="flex items-center justify-center gap-2 text-gray-400 py-12">
            <RefreshCw size={18} className="animate-spin" />
            Loading station data…
          </div>
        )}

        {!snapshotLoading && !snapshot && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6 text-center">
            <AlertCircle className="mx-auto text-amber-500 mb-2" size={32} />
            <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-1">
              No shared data available yet
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              The station owner hasn't published a data snapshot. Please ask
              them to open the Team Manager tab → Access Codes → "Refresh shared
              snapshot". The data will appear here automatically.
            </p>
          </div>
        )}

        {snapshot && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>
                Last updated: {new Date(snapshot.updatedAt).toLocaleString()}
              </span>
              <button
                onClick={onRefresh}
                className="flex items-center gap-1 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <RefreshCw size={11} /> Refresh
              </button>
            </div>

            {/* View renderer — every allowed tab, read-only */}
            {renderView(activeTab, snapshot, fmt)}
          </div>
        )}
      </main>

      {/* ── Mobile bottom nav (primary tabs) ───────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-stretch justify-around pb-[env(safe-area-inset-bottom)]">
        {primaryTabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id);
                setShowMore(false);
              }}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] ${
                activeTab === t.id
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-gray-500"
              }`}
            >
              <Icon size={18} />
              <span className="truncate max-w-full px-1">{t.label}</span>
            </button>
          );
        })}
      </nav>
      {showMore && moreTabs.length > 0 && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50 flex flex-col-reverse"
          onClick={() => setShowMore(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold dark:text-white">All Features</h3>
              <button onClick={() => setShowMore(false)} aria-label="Close">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {moreTabs.map((t) => {
                const Icon = t.icon;
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setActiveTab(t.id);
                      setShowMore(false);
                    }}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl text-[11px] ${
                      isActive
                        ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300"
                        : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                    }`}
                  >
                    <Icon size={18} />
                    <span className="text-center leading-tight">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Quick search palette (Ctrl+K) ──────────────────────────── */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 p-4 flex items-start justify-center pt-20"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <Search size={16} className="text-gray-400" />
              <input
                ref={searchRef}
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search approved sections…"
                className="flex-1 bg-transparent text-sm dark:text-white outline-none"
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="text-[10px] text-gray-400 px-2 py-0.5 border border-gray-200 dark:border-gray-700 rounded"
              >
                ESC
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {searchHits.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-6">
                  No approved sections match.
                </p>
              )}
              {searchHits.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => executeSearch(t.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                  >
                    <Icon size={15} className="text-gray-400" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Suggest a change (edit/full modes) ────────────────────── */}
      {suggestOpen && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 p-4 flex items-start justify-center pt-24"
          onClick={() => setSuggestOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <Edit3 size={16} className="text-amber-500" />
              <h3 className="font-semibold dark:text-white flex-1">
                Suggest a change
              </h3>
              <button
                onClick={() => setSuggestOpen(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <p className="text-xs text-gray-500 mb-2">
                Your note is sent to the station owner and appears in their Team
                Manager → Suggestions. They decide what to apply.
              </p>
              <textarea
                value={suggestText}
                onChange={(e) => setSuggestText(e.target.value)}
                rows={4}
                placeholder={`Describe the ${activeTab} change…`}
                className="w-full p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
              {suggestDone && (
                <p className="text-xs text-green-600 mt-1">
                  ✓ Sent — the owner will see it shortly.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setSuggestOpen(false)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={submitSuggestion}
                disabled={suggestBusy || !suggestText.trim()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
              >
                <Edit3 size={13} />
                {suggestBusy ? "Sending…" : "Send to owner"}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="text-center text-[10px] text-gray-400 py-3 px-4 md:pb-4">
        {canContribute ? "Member access" : "Read-only member access"} · Changes
        are not saved locally · Data auto-refreshes every 30s
      </footer>
    </div>
  );
}

function litresLabel(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDuration(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60000));
  if (min < 60) return `${min} min${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* ── Read-only view renderer ──────────────────────────────────────────────
 * Every app tab renders a read-only view fed ONLY by the owner's snapshot.
 * Tabs whose section the owner hasn't shared fall back to an honest
 * "not shared" empty state (they never show fabricated/empty data as if it
 * were real).
 */
function renderView(
  tabId: string,
  s: StationSnapshot,
  fmt: (n: number | undefined | null) => string,
): React.ReactElement {
  switch (tabId) {
    case "dashboard":
      return dashboardView(s, fmt);
    case "sales":
      return tableCard(
        "Recent Sales",
        ["Invoice", "Date", "Fuel", "Litres", "Total", "Payment"],
        s.recentSales.map((x) => [
          x.invoice || "—",
          x.date || "—",
          x.fuel || "—",
          litresLabel(x.litres),
          fmt(x.total),
          x.payment || "—",
        ]),
      );
    case "pos":
      return tableCard(
        "Point of Sale — Recent Transactions",
        ["Invoice", "Date", "Fuel", "Litres", "Total"],
        s.recentSales.map((x) => [
          x.invoice || "—",
          x.date || "—",
          x.fuel || "—",
          litresLabel(x.litres),
          fmt(x.total),
        ]),
      );
    case "inventory":
      return (
        <div className="space-y-4">
          {card(
            "Pump Status",
            s.pumps.length === 0 ? (
              <Empty text="No pump data published." />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {s.pumps.map((p, i) => (
                  <div
                    key={i}
                    className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center"
                  >
                    <p className="text-xs text-gray-500">{p.fuel}</p>
                    <p className="text-xl font-bold dark:text-white">
                      {p.count}
                    </p>
                    <p className="text-[10px] text-gray-400">pumps</p>
                  </div>
                ))}
              </div>
            ),
          )}
          {card(
            "Tank Levels",
            s.tankLevels.length === 0 ? (
              <Empty text="No tank data published." />
            ) : (
              <table className="w-full min-w-[480px]">
                <thead>
                  <tr className="text-left">
                    {[
                      "Fuel",
                      "Opening (L)",
                      "Closing (L)",
                      "Remaining (L)",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-[10px] uppercase tracking-wide text-gray-400 font-semibold"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.tankLevels.map((t, i) => (
                    <tr
                      key={i}
                      className="border-t border-gray-100 dark:border-gray-800"
                    >
                      <td className="px-3 py-2 text-xs dark:text-white">
                        {t.fuel}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {(t.opening || 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {(t.closing || 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs dark:text-white">
                        {(t.closing || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          )}
        </div>
      );
    case "delivery":
      return tableCard(
        "Fuel Deliveries",
        [
          "Date",
          "Registration",
          "Fuel",
          "Litres",
          "Amount",
          "Customer",
          "Debt",
        ],
        (s.deliveries ?? []).map((d) => [
          d.date || "—",
          d.reg || "—",
          d.fuel || "—",
          litresLabel(d.litres),
          fmt(d.amount),
          d.name || "—",
          fmt(d.debt),
        ]),
      );
    case "offloading":
      return tableCard(
        "Fuel Offloading Records",
        ["Truck", "Fuel", "Litres", "Date"],
        (s.offloading ?? []).map((o) => [
          o.truck || "—",
          o.fuel || "—",
          litresLabel(o.litres),
          o.date || "—",
        ]),
      );
    case "invoice":
      return tableCard(
        "Invoices",
        ["Invoice #", "Customer", "Total", "Date", "Status"],
        s.invoices.map((i) => [
          i.number || "—",
          i.customer || "—",
          fmt(i.total),
          i.date || "—",
          i.status || "—",
        ]),
      );
    case "credit":
      return tableCard(
        "Credit Accounts",
        ["Customer", "Balance", "Limit", "Status"],
        s.creditAccounts.map((c) => [
          c.name,
          fmt(c.balance),
          fmt(c.limit),
          c.status || "—",
        ]),
      );
    case "customers":
      return tableCard(
        "Customers",
        ["Name", "Phone", "Email"],
        (s.customers ?? []).map((c) => [
          c.name,
          c.phone || "—",
          c.email || "—",
        ]),
      );
    case "mpesa":
    case "livetransaction":
      return tableCard(
        "Payment Transactions",
        ["Reference", "Amount", "Status", "Source", "Date"],
        (s.payments ?? []).map((p) => [
          p.ref || "—",
          fmt(p.amount),
          p.status || "—",
          p.origin || "—",
          p.date || "—",
        ]),
      );
    case "expenses":
      return tableCard(
        "Recent Expenses",
        ["Category", "Amount", "Date"],
        s.expenses.map((e) => [e.category, fmt(e.amount), e.date || "—"]),
      );
    case "suppliers":
      return tableCard(
        "Suppliers & Purchases",
        ["Type", "Name", "Amount", "Status", "Date"],
        (s.purchases ?? []).map((p) => [
          p.type === "supplier" ? "Supplier" : "Purchase Order",
          p.name || "—",
          fmt(p.amount),
          p.status || "—",
          p.date || "—",
        ]),
      );
    case "maintenance":
      return tableCard(
        "Maintenance Records",
        ["Title", "Equipment", "Cost", "Status", "Date"],
        (s.maintenance ?? []).map((m) => [
          m.title || "—",
          m.equipment || "—",
          fmt(m.cost),
          m.status || "—",
          m.date || "—",
        ]),
      );
    case "communication":
      return tableCard(
        "Contacts",
        ["Name", "Phone", "Email", "Tags"],
        (s.contacts ?? []).map((c) => [
          c.name || "—",
          c.phone || "—",
          c.email || "—",
          c.tags || "",
        ]),
      );
    case "quality":
      return tableCard(
        "Fuel Quality Tests",
        ["Fuel", "Test", "Result", "Status", "Date"],
        (s.quality ?? []).map((q) => [
          q.fuel || "—",
          q.testType || "—",
          q.result || "—",
          q.status || "—",
          q.date || "—",
        ]),
      );
    case "shifts":
      return tableCard(
        "Shift Employees",
        ["Name", "Role", "Phone", "Status"],
        (s.shifts ?? []).map((e) => [
          e.name || "—",
          e.role || "—",
          e.phone || "—",
          e.active === false ? "Inactive" : "Active",
        ]),
      );
    case "team":
      return tableCard(
        "Team Members",
        ["Name", "Role", "Status"],
        s.employees.map((e) => [e.name, e.role, e.status || "—"]),
      );
    case "fueltypes":
      return fuelPricesView(s, fmt);
    case "reports":
    case "analytics":
    case "fuelsalesreport":
    case "data":
      return analyticsView(s, fmt);
    case "news":
      return (
        <div className="space-y-4">
          {card(
            "Live TV & Radio",
            <p className="text-xs text-gray-500 leading-relaxed">
              {s.stationName} keeps its members updated through the News hub
              (live channels, TV and radio) on the main site. The owner controls
              what this station shares with its team.
            </p>,
          )}
          {card(
            "Station Snapshot",
            <p className="text-xs text-gray-500 leading-relaxed">
              This read-only portal lists the sections the owner granted you.
              The shared snapshot was last refreshed{" "}
              {new Date(s.updatedAt).toLocaleString()}.
            </p>,
          )}
        </div>
      );
    case "price-finder":
      return card(
        "Fuel Prices",
        s.fuelPrices.length === 0 ? (
          <Empty text="No fuel prices published." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {s.fuelPrices.map((p, i) => (
              <div
                key={i}
                className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-center"
              >
                <p className="text-xs text-gray-500">{p.label}</p>
                <p className="text-xl font-bold dark:text-white">
                  {fmt(p.price)}
                </p>
                <p className="text-[10px] text-gray-400">per litre</p>
              </div>
            ))}
          </div>
        ),
      );
    default:
      return <Empty text="This section wasn't shared by the station owner." />;
  }
}

function dashboardView(
  s: StationSnapshot,
  fmt: (n: number | undefined | null) => string,
) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Revenue"
          value={fmt(s.salesKpis.totalRevenue)}
          icon={DollarSign}
          color="green"
        />
        <StatCard
          label="Fuel Sold (L)"
          value={(s.salesKpis.totalFuelSold || 0).toLocaleString()}
          icon={Fuel}
          color="blue"
        />
        <StatCard
          label="Transactions"
          value={String(s.salesKpis.transactionCount || 0)}
          icon={ShoppingBag}
          color="indigo"
        />
        <StatCard
          label="Fuel Types"
          value={String((s.fuelPrices || []).length)}
          icon={Gauge}
          color="purple"
        />
      </div>
      {fuelPricesView(s, fmt)}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Balance Due"
          value={fmt(s.reportKpis?.totalDebt)}
          icon={CreditCard}
          color="purple"
        />
        <StatCard
          label="Expenses"
          value={fmt(s.reportKpis?.totalExpenses)}
          icon={DollarSign}
          color="blue"
        />
        <StatCard
          label="Credit Outstanding"
          value={fmt(s.reportKpis?.totalCreditOutstanding)}
          icon={Wallet}
          color="green"
        />
        <StatCard
          label="Team Members"
          value={String(s.reportKpis?.totalTeamMembers || 0)}
          icon={Users}
          color="indigo"
        />
      </div>
    </div>
  );
}

function fuelPricesView(
  s: StationSnapshot,
  fmt: (n: number | undefined | null) => string,
) {
  return card(
    "Current Pump Prices",
    (s.fuelPrices || []).length === 0 ? (
      <Empty text="No fuel prices published." />
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(s.fuelPrices || []).map((f, i) => (
          <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <p className="text-xs text-gray-500">{f.label}</p>
            <p className="text-lg font-bold dark:text-white">{fmt(f.price)}</p>
            {f.code && <p className="text-[10px] text-gray-400">{f.code}/L</p>}
          </div>
        ))}
      </div>
    ),
  );
}

function analyticsView(
  s: StationSnapshot,
  fmt: (n: number | undefined | null) => string,
) {
  const k = s.reportKpis || {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Deliveries"
          value={String(k.totalDeliveries ?? 0)}
          icon={Truck}
          color="blue"
        />
        <StatCard
          label="Offloading"
          value={String(k.totalOffloading ?? 0)}
          icon={Fuel}
          color="purple"
        />
        <StatCard
          label="Payables"
          value={fmt(k.totalPayables)}
          icon={Wallet}
          color="green"
        />
        <StatCard
          label="Active Shifts"
          value={String(k.totalActiveShifts ?? 0)}
          icon={Calendar}
          color="indigo"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Balance Due"
          value={fmt(k.totalDebt)}
          icon={CreditCard}
          color="purple"
        />
        <StatCard
          label="Total Expenses"
          value={fmt(k.totalExpenses)}
          icon={DollarSign}
          color="blue"
        />
        <StatCard
          label="Credit Outstanding"
          value={fmt(k.totalCreditOutstanding)}
          icon={Wallet}
          color="green"
        />
        <StatCard
          label="Transactions"
          value={String(s.salesKpis.transactionCount || 0)}
          icon={Receipt}
          color="indigo"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total Revenue"
          value={fmt(s.salesKpis.totalRevenue)}
          icon={TrendingUp}
          color="green"
        />
        <StatCard
          label="Fuel Sold (L)"
          value={(s.salesKpis.totalFuelSold || 0).toLocaleString()}
          icon={Fuel}
          color="blue"
        />
      </div>
    </div>
  );
}

/* ── Small presentational helpers ───────────────────────────────────────── */
function card(title: string, children: React.ReactNode) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold dark:text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function tableCard(
  title: string,
  headers: string[],
  rows: (string | number)[][],
) {
  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold dark:text-white">{title}</h3>
        </div>
        <div className="p-4">
          <Empty text="No data published for this section yet." />
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold dark:text-white">{title}</h3>
      </div>
      <div className="overflow-x-auto p-0">
        <table className="w-full min-w-[480px]">
          <thead>
            <tr className="text-left">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-[10px] uppercase tracking-wide text-gray-400 font-semibold"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className="border-t border-gray-100 dark:border-gray-800"
              >
                {r.map((c, j) => (
                  <td
                    key={j}
                    className={`px-3 py-2 text-xs ${j === 0 ? "dark:text-white" : "text-gray-500"}`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: "green" | "blue" | "indigo" | "purple";
}) {
  const colorMap = {
    green: "bg-green-500/10 text-green-600",
    blue: "bg-blue-500/10 text-blue-600",
    indigo: "bg-indigo-500/10 text-indigo-600",
    purple: "bg-purple-500/10 text-purple-600",
  };
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl p-4 border border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorMap[color]}`}
        >
          <Icon size={16} />
        </div>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="text-xl font-bold dark:text-white">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-gray-400 text-center py-6">{text}</p>;
}
