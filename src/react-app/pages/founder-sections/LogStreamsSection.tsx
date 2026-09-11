/**
 * LogStreamsSection — cloud-backed, real-time log stream viewer.
 * Manual log entry, filter by level/source, collapsible metadata,
 * newest-first ordering, real-time indicator, clear logs, and export
 * to .log file via Blob download.
 */

import { useMemo, useState } from "react";
import {
  Terminal,
  Plus,
  X,
  Search,
  Trash2,
  Download,
  ChevronDown,
  ChevronRight,
  Radio,
} from "lucide-react";
import type {
  LogLevel,
  LogSource,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import { SectionHeader, Field, EmptyState } from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: "bg-gray-500/20 text-gray-400",
  info: "bg-blue-500/20 text-blue-400",
  warn: "bg-amber-500/20 text-amber-400",
  error: "bg-red-500/20 text-red-400",
  fatal: "bg-purple-500/20 text-purple-400",
};

const SOURCE_STYLES: Record<LogSource, string> = {
  auth: "bg-cyan-500/20 text-cyan-400",
  api: "bg-blue-500/20 text-blue-400",
  db: "bg-green-500/20 text-green-400",
  realtime: "bg-purple-500/20 text-purple-400",
  storage: "bg-pink-500/20 text-pink-400",
  worker: "bg-amber-500/20 text-amber-400",
  cron: "bg-indigo-500/20 text-indigo-400",
  ui: "bg-gray-500/20 text-gray-400",
};

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];

export default function LogStreamsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [level, setLevel] = useState<LogLevel>("info");
  const [source, setSource] = useState<LogSource>("api");
  const [message, setMessage] = useState("");
  const [metadata, setMetadata] = useState("");
  const [traceId, setTraceId] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return store.logStreams.filter((l) => {
      const matchesQ =
        !q ||
        l.message.toLowerCase().includes(q) ||
        (l.traceId ?? "").toLowerCase().includes(q);
      const matchesLevel = filterLevel === "all" || l.level === filterLevel;
      const matchesSource = filterSource === "all" || l.source === filterSource;
      return matchesQ && matchesLevel && matchesSource;
    });
  }, [store.logStreams, search, filterLevel, filterSource]);

  const stats = useMemo(() => {
    const byLevel = LEVELS.reduce(
      (acc, lv) => {
        acc[lv] = store.logStreams.filter((l) => l.level === lv).length;
        return acc;
      },
      {} as Record<LogLevel, number>,
    );
    return byLevel;
  }, [store.logStreams]);

  const reset = () => {
    setLevel("info");
    setSource("api");
    setMessage("");
    setMetadata("");
    setTraceId("");
  };

  const addLog = () => {
    if (!message.trim()) return;
    store.appendLog({
      level,
      source,
      message: message.trim(),
      metadata: metadata.trim() || undefined,
      traceId: traceId.trim() || undefined,
    });
    logAudit(
      "Log Entry Added",
      `[${level}] ${message.trim().slice(0, 60)}`,
      "info",
    );
    reset();
    setShowAdd(false);
  };

  const handleClear = () => {
    if (store.logStreams.length === 0) return;
    if (!confirm(`Clear all ${store.logStreams.length} log entries?`)) return;
    store.clearLogs();
    logAudit("Logs Cleared", `${store.logStreams.length} entries`, "warning");
  };

  const exportLogs = () => {
    if (filtered.length === 0) return;
    const content = filtered
      .map((l) => {
        const meta = l.metadata ? ` ${l.metadata}` : "";
        const trace = l.traceId ? ` [${l.traceId}]` : "";
        return `${new Date(l.timestamp).toISOString()} [${l.level.toUpperCase()}] [${l.source}]${trace} ${l.message}${meta}`;
      })
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro-logs-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit("Logs Exported", `${filtered.length} entries as .log`, "info");
  };

  const toggleExpand = (id: string) =>
    setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Terminal}
        title="Log Streams"
        subtitle="Live application logs — real-time synced across devices"
        count={store.logStreams.length}
        right={
          <span className="text-[10px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <Radio size={11} /> Live
          </span>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {LEVELS.map((lv) => (
          <div
            key={lv}
            className="bg-white/5 border border-white/10 rounded-xl p-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`w-2 h-2 rounded-full ${LEVEL_STYLES[lv].split(" ")[0]}`}
              />
              <span className="text-[10px] text-gray-500 uppercase">{lv}</span>
            </div>
            <p className="text-lg font-semibold text-white">{stats[lv] ?? 0}</p>
          </div>
        ))}
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
            placeholder="Search messages / trace ids..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All levels</option>
          {LEVELS.map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All sources</option>
          {store.DEFAULT_LOG_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            reset();
            setShowAdd(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
        >
          <Plus size={16} /> Add Log Entry
        </button>
        <button
          onClick={exportLogs}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10"
        >
          <Download size={16} /> Export
        </button>
        <button
          onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm border border-red-500/20"
        >
          <Trash2 size={16} /> Clear
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Add Log Entry</h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Level">
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as LogLevel)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as LogSource)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {store.DEFAULT_LOG_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Message">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Request completed in 42ms"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Trace ID (optional)">
              <input
                value={traceId}
                onChange={(e) => setTraceId(e.target.value)}
                placeholder="abc-123-def"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
            <Field label="Metadata (optional)">
              <input
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                placeholder='{"userId":"u_1"}'
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={addLog}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              Add Entry
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {filtered.length === 0 && (
          <EmptyState icon={Terminal} text="No log entries" />
        )}
        {filtered.map((l) => (
          <div
            key={l.id}
            className="rounded-lg bg-black/30 border border-white/5 p-2.5"
          >
            <div className="flex items-start gap-2">
              <button
                onClick={() => toggleExpand(l.id)}
                className="text-gray-500 hover:text-white mt-0.5 shrink-0"
                title={l.metadata ? "Toggle metadata" : "No metadata"}
              >
                {l.metadata ? (
                  expanded[l.id] ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )
                ) : (
                  <span className="w-3" />
                )}
              </button>
              <span className="text-[11px] text-gray-500 font-mono shrink-0">
                {new Date(l.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase shrink-0 ${LEVEL_STYLES[l.level]}`}
              >
                {l.level}
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${SOURCE_STYLES[l.source]}`}
              >
                {l.source}
              </span>
              {l.traceId && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 font-mono shrink-0">
                  {l.traceId}
                </span>
              )}
              <span className="text-xs text-gray-200 break-words min-w-0">
                {l.message}
              </span>
            </div>
            {expanded[l.id] && l.metadata && (
              <pre className="mt-2 ml-7 text-[10px] text-gray-400 font-mono whitespace-pre-wrap break-words bg-black/40 rounded p-2">
                {l.metadata}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
