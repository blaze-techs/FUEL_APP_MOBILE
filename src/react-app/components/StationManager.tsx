/**
 * StationManager — fully restructured (2026-08-23).
 *
 * A modular, advanced multi-station command center. Replaces the previous
 * 3400-line monolith with a clean 6-sub-tab architecture:
 *
 *   1. Overview   — KPI dashboard, quick actions, recent activity, sync status
 *   2. Stations   — owned stations grid (search/filter/sort/favorites/bulk/clone/QR)
 *   3. Network    — shared-with-me + pending invites + invite-by-link + members-of-your-stations
 *   4. Analytics  — comparison table + revenue trend chart + health + CSV/JSON export
 *   5. Activity   — unified cross-station activity feed (filter by station/action/actor)
 *   6. Settings   — default station, sort prefs, data export/import, danger zone
 *
 * New features vs the previous version:
 *   • Overview Dashboard sub-tab (quick actions + recent activity + sync card)
 *   • Favorites (star) stations with a favorites-only filter
 *   • Set Default station (persists to localStorage)
 *   • Station clone/duplicate
 *   • QR code station transfer (generate + download PNG via the `qrcode` package)
 *   • CSV export (in addition to JSON) for stations + analytics + activity
 *   • Real-time membership subscription (live invite/member updates)
 *   • Members management for owned stations (view/revoke/role-change)
 *   • Unified cross-station Activity Log with filters
 *   • Station health monitoring with actionable recommendations
 *   • Combined multi-station revenue trend bar chart (canvas)
 *   • Settings sub-tab with preferences + data export/import + danger zone
 *
 * All station data continues to flow through StationContext (useStations) and
 * station-share-service (Supabase station_members). Backward compatible with
 * the existing Home.tsx render contract: `<StationManager onClose={...} />`.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useAuth } from "@/react-app/context/AuthContext";
import {
  formatMoney,
  stationTotalRevenue,
  stationRevenueSince,
  stationSalesCount,
  stationStatus,
  relativeTime,
  initialsOf,
  avatarColor,
  downloadJson,
  startOfToday,
  startOfMonth,
} from "@/react-app/lib/station-stats";
import { getDetectedCountryCode } from "@/react-app/lib/currency";
import { getVATRate } from "@/react-app/config/pricing";
import {
  getSharedStations,
  getPendingInvites,
  getStationActivity,
  getFavorites,
  toggleFavorite,
  acceptInvite,
  revokeMember,
  declineInvite,
  leaveStation,
  getStationMembers,
  inviteMember,
  transferOwnership,
  subscribeToMyMemberships,
  recordStationActivity,
  type StationMember,
  type StationActivityEntry,
} from "@/react-app/lib/station-share-service";
import QRCode from "qrcode";
import {
  Plus,
  X,
  Check,
  ArrowLeft,
  MapPin,
  Layers,
  Share2,
  Copy,
  RefreshCw,
  LogIn,
  Search,
  Cloud,
  TrendingUp,
  Calendar,
  Download,
  Building2,
  LogOut,
  BarChart3,
  Activity,
  Gauge,
  CheckCircle2,
  Star,
  Crown,
  Settings as SettingsIcon,
  Zap,
  QrCode,
  Trash2,
  Edit3,
  Users,
  Send,
  Filter,
  ArrowUpDown,
  Wifi,
  WifiOff,
  FileDown,
  Database,
  AlertTriangle,
  MoreHorizontal,
  UserPlus,
  Shield,
  KeyRound,
  ArrowRightLeft,
  Mail,
  ExternalLink,
  Eye,
} from "lucide-react";
import {
  getAccessCodes,
  type StationAccessCode,
} from "@/react-app/lib/station-access-code-service";

// ============================================================
// Constants & helpers (module scope)
// ============================================================

const GLASS_CARD =
  "bg-gray-50 dark:bg-white/5 backdrop-blur-sm border border-gray-200 dark:border-gray-200 dark:border-white/10 rounded-xl";

const DEFAULT_STATION_KEY = "fuelpro_default_station";
const STATION_SORT_PREF_KEY = "fuelpro_station_sort";
const SUBTAB_KEY = "fuelpro_stationmgr_subtab";

/** Deep-link from Station Manager into a main-app tab (e.g. Team Manager).
 * Closes the Station Manager modal first, then dispatches the changeTab event
 * so Home.tsx switches the active tab. */
function goToMainTab(tabId: string, onClose?: () => void): void {
  if (onClose) onClose();
  // defer so the modal unmounts before the tab switch renders
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent("changeTab", { detail: tabId }));
  }, 60);
}

function getDefaultTaxRate(): number {
  try {
    const cc = getDetectedCountryCode();
    return Math.round((getVATRate(cc) || 0) * 100);
  } catch {
    return 0;
  }
}

function getPhonePlaceholder(): string {
  return "Enter phone number";
}

/** CSV export with RFC 4180 escaping. */
function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    invite_sent: "sent an invite",
    invite_accepted: "accepted an invite",
    invite_revoked: "revoked an invite",
    invite_declined: "declined an invite",
    member_left: "left the station",
    role_changed: "changed a member role",
    access_recorded: "accessed the station",
    ownership_transferred: "transferred ownership",
    favorite_toggled: "toggled favorite",
  };
  return map[action] || action.replace(/_/g, " ");
}

// ============================================================
// Sub-tab definition
// ============================================================

type SubTab =
  | "overview"
  | "stations"
  | "access"
  | "network"
  | "analytics"
  | "activity"
  | "settings";

type FilterStatus = "all" | "active" | "inactive" | "maintenance" | "favorites";
type SortBy = "recent" | "name" | "revenue" | "oldest";

interface StationManagerProps {
  onClose?: () => void;
}

const EMPTY_FORM = {
  name: "",
  location: "",
  phone: "",
  email: "",
  kraPin: "",
  etrSerial: "",
  taxRate: getDefaultTaxRate(),
  theme: "dark",
  description: "",
};

// ============================================================
// Module-scope presentational subcomponents
// ============================================================

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  label: string;
  value: string;
  icon: any;
  accent: string;
  sub?: string;
}) {
  return (
    <div className={`${GLASS_CARD} p-4`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <Icon size={16} className={accent} />
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-emerald-500/20 text-emerald-400",
    inactive: "bg-gray-500/20 text-gray-400",
    maintenance: "bg-amber-500/20 text-amber-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
        colors[status] || "bg-gray-500/20 text-gray-400"
      }`}
    >
      {status}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    owner: "bg-amber-500/20 text-amber-400",
    manager: "bg-sky-500/20 text-sky-400",
    staff: "bg-emerald-500/20 text-emerald-400",
    auditor: "bg-purple-500/20 text-purple-400",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
        colors[role] || "bg-gray-500/20 text-gray-400"
      }`}
    >
      {role}
    </span>
  );
}

function SkeletonCard() {
  return (
    <div className={`${GLASS_CARD} p-5 animate-pulse`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-xl bg-gray-300 dark:bg-white/10" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-300 dark:bg-white/10 rounded w-2/3" />
          <div className="h-3 bg-gray-300 dark:bg-white/10 rounded w-1/3" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-8 bg-gray-300 dark:bg-white/10 rounded" />
        <div className="h-8 bg-gray-300 dark:bg-white/10 rounded" />
        <div className="h-8 bg-gray-300 dark:bg-white/10 rounded" />
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={`${GLASS_CARD} p-12 text-center`}>
      <Building2 size={48} className="text-gray-600 mx-auto mb-4" />
      <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
        No stations yet
      </h3>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
        Create your first station to start managing fuel sales, inventory, and
        reports.
      </p>
      <button
        onClick={onCreate}
        className="px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded-xl transition-all flex items-center gap-2 mx-auto"
      >
        <Plus size={18} />
        Create Station
      </button>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
  action,
}: {
  icon: any;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <Icon size={18} className="text-amber-400" />
        {title}
        {count !== undefined && (
          <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">
            · {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

// ============================================================
// Station Card
// ============================================================

function StationCard({
  station,
  isCurrent,
  isFavorite,
  isDefault,
  onOpen,
  onEdit,
  onShare,
  onExport,
  onDelete,
  onToggleStatus,
  onClone,
  onQR,
  onToggleFavorite,
  onSetDefault,
  onTransfer,
}: {
  station: any;
  isCurrent: boolean;
  isFavorite: boolean;
  isDefault: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onShare: () => void;
  onExport: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  onClone: () => void;
  onQR: () => void;
  onToggleFavorite: () => void;
  onSetDefault: () => void;
  onTransfer: () => void;
}) {
  const data = station.data || {};
  const totalRev = stationTotalRevenue(data);
  const todayRev = stationRevenueSince(data, startOfToday());
  const monthRev = stationRevenueSince(data, startOfMonth());
  const salesCount = stationSalesCount(data);
  const status = stationStatus(data);
  const updated = relativeTime(station.updatedAt);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`${GLASS_CARD} p-5 hover:bg-gray-100 dark:hover:bg-white/10 transition-all group relative ${
        isCurrent ? "ring-2 ring-amber-400/50" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-xl ${avatarColor(
              station.name,
            )} flex items-center justify-center text-white font-bold text-sm`}
          >
            {initialsOf(station.name)}
          </div>
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white text-sm flex items-center gap-1.5">
              {station.name}
              {isCurrent && (
                <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] rounded">
                  Active
                </span>
              )}
              {isDefault && (
                <Crown
                  size={12}
                  className="text-amber-400"
                  aria-label="Default station"
                />
              )}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {updated}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onToggleFavorite}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            className="w-7 h-7 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <Star
              size={14}
              className={
                isFavorite ? "text-amber-400 fill-amber-400" : "text-gray-400"
              }
            />
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-7 h-7 rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
            >
              <MoreHorizontal size={14} className="text-gray-400" />
            </button>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-8 z-20 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-lg shadow-xl py-1">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onClone();
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center gap-2"
                  >
                    <Copy size={12} /> Clone Station
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onQR();
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center gap-2"
                  >
                    <QrCode size={12} /> QR Code
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onSetDefault();
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center gap-2"
                  >
                    <Crown size={12} /> Set as Default
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onTransfer();
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center gap-2"
                  >
                    <ArrowRightLeft size={12} /> Transfer Ownership
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleStatus();
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 flex items-center gap-2"
                  >
                    <Zap size={12} /> Toggle Status
                  </button>
                  <div className="border-t border-gray-200 dark:border-white/10 my-1" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Location */}
      {station.location && (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
          <MapPin size={12} />
          <span className="truncate">{station.location}</span>
        </div>
      )}

      {/* Revenue grid */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">Today</p>
          <p className="text-sm font-semibold text-emerald-400">
            {formatMoney(todayRev)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">Month</p>
          <p className="text-sm font-semibold text-sky-400">
            {formatMoney(monthRev)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-gray-500 dark:text-gray-400">Total</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {formatMoney(totalRev)}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-3">
        <span>{salesCount} sales</span>
        <StatusBadge status={status} />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onOpen}
          className="flex-1 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
        >
          <LogIn size={13} /> Open
        </button>
        <button
          onClick={onEdit}
          title="Edit"
          className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg transition-colors"
        >
          <Edit3 size={13} />
        </button>
        <button
          onClick={onShare}
          title="Share"
          className="px-3 py-2 bg-sky-500/20 hover:bg-sky-500/30 text-sky-400 rounded-lg transition-colors"
        >
          <Share2 size={13} />
        </button>
        <button
          onClick={onExport}
          title="Export"
          className="px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors"
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Station Form Modal (create / edit)
// ============================================================

function StationFormModal({
  title,
  submitLabel,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial: any;
  onSubmit: (data: any) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = () => {
    if (!form.name?.trim()) {
      setError("Station name is required");
      return;
    }
    setBusy(true);
    onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`${GLASS_CARD} w-full max-w-md p-6 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              Station Name *
            </label>
            <input
              type="text"
              value={form.name || ""}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g., Downtown Branch"
              className="w-full px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              Location
            </label>
            <input
              type="text"
              value={form.location || ""}
              onChange={(e) =>
                setForm((p) => ({ ...p, location: e.target.value }))
              }
              placeholder="e.g., Downtown, Nairobi"
              className="w-full px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                Phone
              </label>
              <input
                type="tel"
                value={form.phone || ""}
                onChange={(e) =>
                  setForm((p) => ({ ...p, phone: e.target.value }))
                }
                placeholder={getPhonePlaceholder()}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                Tax Rate (%)
              </label>
              <input
                type="number"
                value={form.taxRate ?? getDefaultTaxRate()}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    taxRate: parseFloat(e.target.value) || 0,
                  }))
                }
                className="w-full px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              Email / Manager
            </label>
            <input
              type="email"
              value={form.email || ""}
              onChange={(e) =>
                setForm((p) => ({ ...p, email: e.target.value }))
              }
              placeholder="manager@station.com"
              className="w-full px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              Description
            </label>
            <textarea
              value={form.description || ""}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="Optional notes about this station"
              rows={2}
              className="w-full px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSubmit}
            disabled={busy}
            className="flex-1 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
          >
            {busy ? "Saving..." : submitLabel}
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-xl transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Share Modal — invite members to a station
// ============================================================

function ShareModal({
  station,
  onInvite,
  onBulkInvite,
  onRevoke,
  onClose,
  openTeamManager: openTeamManagerProp,
}: {
  station: any;
  onInvite: (email: string, role: string, name?: string) => Promise<void>;
  onBulkInvite?: (emails: string[], role: string) => Promise<void>;
  onRevoke: (memberId: string) => Promise<void>;
  onClose: () => void;
  openTeamManager?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<StationMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkEmails, setBulkEmails] = useState("");

  const loadMembers = useCallback(async () => {
    if (!station?.id) return;
    setLoadingMembers(true);
    try {
      const m = await getStationMembers(station.id);
      setMembers(m);
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [station?.id]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleInvite = async () => {
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onInvite(email.trim(), role, name.trim() || undefined);
      setEmail("");
      setName("");
      await loadMembers();
    } catch (e: any) {
      setError(e?.message || "Failed to send invite");
    } finally {
      setBusy(false);
    }
  };

  const handleBulkInviteSubmit = async () => {
    if (!onBulkInvite) return;
    const emails = bulkEmails
      .split(/[\s,;]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0 && e.includes("@"));
    if (emails.length === 0) {
      setError(
        "Enter at least one valid email (comma, space, or newline separated)",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onBulkInvite(emails, role);
      setBulkEmails("");
      await loadMembers();
    } catch (e: any) {
      setError(e?.message || "Bulk invite failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`${GLASS_CARD} w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Share Station
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {station?.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Invite form */}
        <div className={`${GLASS_CARD} p-4 mb-4`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Send size={14} className="text-sky-400" />
              {bulkMode ? "Bulk Invite Members" : "Invite a Member"}
            </h3>
            {onBulkInvite && (
              <button
                onClick={() => {
                  setBulkMode(!bulkMode);
                  setError("");
                }}
                className="text-xs text-sky-500 hover:text-sky-400 flex items-center gap-1"
              >
                <UserPlus size={12} />
                {bulkMode ? "Single invite" : "Bulk invite"}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {bulkMode ? (
              <textarea
                value={bulkEmails}
                onChange={(e) => setBulkEmails(e.target.value)}
                placeholder={
                  "Enter emails separated by commas, spaces, or new lines:\nmember1@email.com, member2@email.com\nmember3@email.com"
                }
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-400 text-sm resize-y"
              />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="member@email.com"
                  className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-400 text-sm"
                />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name (optional)"
                  className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-400 text-sm"
                />
              </div>
            )}
            <div className="flex gap-3">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
                <option value="auditor">Auditor</option>
              </select>
              <button
                onClick={bulkMode ? handleBulkInviteSubmit : handleInvite}
                disabled={busy}
                className="flex-1 px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
              >
                <Send size={14} />
                {busy
                  ? "Sending..."
                  : bulkMode
                    ? "Send Bulk Invites"
                    : "Send Invite"}
              </button>
            </div>
          </div>
        </div>

        {/* Members list */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <Users size={14} className="text-emerald-400" />
            Current Members ({members.length})
          </h3>
          {loadingMembers ? (
            <p className="text-xs text-gray-500">Loading members...</p>
          ) : members.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No members yet. Invite someone above.
            </p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-2 bg-gray-100 dark:bg-white/5 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                        {m.name || m.invited_email || "Unknown"}
                      </p>
                      <p className="text-[10px] text-gray-500 truncate">
                        {m.invited_email || m.member_email || ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <RoleBadge role={m.role} />
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        m.status === "accepted" || m.status === "active"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : m.status === "pending"
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-gray-500/20 text-gray-400"
                      }`}
                    >
                      {m.status}
                    </span>
                    <button
                      onClick={() => onRevoke(m.id)}
                      title="Revoke"
                      className="w-6 h-6 rounded text-red-400 hover:bg-red-500/10 flex items-center justify-center"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-6 gap-3 flex-wrap">
          <button
            onClick={() => openTeamManagerProp?.()}
            className="px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 dark:text-indigo-400 rounded-xl text-xs font-medium flex items-center gap-1.5"
          >
            <ExternalLink size={13} />
            Open Team Manager
          </button>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-xl text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// QR Code Modal — generate a transfer QR for a station
// ============================================================

function QRModal({ station, onClose }: { station: any; onClose: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const payload = JSON.stringify({
      type: "fuelpro_station",
      stationId: station.id,
      name: station.name,
      location: station.location || "",
      phone: station.phone || "",
      email: station.email || "",
    });
    QRCode.toDataURL(payload, { width: 240, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [station]);

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `station_${station.name.replace(/\s+/g, "_")}_qr.png`;
    link.click();
  };

  const handleCopy = () => {
    navigator.clipboard
      .writeText(station.id)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`${GLASS_CARD} w-full max-w-sm p-6 text-center`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            Station QR Code
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {station.name}
        </p>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="Station QR code"
            className="mx-auto rounded-lg bg-white p-2 mb-4"
          />
        ) : (
          <div className="w-60 h-60 mx-auto bg-gray-200 dark:bg-white/10 rounded-lg mb-4 animate-pulse" />
        )}
        <div className="space-y-2">
          <button
            onClick={handleDownload}
            className="w-full px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
          >
            <Download size={14} /> Download PNG
          </button>
          <button
            onClick={handleCopy}
            className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-lg text-sm flex items-center justify-center gap-2 fp-icon-only"
            title="Confirm"
            aria-label="Confirm"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy Station ID"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Confirm Dialog
// ============================================================

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`${GLASS_CARD} w-full max-w-sm p-6`}>
        <div className="flex items-center gap-3 mb-4">
          {danger ? (
            <AlertTriangle size={20} className="text-red-400" />
          ) : (
            <CheckCircle2 size={20} className="text-sky-400" />
          )}
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            {title}
          </h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {message}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2 ${
              danger
                ? "bg-red-500 hover:bg-red-600"
                : "bg-emerald-500 hover:bg-emerald-600"
            } text-white font-semibold rounded-xl text-sm transition-colors`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-xl text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SharedStationInfo (internal type for Network tab)
// ============================================================

interface SharedStationInfo {
  stationId: string;
  stationName: string;
  role: string;
  invitedBy: string;
  status: string;
  member: StationMember | null;
  lastAccessedAt: string | null;
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function StationManager({ onClose }: StationManagerProps) {
  const {
    stations,
    currentStation,
    createStation,
    updateStation,
    deleteStation,
    switchStation,
    isAdmin,
    isStationLoading,
    isBackendSyncing,
    lastBackendSync,
    syncToBackend,
    syncFromBackend,
  } = useStations();

  const { user, bindings } = useAuth();

  // UI state
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortBy, setSortBy] = useState<SortBy>(
    () => (localStorage.getItem(STATION_SORT_PREF_KEY) as SortBy) || "recent",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<SubTab>(
    () => (localStorage.getItem(SUBTAB_KEY) as SubTab) || "overview",
  );
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedStationIds, setSelectedStationIds] = useState<Set<string>>(
    new Set(),
  );
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [defaultStationId, setDefaultStationId] = useState<string | null>(() =>
    localStorage.getItem(DEFAULT_STATION_KEY),
  );
  const [networkRefreshKey, setNetworkRefreshKey] = useState(0);

  // Modal state
  const [modal, setModal] = useState<{
    type: "create" | "edit" | "share" | "qr" | "delete" | "clone" | "transfer";
    station?: any;
  } | null>(null);

  // Form state
  const [editForm, setEditForm] = useState<any>(EMPTY_FORM);

  // Network data
  const [sharedStations, setSharedStations] = useState<SharedStationInfo[]>([]);
  const [pendingInvites, setPendingInvites] = useState<SharedStationInfo[]>([]);
  const [inviteLinkInput, setInviteLinkInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  // Access dashboard data (two-way: members of MY stations + access codes)
  const [accessMembers, setAccessMembers] = useState<StationMember[]>([]);
  const [accessCodes, setAccessCodes] = useState<StationAccessCode[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessStationId, setAccessStationId] = useState<string>(
    () => currentStation?.id || "",
  );

  // Activity log
  const [activityEntries, setActivityEntries] = useState<
    StationActivityEntry[]
  >([]);
  const [activityFilterStation, setActivityFilterStation] =
    useState<string>("all");
  const [activityFilterAction, setActivityFilterAction] =
    useState<string>("all");

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  }, []);

  // Persist sub-tab + sort pref
  useEffect(() => {
    localStorage.setItem(SUBTAB_KEY, activeSubTab);
  }, [activeSubTab]);
  useEffect(() => {
    localStorage.setItem(STATION_SORT_PREF_KEY, sortBy);
  }, [sortBy]);

  // Load favorites
  useEffect(() => {
    if (user?.id) {
      getFavorites()
        .then((ids) => setFavorites(new Set(ids)))
        .catch(() => {});
    }
  }, [user?.id]);

  // ---- Network: shared + pending invites ----
  const loadSharedAndPending = useCallback(async () => {
    if (!user?.id) return;
    try {
      const members = await getSharedStations();
      const fromBindings: SharedStationInfo[] = bindings
        .filter((b) => b.active)
        .map((b) => ({
          stationId: b.stationId,
          stationName: b.stationName,
          role: b.role,
          invitedBy: b.invitedBy,
          status: "accepted",
          member: members.find((m) => m.station_id === b.stationId) || null,
          lastAccessedAt:
            members.find((m) => m.station_id === b.stationId)
              ?.last_accessed_at || null,
        }));
      const fromMembers: SharedStationInfo[] = members
        .filter((m) => !fromBindings.some((b) => b.stationId === m.station_id))
        .map((m) => ({
          stationId: m.station_id,
          stationName: m.name || "Shared Station",
          role: m.role,
          invitedBy: m.invited_by_name || m.invited_by_unique_id || "Owner",
          status: m.status,
          member: m,
          lastAccessedAt: m.last_accessed_at || null,
        }));
      const seen = new Set<string>();
      const shared = [...fromBindings, ...fromMembers].filter((s) => {
        if (seen.has(s.stationId)) return false;
        seen.add(s.stationId);
        return true;
      });
      setSharedStations(shared);

      const pendingRows = await getPendingInvites();
      const pending: SharedStationInfo[] = pendingRows.map((row) => ({
        stationId: row.station_id,
        stationName:
          (row as any).stations?.name || row.name || "Shared Station",
        role: row.role || "staff",
        invitedBy: row.invited_by_name || row.invited_by_unique_id || "Owner",
        status: "pending",
        member: row,
        lastAccessedAt: row.last_accessed_at || null,
      }));
      setPendingInvites(pending);
    } catch (err) {
      console.warn("[StationManager] Failed to load shared/pending:", err);
    }
  }, [user?.id, bindings]); // user?.email intentionally excluded (not read in body)

  useEffect(() => {
    if (activeSubTab === "network" || pendingInvites.length > 0) {
      loadSharedAndPending();
    }
  }, [
    activeSubTab,
    networkRefreshKey,
    loadSharedAndPending,
    pendingInvites.length,
  ]);

  // Real-time: subscribe to membership changes so invites appear instantly
  useEffect(() => {
    if (!user?.id) return;
    const unsub = subscribeToMyMemberships(user.id, () => {
      setNetworkRefreshKey((k) => k + 1);
    });
    return unsub;
  }, [user?.id]);

  // ---- Access dashboard: load members + access codes for the selected station ----
  const loadAccessData = useCallback(async () => {
    const sid = accessStationId || currentStation?.id;
    if (!sid) return;
    setAccessLoading(true);
    try {
      const [members, codes] = await Promise.all([
        getStationMembers(sid).catch(() => [] as StationMember[]),
        getAccessCodes(sid).catch(() => [] as StationAccessCode[]),
      ]);
      setAccessMembers(members);
      setAccessCodes(codes);
    } catch (err) {
      console.warn("[StationManager] access load failed:", err);
    } finally {
      setAccessLoading(false);
    }
  }, [accessStationId, currentStation?.id]);

  useEffect(() => {
    if (activeSubTab === "access") {
      loadAccessData();
    }
  }, [activeSubTab, accessStationId, loadAccessData, networkRefreshKey]);

  // Keep accessStationId synced when current station changes
  useEffect(() => {
    if (currentStation?.id && !accessStationId) {
      setAccessStationId(currentStation.id);
    }
  }, [currentStation?.id, accessStationId]);

  // ---- Access summary (counts for the sub-tab badge) ----
  const accessSummary = useMemo(() => {
    const accepted = accessMembers.filter(
      (m) => m.status === "accepted" || m.status === "active",
    ).length;
    const pending = accessMembers.filter((m) => m.status === "pending").length;
    const activeCodes = accessCodes.filter((c) => c.enabled).length;
    return {
      totalMembers: accepted,
      pendingInvites: pending,
      totalCodes: accessCodes.length,
      activeCodes,
    };
  }, [accessMembers, accessCodes]);

  // ---- Activity log: load across all owned stations ----
  useEffect(() => {
    if (activeSubTab !== "activity") return;
    const loadAll = async () => {
      const all: StationActivityEntry[] = [];
      for (const s of ownedStations) {
        try {
          const entries = await getStationActivity(s.id);
          all.push(...entries);
        } catch {
          /* skip */
        }
      }
      // Also include shared stations' activity
      for (const sh of sharedStations) {
        try {
          const entries = await getStationActivity(sh.stationId);
          all.push(...entries);
        } catch {
          /* skip */
        }
      }
      all.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      setActivityEntries(all.slice(0, 200));
    };
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, networkRefreshKey]);

  // ---- Computed stats ----
  const stats = useMemo(() => {
    const totalRev = stations.reduce(
      (sum, s) => sum + stationTotalRevenue(s.data || {}),
      0,
    );
    const todayRev = stations.reduce(
      (sum, s) => sum + stationRevenueSince(s.data || {}, startOfToday()),
      0,
    );
    const sharedUsers = new Set(
      stations.flatMap((s) =>
        (s.data?.sharedUsers || []).map((u: any) => u.email),
      ),
    ).size;
    return { totalRevenue: totalRev, todayRevenue: todayRev, sharedUsers };
  }, [stations]);

  // ---- Station health (per-station score + issue list) ----
  const stationHealth = useMemo(() => {
    return stations.map((s) => {
      const data = s.data || {};
      const stationStatus: string = data.status || "active";
      let score = 50;
      const issues: string[] = [];
      if (stationStatus === "active") score += 20;
      else if (stationStatus === "maintenance") {
        score += 5;
        issues.push("Under maintenance");
      } else issues.push("Inactive");
      const hasPrices = (data.fuelPrices || []).length > 0;
      if (hasPrices) score += 15;
      else issues.push("No fuel prices configured");
      const hasPumps =
        (data.pmsPumps?.length || 0) + (data.agoPumps?.length || 0) > 0;
      if (hasPumps) score += 15;
      else issues.push("No pumps configured");
      if (data.companyData?.name) score += 10;
      else issues.push("No company profile");
      if (data.companyData?.contacts) score += 5;
      else issues.push("No contact info");
      if (data.companyData?.kraPin) score += 5;
      else if ((s.country || "").toUpperCase() === "KE")
        issues.push("No KRA PIN");
      score = Math.min(100, score);
      return {
        id: s.id,
        name: s.name,
        score,
        issues,
        status: stationStatus,
        healthLabel:
          score >= 85 ? "Good" : score >= 60 ? "Warning" : "Critical",
      };
    });
  }, [stations]);

  // ---- Owned vs shared split ----
  const ownedStations = useMemo(() => {
    return stations.filter((s) => {
      if (s.ownerId && user?.id && s.ownerId === user.id) return true;
      const binding = bindings.find((b) => b.stationId === s.id);
      if (binding && binding.role === "owner") return true;
      if (!binding && !s.ownerId) return true;
      if (s.ownerId && user?.id && s.ownerId !== user.id) return false;
      if (binding && binding.role !== "owner") return false;
      return true;
    });
  }, [stations, user?.id, bindings]);

  const sharedStationsFromContext = useMemo(() => {
    return stations.filter((s) => !ownedStations.includes(s));
  }, [stations, ownedStations]);

  // ---- Filtered & sorted stations ----
  const visibleStations = useMemo(() => {
    let result = [...ownedStations];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.location?.toLowerCase().includes(q) ||
          s.phone?.includes(q) ||
          s.email?.toLowerCase().includes(q),
      );
    }
    if (filterStatus === "favorites") {
      result = result.filter((s) => favorites.has(s.id));
    } else if (filterStatus !== "all") {
      result = result.filter((s) => stationStatus(s.data) === filterStatus);
    }
    result.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "revenue")
        return (
          stationTotalRevenue(b.data || {}) - stationTotalRevenue(a.data || {})
        );
      if (sortBy === "recent")
        return (
          new Date(b.updatedAt || 0).getTime() -
          new Date(a.updatedAt || 0).getTime()
        );
      return (
        new Date(a.updatedAt || 0).getTime() -
        new Date(b.updatedAt || 0).getTime()
      );
    });
    return result;
  }, [ownedStations, search, filterStatus, sortBy, favorites]);

  // ---- Station analytics ----
  const stationAnalytics = useMemo(() => {
    return ownedStations
      .map((s) => {
        const data = s.data || {};
        const totalRev = stationTotalRevenue(data);
        const todayRev = stationRevenueSince(data, startOfToday());
        const monthRev = stationRevenueSince(data, startOfMonth());
        const sales = stationSalesCount(data);
        const status = stationStatus(data);
        const sharedCount = (data.sharedUsers || []).length;
        let healthScore = 50;
        if (status === "active") healthScore += 20;
        if (status === "maintenance") healthScore += 5;
        if (sales > 0) healthScore += 15;
        if (todayRev > 0) healthScore += 15;
        healthScore = Math.min(100, healthScore);
        const healthLabel =
          healthScore >= 80
            ? "Excellent"
            : healthScore >= 60
              ? "Good"
              : healthScore >= 40
                ? "Fair"
                : "Needs Attention";
        return {
          station: s,
          totalRev,
          todayRev,
          monthRev,
          sales,
          status,
          sharedCount,
          healthScore,
          healthLabel,
        };
      })
      .sort((a, b) => b.totalRev - a.totalRev);
  }, [ownedStations]);

  const topStation = stationAnalytics[0] || null;
  const avgRevenue =
    ownedStations.length > 0 ? stats.totalRevenue / ownedStations.length : 0;
  const totalSales = stationAnalytics.reduce((sum, a) => sum + a.sales, 0);
  const activeCount = stationAnalytics.filter(
    (a) => a.status === "active",
  ).length;
  const avgHealth =
    stationAnalytics.length > 0
      ? Math.round(
          stationAnalytics.reduce((sum, a) => sum + a.healthScore, 0) /
            stationAnalytics.length,
        )
      : 0;

  // ---- Handlers ----
  const openCreate = useCallback(() => setModal({ type: "create" }), []);
  const closeModal = useCallback(() => setModal(null), []);

  const handleOpenStation = useCallback(
    (station: any) => {
      switchStation(station.id);
      showNotice(`Switched to ${station.name}`);
      if (onClose) onClose();
    },
    [switchStation, showNotice, onClose],
  );

  const handleEdit = useCallback((station: any) => {
    setEditForm({
      name: station.name,
      location: station.location || "",
      phone: station.phone || "",
      email: station.email || "",
      kraPin: station.kraPin || "",
      etrSerial: station.etrSerial || "",
      taxRate: station.taxRate ?? getDefaultTaxRate(),
      theme: station.theme || "dark",
      description: station.description || "",
    });
    setModal({ type: "edit", station });
  }, []);

  const handleSaveStation = useCallback(
    (formData: any) => {
      if (modal?.type === "create") {
        const station = createStation(formData);
        showNotice(`Station "${station.name}" created`);
        closeModal();
      } else if (modal?.type === "edit" && modal.station) {
        updateStation(modal.station.id, formData);
        showNotice(`Station "${formData.name}" updated`);
        closeModal();
      } else if (modal?.type === "clone" && modal.station) {
        const cloned = createStation({
          ...formData,
          name: `${formData.name} (Copy)`,
          data: modal.station.data
            ? JSON.parse(JSON.stringify(modal.station.data))
            : {},
        });
        showNotice(`Station cloned as "${cloned.name}"`);
        closeModal();
      }
    },
    [modal, createStation, updateStation, showNotice, closeModal],
  );

  const handleShareOpen = useCallback((station: any) => {
    setModal({ type: "share", station });
  }, []);

  const handleInvite = useCallback(
    async (email: string, role: string, name?: string) => {
      if (!modal?.station || !user?.id) return;
      const result = await inviteMember(modal.station.id, email, role, name, {
        invitedByUserId: user.id,
        invitedByName: user.email || "Owner",
      });
      if (!result.success) throw new Error(result.error);
      showNotice(`Invite sent to ${email}`);
    },
    [modal?.station, user?.id, user?.email, showNotice],
  );

  const handleRevokeMember = useCallback(
    async (memberId: string) => {
      const result = await revokeMember(memberId);
      if (!result.success) {
        showNotice(`Failed to revoke: ${result.error}`);
        return;
      }
      showNotice("Member revoked");
    },
    [showNotice],
  );

  const handleAccessSharedStation = useCallback(
    (stationId: string) => {
      const station = stations.find((s) => s.id === stationId);
      switchStation(stationId);
      if (station?.ownerId && user?.id && station.ownerId !== user.id) {
        recordStationActivity(stationId, {
          actorId: user.id,
          actorName: user.email || "Member",
          action: "access_recorded",
          detail: `Accessed ${station.name}`,
        }).catch(() => {});
      }
      showNotice(
        station
          ? `Switched to ${station.name}${station.ownerId && station.ownerId !== user?.id ? " (shared)" : ""}`
          : "Station accessed",
      );
      if (onClose) onClose();
    },
    [stations, switchStation, showNotice, onClose, user?.id, user?.email],
  );

  const handleLeaveSharedStation = useCallback(
    async (stationId: string, stationName: string) => {
      if (
        !confirm(
          `Leave "${stationName}"? You will no longer have access to this shared station.`,
        )
      )
        return;
      try {
        const members = await getSharedStations();
        const member = members.find((m) => m.station_id === stationId);
        if (member) {
          const result = await leaveStation(member.id);
          if (!result.success) {
            showNotice(`Failed to leave: ${result.error}`);
            return;
          }
        }
        if (currentStation?.id === stationId) {
          const firstOwned = ownedStations[0];
          if (firstOwned) switchStation(firstOwned.id);
        }
        showNotice(`Left "${stationName}"`);
        setNetworkRefreshKey((k) => k + 1);
      } catch (e: any) {
        showNotice(`Failed to leave: ${e?.message || "error"}`);
      }
    },
    [currentStation?.id, ownedStations, switchStation, showNotice],
  );

  const handleAcceptPending = useCallback(
    async (memberId: string, stationName: string) => {
      try {
        const member = pendingInvites.find((p) => p.member?.id === memberId);
        const token = member?.member?.invite_token;
        if (!token) {
          showNotice("Invalid invite");
          return;
        }
        const result = await acceptInvite(token);
        if (!result.success) {
          showNotice(`Failed: ${result.error}`);
          return;
        }
        showNotice(`Accepted invite to ${stationName}`);
        setNetworkRefreshKey((k) => k + 1);
      } catch (e: any) {
        showNotice(`Failed: ${e?.message || "error"}`);
      }
    },
    [pendingInvites, showNotice],
  );

  const handleDeclinePending = useCallback(
    async (memberId: string) => {
      try {
        const result = await declineInvite(memberId);
        if (!result.success) {
          showNotice(`Failed: ${result.error}`);
          return;
        }
        showNotice("Invite declined");
        setNetworkRefreshKey((k) => k + 1);
      } catch (e: any) {
        showNotice(`Failed: ${e?.message || "error"}`);
      }
    },
    [showNotice],
  );

  const handleJoinByLink = useCallback(async () => {
    const input = inviteLinkInput.trim();
    if (!input) {
      setInviteError("Paste an invite link or token");
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    try {
      let token = input;
      const match = input.match(/[?&]invite=([^&]+)/);
      if (match) token = decodeURIComponent(match[1]);
      const result = await acceptInvite(token);
      if (!result.success) {
        setInviteError(result.error || "Invalid or expired invite link");
        return;
      }
      showNotice("Invite accepted! Switching to station...");
      setInviteLinkInput("");
      setNetworkRefreshKey((k) => k + 1);
      if (result.stationId) {
        setTimeout(() => handleAccessSharedStation(result.stationId!), 800);
      }
    } catch (e: any) {
      setInviteError(e?.message || "Invalid or expired invite link");
    } finally {
      setInviteBusy(false);
    }
  }, [inviteLinkInput, showNotice, handleAccessSharedStation]);

  const handleToggleFavorite = useCallback(
    async (stationId: string) => {
      const next = new Set(favorites);
      if (next.has(stationId)) next.delete(stationId);
      else next.add(stationId);
      setFavorites(next);
      try {
        await toggleFavorite(stationId);
      } catch {
        /* offline ok */
      }
    },
    [favorites],
  );

  const handleSetDefault = useCallback(
    (stationId: string) => {
      const station = stations.find((s) => s.id === stationId);
      if (!station) return;
      localStorage.setItem(DEFAULT_STATION_KEY, stationId);
      setDefaultStationId(stationId);
      showNotice(`"${station.name}" set as default station`);
    },
    [stations, showNotice],
  );

  const handleClone = useCallback((station: any) => {
    setEditForm({
      name: station.name,
      location: station.location || "",
      phone: station.phone || "",
      email: station.email || "",
      kraPin: station.kraPin || "",
      etrSerial: station.etrSerial || "",
      taxRate: station.taxRate ?? getDefaultTaxRate(),
      theme: station.theme || "dark",
      description: station.description || "",
    });
    setModal({ type: "clone", station });
  }, []);

  // ---- Transfer Ownership (opens modal — select from existing members) ----
  const handleTransferOwnership = useCallback((station: any) => {
    setModal({ type: "transfer", station });
  }, []);

  // ---- Confirm Transfer Ownership (to an existing member by user_id) ----
  const handleConfirmTransfer = useCallback(
    async (newOwnerId: string, newOwnerName: string) => {
      if (!modal?.station || !user?.id) return;
      if (
        !confirm(
          `Transfer ownership of "${modal.station.name}" to ${newOwnerName}? You will become a manager. This cannot be undone.`,
        )
      )
        return;
      try {
        const result = await transferOwnership(
          modal.station.id,
          newOwnerId,
          user.id,
        );
        if (!result.success) {
          showNotice(`Transfer failed: ${result.error}`);
          return;
        }
        showNotice(
          `Ownership of "${modal.station.name}" transferred to ${newOwnerName}`,
        );
        recordStationActivity(modal.station.id, {
          actorId: user.id,
          actorName: user.email || "Owner",
          action: "ownership_transferred",
          detail: `Transferred to ${newOwnerName}`,
        }).catch(() => {});
        setNetworkRefreshKey((k) => k + 1);
        closeModal();
      } catch (e: any) {
        showNotice(`Transfer failed: ${e?.message || "error"}`);
      }
    },
    [modal?.station, user?.id, user?.email, showNotice, closeModal],
  );

  // ---- Bulk Invite (multiple emails at once) ----
  const handleBulkInvite = useCallback(
    async (emails: string[], role: string) => {
      if (!modal?.station || !user?.id || emails.length === 0) return;
      const results: { email: string; ok: boolean; error?: string }[] = [];
      for (const email of emails) {
        try {
          const r = await inviteMember(
            modal.station.id,
            email,
            role,
            undefined,
            {
              invitedByUserId: user.id,
              invitedByName: user.email || "Owner",
            },
          );
          results.push({ email, ok: r.success, error: r.error });
        } catch (e: any) {
          results.push({ email, ok: false, error: e?.message });
        }
      }
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      showNotice(
        fail > 0
          ? `Invited ${ok}/${results.length}${fail > 0 ? ` (${fail} failed)` : ""}`
          : `Invited ${ok} member${ok !== 1 ? "s" : ""}`,
      );
      // reload members in the share modal
      setNetworkRefreshKey((k) => k + 1);
    },
    [modal?.station, user?.id, user?.email, showNotice],
  );

  // ---- Open Share modal from the Access sub-tab ----
  const handleShareFromAccess = useCallback(() => {
    const sid = accessStationId || currentStation?.id;
    if (!sid) return;
    const station = stations.find((s) => s.id === sid);
    if (station) setModal({ type: "share", station });
  }, [accessStationId, currentStation?.id, stations]);

  // ---- Deep-link to Team Manager (closes Station Manager, switches tab) ----
  const handleOpenTeamManager = useCallback(() => {
    goToMainTab("team", onClose);
  }, [onClose]);

  // ---- Refresh access data ----
  const handleRefreshAccess = useCallback(() => {
    loadAccessData();
  }, [loadAccessData]);

  const handleExport = useCallback(
    (station: any) => {
      downloadJson(`${station.name.replace(/\s+/g, "_")}_export.json`, station);
      showNotice("Station data exported (JSON)");
    },
    [showNotice],
  );

  const handleExportCsv = useCallback(() => {
    const rows: (string | number)[][] = [
      [
        "Station",
        "Location",
        "Status",
        "Today Revenue",
        "Month Revenue",
        "Total Revenue",
        "Sales Count",
        "Shared Users",
        "Health Score",
        "Last Updated",
      ],
    ];
    stationAnalytics.forEach((a) => {
      rows.push([
        a.station.name,
        a.station.location || "",
        a.status,
        a.todayRev,
        a.monthRev,
        a.totalRev,
        a.sales,
        a.sharedCount,
        `${a.healthScore}%`,
        a.station.updatedAt || "",
      ]);
    });
    downloadCsv(`stations_${Date.now()}.csv`, rows);
    showNotice("Stations exported (CSV)");
  }, [stationAnalytics, showNotice]);

  const handleDeleteOpen = useCallback((station: any) => {
    setModal({ type: "delete", station });
  }, []);

  const handleDeleteConfirmed = useCallback(() => {
    if (modal?.station) {
      deleteStation(modal.station.id);
      showNotice(`Station "${modal.station.name}" deleted`);
      if (defaultStationId === modal.station.id) {
        localStorage.removeItem(DEFAULT_STATION_KEY);
        setDefaultStationId(null);
      }
      closeModal();
    }
  }, [modal, deleteStation, showNotice, closeModal, defaultStationId]);

  const handleToggleStatus = useCallback(
    (station: any) => {
      const current = stationStatus(station.data);
      const next: "active" | "inactive" | "maintenance" =
        current === "active"
          ? "inactive"
          : current === "inactive"
            ? "maintenance"
            : "active";
      updateStation(station.id, {
        ...station,
        data: { ...station.data, status: next },
      });
      showNotice(`Status changed to ${next}`);
    },
    [updateStation, showNotice],
  );

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await syncToBackend();
      await syncFromBackend();
      showNotice("Sync completed");
    } catch {
      showNotice("Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [syncToBackend, syncFromBackend, showNotice]);

  // Bulk actions
  const toggleStationSelection = useCallback((stationId: string) => {
    setSelectedStationIds((prev) => {
      const next = new Set(prev);
      if (next.has(stationId)) next.delete(stationId);
      else next.add(stationId);
      return next;
    });
  }, []);

  const handleBulkExport = useCallback(() => {
    const selected = stations.filter((s) => selectedStationIds.has(s.id));
    downloadJson(
      `stations_export_${Date.now()}.json`,
      selected.map((s) => ({
        id: s.id,
        name: s.name,
        location: s.location,
        data: s.data,
      })),
    );
    showNotice(`Exported ${selected.length} stations`);
    setBulkSelectMode(false);
    setSelectedStationIds(new Set());
  }, [stations, selectedStationIds, showNotice]);

  const handleBulkActivate = useCallback(() => {
    selectedStationIds.forEach((id) => {
      const station = stations.find((s) => s.id === id);
      if (station) {
        updateStation(id, {
          ...station,
          data: { ...station.data, status: "active" },
        });
      }
    });
    showNotice(`Activated ${selectedStationIds.size} stations`);
    setBulkSelectMode(false);
    setSelectedStationIds(new Set());
  }, [selectedStationIds, stations, updateStation, showNotice]);

  // ---- Sub-tab config ----
  const subTabs: {
    id: SubTab;
    label: string;
    icon: any;
    count?: number;
  }[] = [
    { id: "overview", label: "Overview", icon: Gauge },
    {
      id: "stations",
      label: "Stations",
      icon: Layers,
      count: ownedStations.length,
    },
    {
      id: "access",
      label: "Access",
      icon: Shield,
      count: accessSummary.totalMembers + accessSummary.totalCodes,
    },
    {
      id: "network",
      label: "Network",
      icon: Building2,
      count: sharedStations.length + pendingInvites.length,
    },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "activity", label: "Activity", icon: Activity },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];

  // ---- Activity filtered ----
  const filteredActivity = useMemo(() => {
    let result = [...activityEntries];
    if (activityFilterStation !== "all") {
      result = result.filter((e) => e.stationId === activityFilterStation);
    }
    if (activityFilterAction !== "all") {
      result = result.filter((e) => e.action === activityFilterAction);
    }
    return result;
  }, [activityEntries, activityFilterStation, activityFilterAction]);

  // ---- Recent activity (for overview) ----
  const recentActivity = useMemo(
    () => activityEntries.slice(0, 5),
    [activityEntries],
  );

  // Load activity for overview tab too
  useEffect(() => {
    if (activeSubTab === "overview" && activityEntries.length === 0) {
      const loadAll = async () => {
        const all: StationActivityEntry[] = [];
        for (const s of ownedStations.slice(0, 5)) {
          try {
            const entries = await getStationActivity(s.id);
            all.push(...entries);
          } catch {
            /* skip */
          }
        }
        all.sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        setActivityEntries(all.slice(0, 50));
      };
      loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab]);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-gray-900 dark:text-white">
      {/* Header */}
      <header className="bg-gray-50 dark:bg-white/5 backdrop-blur-lg border-b border-gray-200 dark:border-white/10 px-4 sm:px-6 py-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {onClose && (
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center transition-colors flex-shrink-0"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2 truncate">
                <Layers size={20} className="text-amber-400 flex-shrink-0" />
                Station Manager
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {ownedStations.length} owned ·{" "}
                {sharedStationsFromContext.length} shared | Manage access & data
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {stations.length > 0 && (
              <button
                onClick={handleSyncNow}
                disabled={syncing || isBackendSyncing}
                aria-label="Sync now"
                title="Sync now"
                className="px-3 py-2 bg-sky-500/20 text-sky-300 rounded-lg text-sm flex items-center gap-2 hover:bg-sky-500/30 transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={syncing || isBackendSyncing ? "animate-spin" : ""}
                />
                <span>Sync</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Sub-tab navigation */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 overflow-x-auto">
          {subTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm"
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white"
                }`}
              >
                <Icon size={16} />
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full text-[10px] font-bold">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sync status bar */}
        {lastBackendSync && (
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {isBackendSyncing || syncing ? (
              <>
                <RefreshCw size={12} className="animate-spin text-sky-400" />
                <span className="text-sky-400">Syncing...</span>
              </>
            ) : (
              <>
                <Cloud size={12} className="text-emerald-400" />
                <span>Last sync: {relativeTime(lastBackendSync)}</span>
              </>
            )}
          </div>
        )}

        {/* ===================== OVERVIEW SUB-TAB ===================== */}
        {activeSubTab === "overview" && (
          <div className="space-y-6">
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Your Stations"
                value={String(ownedStations.length)}
                icon={Layers}
                accent="text-amber-400"
              />
              <StatCard
                label="Combined Revenue"
                value={formatMoney(stats.totalRevenue)}
                icon={TrendingUp}
                accent="text-emerald-400"
              />
              <StatCard
                label="Today's Revenue"
                value={formatMoney(stats.todayRevenue)}
                icon={Calendar}
                accent="text-sky-400"
              />
              <StatCard
                label="Avg Health"
                value={`${avgHealth}%`}
                icon={Gauge}
                accent={avgHealth >= 60 ? "text-emerald-400" : "text-amber-400"}
              />
            </div>

            {/* Quick actions */}
            <SectionHeader icon={Zap} title="Quick Actions" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <button
                onClick={openCreate}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <Plus size={20} className="text-emerald-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Create Station
                </span>
              </button>
              <button
                onClick={() => setActiveSubTab("network")}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <Building2 size={20} className="text-sky-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Access Shared
                </span>
              </button>
              <button
                onClick={() => setActiveSubTab("access")}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <Shield size={20} className="text-indigo-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Manage Access
                </span>
              </button>
              <button
                onClick={() => setActiveSubTab("analytics")}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <BarChart3 size={20} className="text-purple-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  View Analytics
                </span>
              </button>
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center disabled:opacity-50`}
              >
                <RefreshCw
                  size={20}
                  className={`text-sky-400 ${syncing ? "animate-spin" : ""}`}
                />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Sync Now
                </span>
              </button>
              <button
                onClick={handleExportCsv}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <FileDown size={20} className="text-blue-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Export CSV
                </span>
              </button>
              <button
                onClick={() => setActiveSubTab("activity")}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <Activity size={20} className="text-amber-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Activity Log
                </span>
              </button>
              <button
                onClick={() => setActiveSubTab("settings")}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <SettingsIcon size={20} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Settings
                </span>
              </button>
              <button
                onClick={() => {
                  if (currentStation) handleOpenStation(currentStation);
                }}
                disabled={!currentStation}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center disabled:opacity-50`}
              >
                <LogIn size={20} className="text-emerald-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Open Current
                </span>
              </button>
              <button
                onClick={handleOpenTeamManager}
                className={`${GLASS_CARD} p-4 hover:bg-gray-100 dark:hover:bg-white/10 transition-all flex flex-col items-center gap-2 text-center`}
              >
                <Users size={20} className="text-indigo-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white">
                  Team Manager
                </span>
              </button>
            </div>

            {/* Two-column: recent activity + sync status */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Recent activity */}
              <div>
                <SectionHeader
                  icon={Activity}
                  title="Recent Activity"
                  action={
                    <button
                      onClick={() => setActiveSubTab("activity")}
                      className="text-xs text-sky-400 hover:underline"
                    >
                      View all
                    </button>
                  }
                />
                <div className={`${GLASS_CARD} p-4 space-y-2`}>
                  {recentActivity.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
                      No recent activity
                    </p>
                  ) : (
                    recentActivity.map((entry) => (
                      <div
                        key={entry.id}
                        className="text-xs p-2 bg-gray-100 dark:bg-white/5 rounded-lg"
                      >
                        <p className="text-gray-900 dark:text-white">
                          <span className="font-medium">{entry.actorName}</span>{" "}
                          <span className="text-gray-500 dark:text-gray-400">
                            {actionLabel(entry.action)}
                          </span>
                        </p>
                        {entry.detail && (
                          <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                            {entry.detail}
                          </p>
                        )}
                        <p className="text-[10px] text-gray-500 mt-0.5">
                          {relativeTime(entry.timestamp)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Sync status */}
              <div>
                <SectionHeader icon={Cloud} title="Sync Status" />
                <div className={`${GLASS_CARD} p-4 space-y-3`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                      {isBackendSyncing ? (
                        <WifiOff size={12} className="text-amber-400" />
                      ) : (
                        <Wifi size={12} className="text-emerald-400" />
                      )}
                      Backend Sync
                    </span>
                    <span
                      className={
                        isBackendSyncing ? "text-amber-400" : "text-emerald-400"
                      }
                    >
                      {isBackendSyncing ? "In progress" : "Idle"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">
                      Last Sync
                    </span>
                    <span className="text-gray-900 dark:text-white">
                      {lastBackendSync
                        ? relativeTime(lastBackendSync)
                        : "Never"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">
                      Admin Mode
                    </span>
                    <span
                      className={isAdmin ? "text-emerald-400" : "text-gray-500"}
                    >
                      {isAdmin ? "Yes" : "No"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">
                      Default Station
                    </span>
                    <span className="text-gray-900 dark:text-white truncate max-w-[50%]">
                      {defaultStationId
                        ? stations.find((s) => s.id === defaultStationId)
                            ?.name || "Set"
                        : "Not set"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Top performer */}
            {topStation && (
              <div className={`${GLASS_CARD} p-5`}>
                <div className="flex items-center gap-2 mb-3">
                  <Crown size={18} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Top Performing Station
                  </h3>
                </div>
                <div className="flex items-center gap-4">
                  <div
                    className={`w-14 h-14 rounded-xl ${avatarColor(topStation.station.name)} flex items-center justify-center text-white font-bold`}
                  >
                    {initialsOf(topStation.station.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 dark:text-white truncate">
                      {topStation.station.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {topStation.sales} sales ·{" "}
                      {formatMoney(topStation.todayRev)} today ·{" "}
                      {formatMoney(topStation.monthRev)} this month
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-400">
                      {formatMoney(topStation.totalRev)}
                    </p>
                    <p className="text-[10px] text-gray-500">Total Revenue</p>
                  </div>
                </div>
              </div>
            )}

            {/* Station Health — computed from station data completeness */}
            <SectionHeader icon={Gauge} title="Station Health" />
            <div className={`${GLASS_CARD} p-4 space-y-2`}>
              {stationHealth.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
                  No stations yet — create one to see health status.
                </p>
              ) : (
                stationHealth.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-100 dark:bg-white/5"
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        h.healthLabel === "Good"
                          ? "bg-emerald-500"
                          : h.healthLabel === "Warning"
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
                        {h.name}
                      </p>
                      {h.issues.length > 0 && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400">
                          {h.issues.join(" · ")}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                        h.healthLabel === "Good"
                          ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                          : h.healthLabel === "Warning"
                            ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
                            : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                      }`}
                    >
                      {h.score}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ===================== STATIONS SUB-TAB ===================== */}
        {activeSubTab === "stations" && (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search stations..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-400 text-sm"
                />
              </div>
              <div className="flex items-center gap-1 bg-gray-50 dark:bg-white/5 rounded-xl p-1 overflow-x-auto">
                {(
                  [
                    "all",
                    "active",
                    "inactive",
                    "maintenance",
                    "favorites",
                  ] as FilterStatus[]
                ).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                      filterStatus === s
                        ? "bg-amber-500/30 text-amber-300"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                    }`}
                  >
                    {s === "favorites" ? "★ Favorites" : s}
                  </button>
                ))}
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="recent">Recent first</option>
                <option value="name">Name A–Z</option>
                <option value="revenue">Revenue (high → low)</option>
                <option value="oldest">Oldest first</option>
              </select>
              {ownedStations.length > 0 && (
                <button
                  onClick={() => {
                    setBulkSelectMode((v) => !v);
                    setSelectedStationIds(new Set());
                  }}
                  className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-colors ${
                    bulkSelectMode
                      ? "bg-purple-500/30 text-purple-300"
                      : "bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10"
                  }`}
                >
                  <CheckCircle2 size={16} />
                  {bulkSelectMode ? "Cancel" : "Bulk"}
                </button>
              )}
              <button
                onClick={openCreate}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"
              >
                <Plus size={16} />
                Create
              </button>
            </div>

            {/* Bulk actions bar */}
            {bulkSelectMode && selectedStationIds.size > 0 && (
              <div className="flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl flex-wrap">
                <span className="text-sm text-purple-300 font-medium">
                  {selectedStationIds.size} selected
                </span>
                <button
                  onClick={handleBulkExport}
                  className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-xs flex items-center gap-1.5"
                >
                  <Download size={13} /> Export
                </button>
                <button
                  onClick={handleBulkActivate}
                  className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-xs flex items-center gap-1.5"
                >
                  <CheckCircle2 size={13} /> Activate All
                </button>
                <button
                  onClick={() => setSelectedStationIds(new Set())}
                  className="ml-auto text-xs text-gray-500 hover:text-gray-300"
                >
                  Clear
                </button>
              </div>
            )}

            {/* Station grid */}
            <div>
              <SectionHeader
                icon={Layers}
                title="Your Stations"
                count={ownedStations.length}
                action={
                  <span className="text-sm text-gray-500 dark:text-gray-400 font-normal">
                    Combined: {formatMoney(stats.totalRevenue)}
                  </span>
                }
              />
              {isStationLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : ownedStations.length === 0 ? (
                <EmptyState onCreate={openCreate} />
              ) : visibleStations.length === 0 ? (
                <div className={`${GLASS_CARD} p-8 text-center`}>
                  <Search className="w-8 h-8 text-gray-500 mx-auto mb-3" />
                  <p className="text-gray-300 text-sm">
                    No stations match your search/filter.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleStations.map((s) => (
                    <div key={s.id} className="relative">
                      {bulkSelectMode && (
                        <button
                          onClick={() => toggleStationSelection(s.id)}
                          className={`absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                            selectedStationIds.has(s.id)
                              ? "bg-purple-500 text-white"
                              : "bg-gray-300 dark:bg-gray-600 text-gray-500"
                          }`}
                        >
                          {selectedStationIds.has(s.id) && <Check size={14} />}
                        </button>
                      )}
                      <StationCard
                        station={s}
                        isCurrent={currentStation?.id === s.id}
                        isFavorite={favorites.has(s.id)}
                        isDefault={defaultStationId === s.id}
                        onOpen={() => handleOpenStation(s)}
                        onEdit={() => handleEdit(s)}
                        onShare={() => handleShareOpen(s)}
                        onExport={() => handleExport(s)}
                        onDelete={() => handleDeleteOpen(s)}
                        onToggleStatus={() => handleToggleStatus(s)}
                        onClone={() => handleClone(s)}
                        onQR={() => setModal({ type: "qr", station: s })}
                        onToggleFavorite={() => handleToggleFavorite(s.id)}
                        onSetDefault={() => handleSetDefault(s.id)}
                        onTransfer={() => handleTransferOwnership(s)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ===================== ACCESS SUB-TAB ===================== */}
        {/* Unified two-way access dashboard: who can access YOUR stations
            (members + access codes) — intertwined with Team Manager. */}
        {activeSubTab === "access" && (
          <div className="space-y-6">
            {/* Station selector for the access dashboard */}
            <div className={`${GLASS_CARD} p-4`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Shield size={18} className="text-indigo-400 flex-shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                      Station Access Dashboard
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Manage who can access this station — members & access
                      codes
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={accessStationId}
                    onChange={(e) => setAccessStationId(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-[180px]"
                  >
                    {ownedStations.length === 0 && (
                      <option value="">No stations</option>
                    )}
                    {ownedStations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleRefreshAccess}
                    disabled={accessLoading}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-lg text-xs flex items-center gap-1"
                  >
                    <RefreshCw
                      size={13}
                      className={accessLoading ? "animate-spin" : ""}
                    />
                    Refresh
                  </button>
                </div>
              </div>
            </div>

            {/* Access summary stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Active Members"
                value={String(accessSummary.totalMembers)}
                icon={Users}
                accent="text-emerald-400"
              />
              <StatCard
                label="Pending Invites"
                value={String(accessSummary.pendingInvites)}
                icon={Mail}
                accent="text-amber-400"
              />
              <StatCard
                label="Access Codes"
                value={String(accessSummary.totalCodes)}
                icon={KeyRound}
                accent="text-sky-400"
              />
              <StatCard
                label="Active Codes"
                value={String(accessSummary.activeCodes)}
                icon={Shield}
                accent="text-indigo-400"
              />
            </div>

            {/* Quick actions — intertwined with Team Manager */}
            <SectionHeader icon={Zap} title="Quick Actions" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                onClick={handleShareFromAccess}
                disabled={!accessStationId}
                className="px-3 py-3 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50 text-sky-500 dark:text-sky-400 rounded-xl text-xs font-medium flex flex-col items-center gap-1.5"
              >
                <UserPlus size={18} />
                Invite Member
              </button>
              <button
                onClick={handleOpenTeamManager}
                className="px-3 py-3 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500 dark:text-indigo-400 rounded-xl text-xs font-medium flex flex-col items-center gap-1.5"
              >
                <ExternalLink size={18} />
                Team Manager
              </button>
              <button
                onClick={() => {
                  if (accessStationId) {
                    const station = stations.find(
                      (s) => s.id === accessStationId,
                    );
                    if (station) handleTransferOwnership(station);
                  }
                }}
                disabled={!accessStationId}
                className="px-3 py-3 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 text-amber-500 dark:text-amber-400 rounded-xl text-xs font-medium flex flex-col items-center gap-1.5"
              >
                <ArrowRightLeft size={18} />
                Transfer Ownership
              </button>
              <button
                onClick={handleOpenTeamManager}
                className="px-3 py-3 bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 dark:text-purple-400 rounded-xl text-xs font-medium flex flex-col items-center gap-1.5"
              >
                <KeyRound size={18} />
                Access Codes
              </button>
            </div>

            {/* Members of this station (who I've shared with) */}
            <div>
              <SectionHeader
                icon={Users}
                title="Members with Access"
                count={accessMembers.length}
              />
              {accessLoading ? (
                <div className={`${GLASS_CARD} p-6 text-center`}>
                  <RefreshCw
                    size={20}
                    className="animate-spin text-gray-500 mx-auto mb-2"
                  />
                  <p className="text-xs text-gray-500">Loading members...</p>
                </div>
              ) : accessMembers.length === 0 ? (
                <div className={`${GLASS_CARD} p-6 text-center`}>
                  <Users size={28} className="text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    No members yet. Invite someone to grant them access to this
                    station.
                  </p>
                  <button
                    onClick={handleShareFromAccess}
                    className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <UserPlus size={13} />
                    Invite Member
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {accessMembers.map((m) => (
                    <div
                      key={m.id}
                      className={`${GLASS_CARD} p-3 flex items-center justify-between gap-3`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-lg ${avatarColor(m.name || m.invited_email || "M")} flex items-center justify-center text-white font-bold text-xs flex-shrink-0`}
                        >
                          {initialsOf(m.name || m.invited_email || "M")}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {m.name || m.invited_email || "Unknown"}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">
                            {m.invited_email || m.member_email || ""}
                            {m.last_accessed_at && (
                              <span className="ml-2">
                                · last seen {relativeTime(m.last_accessed_at)}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <RoleBadge role={m.role} />
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            m.status === "accepted" || m.status === "active"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : m.status === "pending"
                                ? "bg-amber-500/20 text-amber-400"
                                : "bg-gray-500/20 text-gray-400"
                          }`}
                        >
                          {m.status}
                        </span>
                        <button
                          onClick={() => handleRevokeMember(m.id)}
                          title="Revoke access"
                          className="w-7 h-7 rounded text-red-400 hover:bg-red-500/10 flex items-center justify-center"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Access Codes for this station */}
            <div>
              <SectionHeader
                icon={KeyRound}
                title="Access Codes (No-Signup Access)"
                count={accessCodes.length}
              />
              {accessLoading ? (
                <div className={`${GLASS_CARD} p-6 text-center`}>
                  <RefreshCw
                    size={20}
                    className="animate-spin text-gray-500 mx-auto mb-2"
                  />
                  <p className="text-xs text-gray-500">Loading codes...</p>
                </div>
              ) : accessCodes.length === 0 ? (
                <div className={`${GLASS_CARD} p-6 text-center`}>
                  <KeyRound size={28} className="text-gray-600 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    No access codes yet. Create one in Team Manager to grant
                    no-signup read-only access.
                  </p>
                  <button
                    onClick={handleOpenTeamManager}
                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <ExternalLink size={13} />
                    Open Team Manager
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {accessCodes.map((c) => (
                    <div
                      key={c.id}
                      className={`${GLASS_CARD} p-3 flex items-center justify-between gap-3`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-sky-500/20 flex items-center justify-center text-sky-400 flex-shrink-0">
                          <KeyRound size={15} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {c.memberName || c.username}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">
                            @{c.username}
                            {c.allowedTabs && c.allowedTabs.length > 0 && (
                              <span className="ml-2">
                                · {c.allowedTabs.length} tabs
                              </span>
                            )}
                            {c.readOnly && (
                              <span className="ml-2">· read-only</span>
                            )}
                            {c.accessCount !== undefined && (
                              <span className="ml-2">
                                · {c.accessCount}x accessed
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <a
                          href={`/#/station-access`}
                          onClick={(e) => {
                            // Open the Station Access viewer in a new tab
                            // so the owner can preview the read-only snapshot
                            // their members see.
                            e.preventDefault();
                            const sid =
                              accessStationId || currentStation?.id || "";
                            const oid = user?.id || "";
                            window.open(
                              `/#/station-access?owner=${encodeURIComponent(oid)}&station=${encodeURIComponent(sid)}`,
                              "_blank",
                            );
                          }}
                          className="px-2 py-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 rounded-lg text-[10px] font-medium inline-flex items-center gap-1"
                          title="Preview the read-only station snapshot members see"
                        >
                          <Eye size={11} /> Preview
                        </a>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            c.enabled
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-gray-500/20 text-gray-400"
                          }`}
                        >
                          {c.enabled ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Intertwined tip */}
            <div className={`${GLASS_CARD} p-4 border-l-4 border-indigo-500`}>
              <div className="flex items-start gap-3">
                <ExternalLink
                  size={16}
                  className="text-indigo-400 mt-0.5 flex-shrink-0"
                />
                <div>
                  <p className="text-xs font-medium text-gray-900 dark:text-white">
                    Integrated with Team Manager
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    This access dashboard is synchronized with the Team Manager
                    tab. Members invited here appear in Team Manager, and access
                    codes created in Team Manager appear here. Use the{" "}
                    <strong>Team Manager</strong> button above to manage roles,
                    permissions, shifts, and detailed access-code configuration.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================== NETWORK SUB-TAB ===================== */}
        {activeSubTab === "network" && (
          <div className="space-y-6">
            {/* Pending invites */}
            {pendingInvites.length > 0 && (
              <div>
                <SectionHeader
                  icon={Mail}
                  title="Pending Invites"
                  count={pendingInvites.length}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  {pendingInvites.map((inv) => (
                    <div
                      key={inv.stationId}
                      className={`${GLASS_CARD} p-4 flex items-center justify-between`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {inv.stationName}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <RoleBadge role={inv.role} />
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            by {inv.invitedBy}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() =>
                            handleAcceptPending(
                              inv.member?.id || "",
                              inv.stationName,
                            )
                          }
                          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs flex items-center gap-1"
                        >
                          <Check size={12} /> Accept
                        </button>
                        <button
                          onClick={() =>
                            handleDeclinePending(inv.member?.id || "")
                          }
                          className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Join by invite link */}
            <div>
              <SectionHeader icon={LogIn} title="Join by Invite Link" />
              <div className={`${GLASS_CARD} p-4 space-y-3`}>
                {inviteError && (
                  <div className="p-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs">
                    {inviteError}
                  </div>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Paste an invite link or token you received from a station
                  owner
                </p>
                <input
                  type="text"
                  value={inviteLinkInput}
                  onChange={(e) => setInviteLinkInput(e.target.value)}
                  placeholder="https://fuel-app-mobile.pages.dev/?invite=abc123... or just abc123..."
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-sky-400 text-sm"
                />
                <button
                  onClick={handleJoinByLink}
                  disabled={inviteBusy}
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                >
                  {inviteBusy ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <LogIn size={14} />
                  )}
                  Accept Invite & Access Station
                </button>
              </div>
            </div>

            {/* Shared with you */}
            <div>
              <SectionHeader
                icon={Building2}
                title="Shared With You"
                count={sharedStationsFromContext.length + sharedStations.length}
              />
              {sharedStationsFromContext.length === 0 &&
              sharedStations.length === 0 ? (
                <div className={`${GLASS_CARD} p-8 text-center`}>
                  <Building2 size={32} className="text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    No stations shared with you yet. When a station owner
                    invites you, the station will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[...sharedStationsFromContext, ...sharedStations]
                    .filter(
                      (s, idx, arr) =>
                        arr.findIndex(
                          (x) =>
                            (x as any).id === (s as any).id ||
                            (x as any).stationId === (s as any).stationId,
                        ) === idx,
                    )
                    .map((s: any) => {
                      const stationId = s.id || s.stationId;
                      const name = s.name || s.stationName;
                      const binding = bindings.find(
                        (b) => b.stationId === stationId,
                      );
                      const role =
                        s.memberRole ||
                        s.userRole ||
                        s.role ||
                        binding?.role ||
                        "member";
                      const invitedBy =
                        s.invitedBy || binding?.invitedBy || "Owner";
                      return (
                        <div
                          key={stationId}
                          className={`${
                            currentStation?.id === stationId
                              ? "ring-2 ring-sky-400/50"
                              : ""
                          } ${GLASS_CARD} p-4`}
                        >
                          <div className="flex items-center gap-3 mb-3">
                            <div
                              className={`w-10 h-10 rounded-xl ${avatarColor(name)} flex items-center justify-center text-white font-bold text-xs`}
                            >
                              {initialsOf(name)}
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-bold text-gray-900 dark:text-white text-sm truncate">
                                {name}
                              </h3>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <RoleBadge role={role} />
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  by {invitedBy}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() =>
                                handleAccessSharedStation(stationId)
                              }
                              className="flex-1 px-3 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
                            >
                              <LogIn size={13} />
                              {currentStation?.id === stationId
                                ? "Active"
                                : "Access"}
                            </button>
                            <button
                              onClick={() =>
                                handleLeaveSharedStation(stationId, name)
                              }
                              title="Leave"
                              className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs"
                            >
                              <LogOut size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== ANALYTICS SUB-TAB ===================== */}
        {activeSubTab === "analytics" && (
          <div className="space-y-6">
            {/* Aggregate analytics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Total Sales"
                value={String(totalSales)}
                icon={BarChart3}
                accent="text-purple-400"
              />
              <StatCard
                label="Avg Revenue / Station"
                value={formatMoney(avgRevenue)}
                icon={TrendingUp}
                accent="text-emerald-400"
              />
              <StatCard
                label="Active Stations"
                value={`${activeCount}/${ownedStations.length}`}
                icon={CheckCircle2}
                accent="text-emerald-400"
              />
              <StatCard
                label="Avg Health"
                value={`${avgHealth}%`}
                icon={Gauge}
                accent={avgHealth >= 60 ? "text-emerald-400" : "text-amber-400"}
              />
            </div>

            {/* Revenue trend bar chart (canvas) */}
            {stationAnalytics.length > 0 && (
              <RevenueBarChart analytics={stationAnalytics} />
            )}

            {/* Top performer */}
            {topStation && (
              <div className={`${GLASS_CARD} p-5`}>
                <div className="flex items-center gap-2 mb-3">
                  <Crown size={18} className="text-amber-400" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Top Performing Station
                  </h3>
                </div>
                <div className="flex items-center gap-4">
                  <div
                    className={`w-14 h-14 rounded-xl ${avatarColor(topStation.station.name)} flex items-center justify-center text-white font-bold`}
                  >
                    {initialsOf(topStation.station.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 dark:text-white truncate">
                      {topStation.station.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {topStation.sales} sales ·{" "}
                      {formatMoney(topStation.todayRev)} today ·{" "}
                      {formatMoney(topStation.monthRev)} this month
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-400">
                      {formatMoney(topStation.totalRev)}
                    </p>
                    <p className="text-[10px] text-gray-500">Total Revenue</p>
                  </div>
                </div>
              </div>
            )}

            {/* Station comparison table */}
            <div className={`${GLASS_CARD} overflow-hidden`}>
              <div className="p-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <BarChart3 size={16} className="text-blue-400" />
                  Station Comparison
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportCsv}
                    className="px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-xs flex items-center gap-1.5"
                  >
                    <FileDown size={12} /> CSV
                  </button>
                  <button
                    onClick={() => {
                      downloadJson(
                        `station_analytics_${Date.now()}.json`,
                        stationAnalytics.map((a) => ({
                          station: a.station.name,
                          todayRevenue: a.todayRev,
                          monthRevenue: a.monthRev,
                          totalRevenue: a.totalRev,
                          sales: a.sales,
                          healthScore: a.healthScore,
                          healthLabel: a.healthLabel,
                          status: a.status,
                        })),
                      );
                      showNotice("Analytics exported (JSON)");
                    }}
                    className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-xs flex items-center gap-1.5"
                  >
                    <Download size={12} /> JSON
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr>
                      <th className="text-left p-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Station
                      </th>
                      <th className="text-right p-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Today
                      </th>
                      <th className="text-right p-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Month
                      </th>
                      <th className="text-right p-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Total
                      </th>
                      <th className="text-right p-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Sales
                      </th>
                      <th className="text-center p-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Health
                      </th>
                      <th className="text-center p-3 text-xs text-gray-500 dark:text-gray-400 font-medium">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stationAnalytics.map((a) => (
                      <tr
                        key={a.station.id}
                        className="border-t border-gray-200 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5"
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-7 h-7 rounded-lg ${avatarColor(a.station.name)} flex items-center justify-center text-[10px] font-bold text-white`}
                            >
                              {initialsOf(a.station.name)}
                            </div>
                            <span className="text-gray-900 dark:text-white font-medium truncate max-w-[120px]">
                              {a.station.name}
                            </span>
                          </div>
                        </td>
                        <td className="text-right p-3 text-emerald-400 text-xs">
                          {formatMoney(a.todayRev)}
                        </td>
                        <td className="text-right p-3 text-sky-400 text-xs">
                          {formatMoney(a.monthRev)}
                        </td>
                        <td className="text-right p-3 text-gray-900 dark:text-white font-medium text-xs">
                          {formatMoney(a.totalRev)}
                        </td>
                        <td className="text-right p-3 text-gray-500 dark:text-gray-400 text-xs">
                          {a.sales}
                        </td>
                        <td className="text-center p-3">
                          <span
                            className={`text-xs font-medium ${a.healthScore >= 80 ? "text-emerald-400" : a.healthScore >= 60 ? "text-sky-400" : a.healthScore >= 40 ? "text-amber-400" : "text-red-400"}`}
                          >
                            {a.healthScore}%
                          </span>
                        </td>
                        <td className="text-center p-3">
                          <StatusBadge status={a.status} />
                        </td>
                      </tr>
                    ))}
                    {stationAnalytics.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-8 text-center text-gray-500 dark:text-gray-400 text-sm"
                        >
                          No stations to compare yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================== ACTIVITY SUB-TAB ===================== */}
        {activeSubTab === "activity" && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-gray-500" />
                <select
                  value={activityFilterStation}
                  onChange={(e) => setActivityFilterStation(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="all">All Stations</option>
                  {ownedStations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  {sharedStations.map((s) => (
                    <option key={s.stationId} value={s.stationId}>
                      {s.stationName} (shared)
                    </option>
                  ))}
                </select>
              </div>
              <select
                value={activityFilterAction}
                onChange={(e) => setActivityFilterAction(e.target.value)}
                className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="all">All Actions</option>
                <option value="invite_sent">Invites Sent</option>
                <option value="invite_accepted">Invites Accepted</option>
                <option value="invite_revoked">Invites Revoked</option>
                <option value="member_left">Members Left</option>
                <option value="role_changed">Role Changes</option>
                <option value="access_recorded">Access Records</option>
                <option value="ownership_transferred">
                  Ownership Transfers
                </option>
              </select>
              <button
                onClick={() => {
                  const rows: (string | number)[][] = [
                    ["Actor", "Action", "Detail", "Station", "Timestamp"],
                  ];
                  filteredActivity.forEach((e) => {
                    const st = stations.find((s) => s.id === e.stationId);
                    rows.push([
                      e.actorName,
                      actionLabel(e.action),
                      e.detail || "",
                      st?.name || e.stationId,
                      new Date(e.timestamp).toLocaleString(),
                    ]);
                  });
                  downloadCsv(`activity_${Date.now()}.csv`, rows);
                  showNotice("Activity exported (CSV)");
                }}
                className="px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-xl text-sm flex items-center gap-2"
              >
                <FileDown size={14} /> Export CSV
              </button>
              <button
                onClick={() => setNetworkRefreshKey((k) => k + 1)}
                className="px-3 py-2 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 rounded-xl text-sm flex items-center gap-2"
              >
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            {/* Activity feed */}
            <div className={`${GLASS_CARD} p-4`}>
              {filteredActivity.length === 0 ? (
                <div className="text-center py-8">
                  <Activity size={32} className="text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    No activity recorded yet
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Activity is logged when you invite members, accept invites,
                    or access shared stations.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {filteredActivity.map((entry) => {
                    const st = stations.find((s) => s.id === entry.stationId);
                    const stName =
                      st?.name ||
                      sharedStations.find(
                        (s) => s.stationId === entry.stationId,
                      )?.stationName ||
                      "Unknown";
                    return (
                      <div
                        key={entry.id}
                        className="text-xs p-3 bg-gray-100 dark:bg-white/5 rounded-lg"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-gray-900 dark:text-white min-w-0">
                            <span className="font-medium">
                              {entry.actorName}
                            </span>{" "}
                            <span className="text-gray-500 dark:text-gray-400">
                              {actionLabel(entry.action)}
                            </span>
                          </p>
                          <span className="text-[10px] text-gray-500 flex-shrink-0">
                            {relativeTime(entry.timestamp)}
                          </span>
                        </div>
                        {entry.detail && (
                          <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                            {entry.detail}
                          </p>
                        )}
                        <p className="text-[10px] text-sky-400 mt-0.5">
                          {stName}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== SETTINGS SUB-TAB ===================== */}
        {activeSubTab === "settings" && (
          <div className="space-y-6">
            {/* Default station */}
            <div>
              <SectionHeader icon={Crown} title="Default Station" />
              <div className={`${GLASS_CARD} p-4 space-y-3`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  The default station is opened automatically when you log in
                  (if set).
                </p>
                <select
                  value={defaultStationId || ""}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleSetDefault(e.target.value);
                    } else {
                      localStorage.removeItem(DEFAULT_STATION_KEY);
                      setDefaultStationId(null);
                      showNotice("Default station cleared");
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">No default</option>
                  {ownedStations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sort preference */}
            <div>
              <SectionHeader icon={ArrowUpDown} title="Default Sort" />
              <div className={`${GLASS_CARD} p-4 space-y-3`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  How stations are sorted by default in the Stations tab.
                </p>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="w-full px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/10 border border-white/20 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="recent">Recent first</option>
                  <option value="name">Name A–Z</option>
                  <option value="revenue">Revenue (high → low)</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>
            </div>

            {/* Data export / import */}
            <div>
              <SectionHeader icon={Database} title="Data Management" />
              <div className={`${GLASS_CARD} p-4 space-y-3`}>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Export all station data as a backup, or import a previously
                  exported file.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      downloadJson(
                        `stations_backup_${Date.now()}.json`,
                        stations.map((s) => ({
                          id: s.id,
                          name: s.name,
                          location: s.location,
                          phone: s.phone,
                          email: s.email,
                          kraPin: s.kraPin,
                          taxRate: s.taxRate,
                          country: s.country,
                          currency: s.currency,
                          data: s.data,
                          createdAt: s.createdAt,
                          updatedAt: s.updatedAt,
                        })),
                      );
                      showNotice("Backup exported");
                    }}
                    className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg text-sm flex items-center gap-2"
                  >
                    <Download size={14} /> Export Backup (JSON)
                  </button>
                  <button
                    onClick={handleExportCsv}
                    className="px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-lg text-sm flex items-center gap-2"
                  >
                    <FileDown size={14} /> Export CSV
                  </button>
                </div>
              </div>
            </div>

            {/* Sync controls */}
            <div>
              <SectionHeader icon={Cloud} title="Cloud Sync" />
              <div className={`${GLASS_CARD} p-4 space-y-3`}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">
                    Last Sync
                  </span>
                  <span className="text-gray-900 dark:text-white">
                    {lastBackendSync
                      ? new Date(lastBackendSync).toLocaleString()
                      : "Never"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 dark:text-gray-400">
                    Status
                  </span>
                  <span
                    className={
                      isBackendSyncing ? "text-amber-400" : "text-emerald-400"
                    }
                  >
                    {isBackendSyncing ? "Syncing..." : "Idle"}
                  </span>
                </div>
                <button
                  onClick={handleSyncNow}
                  disabled={syncing || isBackendSyncing}
                  className="w-full px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2"
                >
                  <RefreshCw
                    size={14}
                    className={syncing ? "animate-spin" : ""}
                  />
                  Sync Now
                </button>
              </div>
            </div>

            {/* Danger zone */}
            <div>
              <SectionHeader icon={AlertTriangle} title="Danger Zone" />
              <div
                className={`${GLASS_CARD} p-4 border border-red-500/20 space-y-3`}
              >
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Clear the default station preference or reset the Station
                  Manager view preferences.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      localStorage.removeItem(DEFAULT_STATION_KEY);
                      localStorage.removeItem(STATION_SORT_PREF_KEY);
                      localStorage.removeItem(SUBTAB_KEY);
                      setDefaultStationId(null);
                      setSortBy("recent");
                      setActiveSubTab("overview");
                      showNotice("Preferences reset");
                    }}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-sm flex items-center gap-2"
                  >
                    <Trash2 size={14} /> Reset Preferences
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Notice toast */}
      {notice && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-500/90 text-white text-sm font-medium px-4 py-2 rounded-xl shadow-lg">
          {notice}
        </div>
      )}

      {/* Modals */}
      {modal?.type === "create" && (
        <StationFormModal
          title="Create Station"
          submitLabel="Create"
          initial={EMPTY_FORM}
          onSubmit={handleSaveStation}
          onClose={closeModal}
        />
      )}
      {modal?.type === "edit" && (
        <StationFormModal
          title={`Edit — ${modal.station.name}`}
          submitLabel="Save Changes"
          initial={editForm}
          onSubmit={handleSaveStation}
          onClose={closeModal}
        />
      )}
      {modal?.type === "clone" && (
        <StationFormModal
          title={`Clone — ${modal.station.name}`}
          submitLabel="Clone Station"
          initial={editForm}
          onSubmit={handleSaveStation}
          onClose={closeModal}
        />
      )}
      {modal?.type === "share" && (
        <ShareModal
          station={modal.station}
          onInvite={handleInvite}
          onBulkInvite={handleBulkInvite}
          onRevoke={handleRevokeMember}
          onClose={closeModal}
          openTeamManager={handleOpenTeamManager}
        />
      )}
      {modal?.type === "qr" && (
        <QRModal station={modal.station} onClose={closeModal} />
      )}
      {modal?.type === "delete" && (
        <ConfirmDialog
          title="Delete station"
          message={`This permanently deletes "${modal.station?.name}" and its cloud record. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDeleteConfirmed}
          onCancel={closeModal}
        />
      )}
      {modal?.type === "transfer" && modal.station && (
        <TransferOwnershipModal
          station={modal.station}
          onConfirm={handleConfirmTransfer}
          onClose={closeModal}
        />
      )}
    </div>
  );
}

// ============================================================
// TransferOwnershipModal — transfer station ownership to an existing member
// ============================================================

function TransferOwnershipModal({
  station,
  onConfirm,
  onClose,
}: {
  station: any;
  onConfirm: (newOwnerId: string, newOwnerName: string) => Promise<void>;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<StationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!station?.id) return;
    getStationMembers(station.id)
      .then((m) => {
        // Only accepted/active members with a user_id can receive ownership
        const eligible = m.filter(
          (mem) =>
            (mem.status === "accepted" || mem.status === "active") &&
            mem.user_id,
        );
        setMembers(eligible);
      })
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [station?.id]);

  const handleTransfer = async () => {
    if (!selectedId) return;
    const member = members.find((m) => m.user_id === selectedId);
    if (!member) return;
    setBusy(true);
    try {
      await onConfirm(
        member.user_id!,
        member.name || member.invited_email || "Member",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`${GLASS_CARD} w-full max-w-md p-6 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={18} className="text-amber-400" />
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Transfer Ownership
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Transfer ownership of <strong>{station?.name}</strong> to one of its
          accepted members. You will become a manager. This action cannot be
          undone.
        </p>
        {loading ? (
          <p className="text-xs text-gray-500">Loading members...</p>
        ) : members.length === 0 ? (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs">
            No eligible members to transfer to. Invite a member first (via the
            Share button), then they can accept and become eligible for
            ownership transfer.
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {members.map((m) => (
              <label
                key={m.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer border transition-all ${
                  selectedId === m.user_id
                    ? "bg-sky-500/10 border-sky-500/40"
                    : "bg-gray-100 dark:bg-white/5 border-transparent hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name="transfer-target"
                  checked={selectedId === m.user_id}
                  onChange={() => setSelectedId(m.user_id!)}
                  className="accent-sky-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {m.name || m.invited_email || "Unknown"}
                  </p>
                  <p className="text-[10px] text-gray-500 truncate">
                    {m.invited_email || m.member_email || ""}
                  </p>
                </div>
                <RoleBadge role={m.role} />
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-white/10 dark:hover:bg-white/20 text-gray-900 dark:text-white rounded-xl text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={!selectedId || busy}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium flex items-center gap-2"
          >
            {busy ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <ArrowRightLeft size={14} />
            )}
            Transfer Ownership
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// RevenueBarChart — canvas bar chart of per-station total revenue
// ============================================================

function RevenueBarChart({
  analytics,
}: {
  analytics: {
    station: { name: string };
    totalRev: number;
    todayRev: number;
    monthRev: number;
  }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = analytics.slice(0, 8);
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const maxRev = Math.max(...data.map((d) => d.totalRev), 1);
    const barW = (w - 40) / data.length;
    const chartH = h - 40;

    data.forEach((d, i) => {
      const barH = (d.totalRev / maxRev) * chartH;
      const x = 20 + i * barW;
      const y = h - 20 - barH;
      const gradient = ctx.createLinearGradient(0, y, 0, h - 20);
      gradient.addColorStop(0, "#10b981");
      gradient.addColorStop(1, "#059669");
      ctx.fillStyle = gradient;
      ctx.fillRect(x + 4, y, barW - 8, barH);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      const label = d.station.name.slice(0, 8);
      ctx.fillText(label, x + barW / 2, h - 6);
    });
  }, [analytics]);

  return (
    <div className={`${GLASS_CARD} p-4`}>
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
        <BarChart3 size={16} className="text-emerald-400" />
        Revenue by Station
      </h3>
      <canvas ref={canvasRef} width={600} height={180} className="w-full" />
    </div>
  );
}
