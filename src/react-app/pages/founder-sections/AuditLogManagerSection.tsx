/**
 * AuditLogManagerSection — enhanced cloud-backed Audit Log panel for the
 * Founder Console.
 *
 * Replaces the inline read-only audit view with a cloud-backed, real-time
 * synced panel that adds: severity/user/date filtering, search, export to
 * JSON/CSV, clear (with confirm), auto-refresh indicator, and entry count
 * display.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Shield,
  Search,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  Radio,
  Archive,
} from "lucide-react";
import type {
  ConsoleAuditEntry,
  AuditSeverity,
} from "@/react-app/hooks/useFounderConsoleStore";

interface Props {
  audit: ConsoleAuditEntry[];
  loading?: boolean;
  lastSync?: number;
  onClear: () => void;
  onReload: () => void;
  logAudit: (
    event: string,
    detail: string,
    severity?: AuditSeverity,
    user?: string,
  ) => void;
  retentionLimit?: number;
}

const SEVERITY_META: Record<
  AuditSeverity,
  { icon: typeof CheckCircle2; color: string; label: string }
> = {
  success: { icon: CheckCircle2, color: "text-emerald-400", label: "Success" },
  warning: { icon: AlertTriangle, color: "text-amber-400", label: "Warning" },
  danger: { icon: XCircle, color: "text-red-400", label: "Danger" },
  info: { icon: Activity, color: "text-blue-400", label: "Info" },
};

export default function AuditLogManagerSection({
  audit,
  loading,
  lastSync,
  onClear,
  onReload,
  logAudit,
  retentionLimit = 500,
}: Props) {
  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterUser, setFilterUser] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [liveTail, setLiveTail] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);

  // Auto-export when approaching retention threshold.
  useEffect(() => {
    if (audit.length >= retentionLimit * 0.9) {
      const content = JSON.stringify(audit, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fuelpro-audit-archive-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      logAudit(
        "Audit Auto-Archive",
        `Threshold reached (${audit.length}/${retentionLimit}); exported archive`,
        "warning",
      );
    }
  }, [audit.length, retentionLimit]); // eslint-disable-line react-hooks/exhaustive-deps

  const users = useMemo(() => {
    const set = new Set<string>();
    audit.forEach((a) => set.add(a.user));
    return Array.from(set).sort();
  }, [audit]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTime = dateTo ? new Date(dateTo).getTime() + 86400000 : Infinity;
    return audit.filter((a) => {
      const matchesQ =
        !q ||
        a.event.toLowerCase().includes(q) ||
        a.detail.toLowerCase().includes(q);
      const matchesSev =
        filterSeverity === "all" || a.severity === filterSeverity;
      const matchesUser = filterUser === "all" || a.user === filterUser;
      const t = new Date(a.timestamp).getTime();
      const matchesDate = t >= fromTime && t <= toTime;
      return matchesQ && matchesSev && matchesUser && matchesDate;
    });
  }, [audit, search, filterSeverity, filterUser, dateFrom, dateTo]);

  const counts = useMemo(() => {
    const c: Record<AuditSeverity, number> = {
      success: 0,
      warning: 0,
      danger: 0,
      info: 0,
    };
    audit.forEach((a) => {
      c[a.severity] = (c[a.severity] || 0) + 1;
    });
    return c;
  }, [audit]);

  const handleClear = () => {
    if (
      !confirm(
        `Clear all ${audit.length} audit entries? This action is recorded and cannot be undone.`,
      )
    )
      return;
    onClear();
    logAudit("Audit Log Cleared", `Cleared ${audit.length} entries`, "warning");
  };

  const exportLog = (format: "json" | "csv") => {
    let content: string;
    let mime: string;
    let ext: string;
    if (format === "json") {
      content = JSON.stringify(filtered, null, 2);
      mime = "application/json";
      ext = "json";
    } else {
      const headers = [
        "id",
        "event",
        "detail",
        "user",
        "severity",
        "timestamp",
      ];
      const rows = filtered.map((a) =>
        [a.id, a.event, a.detail, a.user, a.severity, a.timestamp]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
      content = [headers.join(","), ...rows].join("\n");
      mime = "text/csv";
      ext = "csv";
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro-audit-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit(
      "Audit Log Exported",
      `${filtered.length} entries as ${ext.toUpperCase()}`,
      "info",
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Shield size={18} className="text-amber-400" /> Security Audit Log
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Real-time
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {audit.length} total events · live-synced across devices
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setLiveTail((v) => !v)}
            title="Toggle live tail (newest events first, auto-scroll)"
            className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg transition-colors border ${liveTail ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-white/[0.03] text-gray-300 border-white/[0.08]"}`}
          >
            <Radio size={13} className={liveTail ? "animate-pulse" : ""} /> Live
          </button>
          <button
            onClick={onReload}
            title="Reload from cloud"
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />{" "}
            Refresh
          </button>
          <button
            onClick={() => exportLog("json")}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <Download size={13} /> JSON
          </button>
          <button
            onClick={() => exportLog("csv")}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <Download size={13} /> CSV
          </button>
          <button
            onClick={handleClear}
            disabled={audit.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs rounded-lg transition-colors border border-red-500/20 disabled:opacity-40"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>
      </div>

      {/* Retention indicator */}
      {audit.length >= retentionLimit * 0.8 && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
          <Archive size={14} />
          Retention: {audit.length}/{retentionLimit} entries. Auto-archive will
          trigger at {Math.round(retentionLimit * 0.9)}.
        </div>
      )}

      {/* Severity summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(Object.keys(SEVERITY_META) as AuditSeverity[]).map((sev) => {
          const meta = SEVERITY_META[sev];
          const Icon = meta.icon;
          return (
            <button
              key={sev}
              onClick={() =>
                setFilterSeverity(filterSeverity === sev ? "all" : sev)
              }
              className={`bg-[#161618] border rounded-xl p-3 text-left transition-colors ${filterSeverity === sev ? "border-amber-500/40" : "border-white/[0.06]"}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={12} className={meta.color} />
                <span className="text-[10px] text-gray-500">{meta.label}</span>
              </div>
              <p className="text-lg font-semibold text-white">
                {counts[sev] || 0}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events or details..."
            className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
          />
        </div>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
        >
          <option value="all">All severities</option>
          <option value="success">Success</option>
          <option value="warning">Warning</option>
          <option value="danger">Danger</option>
          <option value="info">Info</option>
        </select>
        <select
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
        >
          <option value="all">All users</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white focus:outline-none focus:border-amber-500/30"
          title="To date"
        />
        {(search ||
          filterSeverity !== "all" ||
          filterUser !== "all" ||
          dateFrom ||
          dateTo) && (
          <button
            onClick={() => {
              setSearch("");
              setFilterSeverity("all");
              setFilterUser("all");
              setDateFrom("");
              setDateTo("");
            }}
            className="px-3 py-2 text-xs text-gray-400 hover:text-gray-200"
          >
            Reset
          </button>
        )}
      </div>

      <div className="bg-[#161618] border border-white/[0.06] rounded-xl overflow-x-auto -mx-3 sm:mx-0">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {["Status", "Event", "Detail", "User", "Time"].map((h) => (
                <th
                  key={h}
                  className="text-left text-[11px] text-gray-500 font-medium px-4 py-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, liveTail ? visibleCount : undefined).map((a) => {
              const meta = SEVERITY_META[a.severity] || SEVERITY_META.info;
              const Icon = meta.icon;
              const isNew =
                liveTail && Date.now() - new Date(a.timestamp).getTime() < 3000;
              return (
                <tr
                  key={a.id}
                  className={`border-b border-white/[0.04] hover:bg-white/[0.02] ${isNew ? "bg-emerald-500/5" : ""}`}
                >
                  <td className="px-4 py-3">
                    <Icon size={13} className={meta.color} />
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{a.event}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {a.detail}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] px-2 py-0.5 bg-white/5 rounded text-gray-400">
                      {a.user}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-gray-500">
                    {new Date(a.timestamp).toLocaleString()}
                    {isNew && (
                      <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                        NEW
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-600 py-12">
                  {audit.length === 0
                    ? "No audit events"
                    : "No events match your filter"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {liveTail && filtered.length > visibleCount && (
        <button
          onClick={() => setVisibleCount((c) => c + 50)}
          className="w-full py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs"
        >
          Show more ({filtered.length - visibleCount} hidden)
        </button>
      )}
      <p className="text-[10px] text-gray-600 flex items-center gap-2">
        {filtered.length} shown of {audit.length} total
        {lastSync && (
          <span className="text-gray-700">
            · last sync {new Date(lastSync).toLocaleTimeString()}
          </span>
        )}
      </p>
    </div>
  );
}
