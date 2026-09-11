/**
 * ErrorTrackerSection — cloud-backed, real-time error tracking for the
 * Founder Console. Manual error logging, resolve/unresolve toggle, filter
 * by source/severity/resolved, and bulk-clear resolved/all errors.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Plus,
  X,
  Search,
  CheckCircle2,
  Trash2,
  Activity,
  Skull,
} from "lucide-react";
import type {
  ErrorLogEntry,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import {
  SectionHeader,
  Field,
  IconBtn,
  EmptyState,
} from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

const SEVERITY_STYLES: Record<ErrorLogEntry["severity"], string> = {
  error: "bg-red-500/20 text-red-400",
  warning: "bg-amber-500/20 text-amber-400",
  fatal: "bg-purple-500/20 text-purple-400",
};

const SOURCE_STYLES: Record<ErrorLogEntry["source"], string> = {
  client: "bg-blue-500/20 text-blue-400",
  server: "bg-purple-500/20 text-purple-400",
  api: "bg-cyan-500/20 text-cyan-400",
  webhook: "bg-pink-500/20 text-pink-400",
};

const SOURCES: ErrorLogEntry["source"][] = [
  "client",
  "server",
  "api",
  "webhook",
];
const SEVERITIES: ErrorLogEntry["severity"][] = ["error", "warning", "fatal"];

export default function ErrorTrackerSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterResolved, setFilterResolved] = useState<string>("all");
  const [message, setMessage] = useState("");
  const [source, setSource] = useState<ErrorLogEntry["source"]>("server");
  const [severity, setSeverity] = useState<ErrorLogEntry["severity"]>("error");
  const [url, setUrl] = useState("");
  const [stack, setStack] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return store.errorLog.filter((e) => {
      const matchesQ =
        !q ||
        e.message.toLowerCase().includes(q) ||
        (e.stack ?? "").toLowerCase().includes(q);
      const matchesSource = filterSource === "all" || e.source === filterSource;
      const matchesSev =
        filterSeverity === "all" || e.severity === filterSeverity;
      const matchesResolved =
        filterResolved === "all" ||
        (filterResolved === "resolved" ? e.resolved : !e.resolved);
      return matchesQ && matchesSource && matchesSev && matchesResolved;
    });
  }, [store.errorLog, search, filterSource, filterSeverity, filterResolved]);

  const stats = useMemo(() => {
    const total = store.errorLog.length;
    const unresolved = store.errorLog.filter((e) => !e.resolved).length;
    const bySeverity = SEVERITIES.reduce(
      (acc, sev) => {
        acc[sev] = store.errorLog.filter((e) => e.severity === sev).length;
        return acc;
      },
      {} as Record<ErrorLogEntry["severity"], number>,
    );
    return { total, unresolved, bySeverity };
  }, [store.errorLog]);

  const reset = () => {
    setMessage("");
    setSource("server");
    setSeverity("error");
    setUrl("");
    setStack("");
  };

  const logError = () => {
    if (!message.trim()) return;
    store.recordError({
      message: message.trim(),
      source,
      severity,
      url: url.trim() || undefined,
      stack: stack.trim() || undefined,
      userAgent: navigator.userAgent,
    });
    logAudit("Error Logged", `"${message.trim().slice(0, 60)}"`, "warning");
    reset();
    setShowAdd(false);
  };

  const handleResolve = (e: ErrorLogEntry) => {
    store.resolveError(e.id);
    logAudit(
      e.resolved ? "Error Reopened" : "Error Resolved",
      `"${e.message.slice(0, 60)}"`,
      e.resolved ? "warning" : "success",
    );
  };

  const handleClearResolved = () => {
    const n = store.errorLog.filter((e) => e.resolved).length;
    if (n === 0) return;
    if (!confirm(`Clear ${n} resolved error(s)?`)) return;
    store.clearResolvedErrors();
    logAudit("Resolved Errors Cleared", `${n} entries`, "warning");
  };

  const handleClearAll = () => {
    if (store.errorLog.length === 0) return;
    if (!confirm(`Clear ALL ${store.errorLog.length} error(s)?`)) return;
    store.clearAllErrors();
    logAudit(
      "All Errors Cleared",
      `${store.errorLog.length} entries`,
      "danger",
    );
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={AlertTriangle}
        title="Error Tracker"
        subtitle="Real-time error aggregation — synced across all founder devices"
        count={store.errorLog.length}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Total Errors"
          value={stats.total}
          icon={AlertTriangle}
          color="text-amber-400"
        />
        <StatCard
          label="Unresolved"
          value={stats.unresolved}
          icon={Activity}
          color="text-red-400"
        />
        <StatCard
          label="Errors"
          value={stats.bySeverity.error ?? 0}
          icon={AlertTriangle}
          color="text-red-400"
        />
        <StatCard
          label="Fatal"
          value={stats.bySeverity.fatal ?? 0}
          icon={Skull}
          color="text-purple-400"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search errors..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={filterResolved}
          onChange={(e) => setFilterResolved(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All states</option>
          <option value="unresolved">Unresolved</option>
          <option value="resolved">Resolved</option>
        </select>
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Log Error
        </button>
        <button
          onClick={handleClearResolved}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10"
        >
          <CheckCircle2 size={16} /> Clear Resolved
        </button>
        <button
          onClick={handleClearAll}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm border border-red-500/20"
        >
          <Trash2 size={16} /> Clear All
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              Log Error Manually
            </h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <Field label="Message">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="TypeError: Cannot read property..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source">
              <select
                value={source}
                onChange={(e) =>
                  setSource(e.target.value as ErrorLogEntry["source"])
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity">
              <select
                value={severity}
                onChange={(e) =>
                  setSeverity(e.target.value as ErrorLogEntry["severity"])
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="URL (optional)">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/api/..."
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <Field label="Stack trace (optional)">
            <textarea
              value={stack}
              onChange={(e) => setStack(e.target.value)}
              placeholder="at foo (app.js:1:1)..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={logError}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              Log Error
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState icon={AlertTriangle} text="No errors recorded" />
        )}
        {filtered.map((e) => (
          <div
            key={e.id}
            className={`rounded-xl bg-white/5 border p-4 ${e.resolved ? "border-white/5 opacity-60" : "border-white/10"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_STYLES[e.source]}`}
                  >
                    {e.source}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${SEVERITY_STYLES[e.severity]}`}
                  >
                    {e.severity}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                    ×{e.count}
                  </span>
                  {e.resolved && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={10} /> resolved
                    </span>
                  )}
                </div>
                <p className="text-sm text-white mt-1 break-words">
                  {e.message}
                </p>
                {e.url && (
                  <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                    {e.url}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500">
                  <span>First: {new Date(e.firstSeen).toLocaleString()}</span>
                  <span>Last: {new Date(e.lastSeen).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <IconBtn
                  title={e.resolved ? "Reopen" : "Resolve"}
                  onClick={() => handleResolve(e)}
                >
                  <CheckCircle2
                    size={15}
                    className={e.resolved ? "text-green-400" : "text-gray-500"}
                  />
                </IconBtn>
              </div>
            </div>
          </div>
        ))}
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
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={12} className={color} />
        <span className="text-[10px] text-gray-500">{label}</span>
      </div>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
