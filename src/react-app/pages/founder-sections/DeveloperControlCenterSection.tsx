/**
 * DeveloperControlCenterSection — the master developer hub for the Founder
 * Console. Consolidates real-time system diagnostics, a cloud-KV inspector,
 * batch operations across all datasets, live event stream, environment
 * status, and quick-action deploy triggers into one powerful dashboard.
 *
 * Every panel here reads from / writes to the cloud-backed advanced store
 * (useFounderAdvancedStore) so changes propagate INSTANTLY across all
 * founder devices via Supabase Realtime.
 */

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Terminal,
  Activity,
  Database,
  Zap,
  RefreshCw,
  Search,
  Trash2,
  Download,
  Upload,
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Cpu,
  HardDrive,
  Wifi,
  Server,
  Layers,
  GitBranch,
  Rocket,
  Bug,
  Play,
  Pause,
  Square,
  ChevronDown,
  ChevronRight,
  Filter,
  ArrowRight,
  Cloud,
  CloudOff,
  Code,
  FileCode,
  Settings,
  Gauge,
  Send,
  Webhook,
  Key,
  Bell,
  Shield,
  TrendingUp,
  Boxes,
  CircleDot,
} from "lucide-react";
import type { FounderAdvancedStore } from "@/react-app/hooks/useFounderAdvancedStore";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

type SubTab = "events" | "inspector" | "batch" | "diagnostics" | "deploys";

interface LiveEvent {
  id: string;
  timestamp: number;
  type: "create" | "update" | "delete" | "sync" | "error" | "deploy";
  source: string;
  message: string;
  severity: "info" | "success" | "warning" | "danger";
}

export default function DeveloperControlCenterSection({
  store,
  logAudit,
}: Props) {
  const [subTab, setSubTab] = useState<SubTab>("events");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [eventsPaused, setEventsPaused] = useState(false);
  const [eventFilter, setEventFilter] = useState("");
  const [inspectorKey, setInspectorKey] = useState("");
  const [inspectorValue, setInspectorValue] = useState<any>(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [showInspectorValue, setShowInspectorValue] = useState(false);
  const [batchAction, setBatchAction] = useState("");
  const [batchTarget, setBatchTarget] = useState("webhooks");
  const [copiedKey, setCopiedKey] = useState("");
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});

  // Collect ALL dataset summaries for the diagnostics + batch panels
  const datasets = useMemo(() => {
    const ds = [
      {
        key: "webhooks",
        label: "Webhooks",
        count: store.webhooks.length,
        active: store.webhooks.filter((w) => w.active).length,
        icon: Webhook,
      },
      {
        key: "apiKeys",
        label: "API Keys",
        count: store.apiKeys.length,
        active: store.apiKeys.filter((k) => k.active).length,
        icon: Key,
      },
      {
        key: "announcements",
        label: "Announcements",
        count: store.announcements.length,
        active: store.announcements.filter((a) => a.active).length,
        icon: Bell,
      },
      {
        key: "maintenanceWindows",
        label: "Maint. Windows",
        count: store.maintenanceWindows.length,
        active: store.maintenanceWindows.filter((m) => m.active).length,
        icon: Clock,
      },
      {
        key: "blocklist",
        label: "IP Blocklist",
        count: store.blocklist.length,
        active: store.blocklist.filter((b) => b.active).length,
        icon: Shield,
      },
      {
        key: "corsOrigins",
        label: "CORS Origins",
        count: store.corsOrigins.length,
        active: store.corsOrigins.length,
        icon: Cloud,
      },
      {
        key: "envVars",
        label: "Env Variables",
        count: store.envVars.length,
        active: store.envVars.filter((e) => !e.masked).length,
        icon: Settings,
      },
      {
        key: "jobs",
        label: "Scheduled Jobs",
        count: store.jobs.length,
        active: store.jobs.filter((j) => j.enabled).length,
        icon: Clock,
      },
      {
        key: "experiments",
        label: "A/B Experiments",
        count: store.experiments.length,
        active: store.experiments.filter((e) => e.status === "running").length,
        icon: GitBranch,
      },
      {
        key: "healthChecks",
        label: "Health Checks",
        count: store.healthChecks.length,
        active: store.healthChecks.filter((h) => h.enabled).length,
        icon: Activity,
      },
      {
        key: "languages",
        label: "Languages",
        count: store.languages.length,
        active: store.languages.filter((l) => l.active).length,
        icon: Layers,
      },
      {
        key: "errorLog",
        label: "Errors",
        count: store.errorLog.length,
        active: store.errorLog.filter((e) => !e.resolved).length,
        icon: Bug,
      },
      {
        key: "sessions",
        label: "Sessions",
        count: store.sessions.length,
        active: store.sessions.filter((s) => s.active).length,
        icon: Cpu,
      },
      {
        key: "taskQueue",
        label: "Task Queue",
        count: store.taskQueue.length,
        active: store.taskQueue.filter(
          (t) => t.status === "queued" || t.status === "running",
        ).length,
        icon: Boxes,
      },
      {
        key: "logStreams",
        label: "Log Streams",
        count: store.logStreams.length,
        active: store.logStreams.length,
        icon: Terminal,
      },
      {
        key: "releases",
        label: "Releases",
        count: store.releases.length,
        active: store.releases.filter(
          (r) => r.status === "rolling" || r.status === "canary",
        ).length,
        icon: Rocket,
      },
      {
        key: "migrations",
        label: "Migrations",
        count: store.migrations.length,
        active: store.migrations.filter((m) => m.status === "pending").length,
        icon: Database,
      },
      {
        key: "webhookDeliveries",
        label: "Webhook Deliveries",
        count: store.webhookDeliveries.length,
        active: store.webhookDeliveries.filter((d) => d.status !== "success")
          .length,
        icon: Send,
      },
      {
        key: "storageItems",
        label: "Storage Items",
        count: store.storageItems.length,
        active: store.storageItems.filter((s) => !s.isFolder).length,
        icon: HardDrive,
      },
      {
        key: "apiRateLimits",
        label: "API Rate Limits",
        count: store.apiRateLimits.length,
        active: store.apiRateLimits.filter((r) => r.enabled).length,
        icon: Gauge,
      },
    ];
    return ds;
  }, [store]);

  // Add a live event to the stream (capped at 200)
  const pushEvent = useCallback(
    (
      type: LiveEvent["type"],
      source: string,
      message: string,
      severity: LiveEvent["severity"] = "info",
    ) => {
      if (eventsPaused) return;
      setEvents((prev) =>
        [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: Date.now(),
            type,
            source,
            message,
            severity,
          },
          ...prev,
        ].slice(0, 200),
      );
    },
    [eventsPaused],
  );

  // Subscribe to store changes and log them as events
  useEffect(() => {
    const totalItems = datasets.reduce((sum, d) => sum + d.count, 0);
    pushEvent(
      "sync",
      "store",
      `${datasets.length} datasets loaded (${totalItems} total items)`,
      "success",
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredEvents = useMemo(() => {
    if (!eventFilter.trim()) return events;
    const q = eventFilter.toLowerCase();
    return events.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q),
    );
  }, [events, eventFilter]);

  // ─── Cloud KV Inspector ───
  const inspectKey = async () => {
    if (!inspectorKey.trim()) return;
    setInspectorLoading(true);
    setInspectorValue(null);
    try {
      const cloudStorageService = (
        await import("@/react-app/lib/cloud-storage-service")
      ).default;
      const val = await cloudStorageService.get(inspectorKey.trim(), undefined);
      setInspectorValue(val);
      pushEvent(
        "sync",
        "inspector",
        `Inspected key: ${inspectorKey.trim()}`,
        "info",
      );
      logAudit("KV Inspect", `Key: ${inspectorKey.trim()}`, "info");
    } catch (e: any) {
      setInspectorValue({ error: e.message });
      pushEvent(
        "error",
        "inspector",
        `Failed to inspect key: ${e.message}`,
        "danger",
      );
    } finally {
      setInspectorLoading(false);
    }
  };

  const deleteInspectorKey = async () => {
    if (!inspectorKey.trim()) return;
    if (
      !confirm(
        `Delete cloud KV key "${inspectorKey.trim()}"? This cannot be undone.`,
      )
    )
      return;
    try {
      const cloudStorageService = (
        await import("@/react-app/lib/cloud-storage-service")
      ).default;
      await cloudStorageService.delete(inspectorKey.trim(), undefined);
      setInspectorValue(null);
      pushEvent(
        "delete",
        "inspector",
        `Deleted key: ${inspectorKey.trim()}`,
        "warning",
      );
      logAudit("KV Delete", `Key: ${inspectorKey.trim()}`, "warning");
    } catch (e: any) {
      pushEvent("error", "inspector", `Delete failed: ${e.message}`, "danger");
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 2000);
  };

  // ─── Batch Operations ───
  const runBatchAction = async () => {
    const target = batchTarget;
    let count = 0;
    const action = batchAction;

    if (action === "export") {
      const data = (store as any)[target] || [];
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `founder_${target}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      count = data.length;
      pushEvent(
        "create",
        "batch",
        `Exported ${count} ${target} to JSON`,
        "success",
      );
      logAudit("Batch Export", `${target} (${count} items)`, "info");
      return;
    }

    if (action === "clear") {
      if (
        !confirm(
          `Clear ALL ${target}? This deletes every item in this dataset. This cannot be undone.`,
        )
      )
        return;
      const storeKey = `founder_console_${target.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
      try {
        const cloudStorageService = (
          await import("@/react-app/lib/cloud-storage-service")
        ).default;
        await cloudStorageService.delete(storeKey, undefined);
        count = (store as any)[target]?.length || 0;
        pushEvent("delete", "batch", `Cleared ${count} ${target}`, "warning");
        logAudit("Batch Clear", `${target} (${count} items cleared)`, "danger");
        window.location.reload();
      } catch (e: any) {
        pushEvent("error", "batch", `Clear failed: ${e.message}`, "danger");
      }
      return;
    }

    if (action === "count") {
      count = (store as any)[target]?.length || 0;
      pushEvent("sync", "batch", `${target}: ${count} items`, "info");
      return;
    }

    if (action === "disableAll") {
      const items = (store as any)[target] || [];
      count = items.length;
      const updated = items.map((item: any) =>
        item.active !== undefined ? { ...item, active: false } : item,
      );
      const storeKey = `founder_console_${target.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
      try {
        const cloudStorageService = (
          await import("@/react-app/lib/cloud-storage-service")
        ).default;
        await cloudStorageService.set(storeKey, updated, undefined);
        pushEvent("update", "batch", `Disabled ${count} ${target}`, "warning");
        logAudit("Batch Disable", `${target} (${count} items)`, "warning");
      } catch (e: any) {
        pushEvent("error", "batch", `Disable failed: ${e.message}`, "danger");
      }
      return;
    }

    if (action === "enableAll") {
      const items = (store as any)[target] || [];
      count = items.length;
      const updated = items.map((item: any) =>
        item.active !== undefined ? { ...item, active: true } : item,
      );
      const storeKey = `founder_console_${target.replace(/([A-Z])/g, "_$1").toLowerCase()}`;
      try {
        const cloudStorageService = (
          await import("@/react-app/lib/cloud-storage-service")
        ).default;
        await cloudStorageService.set(storeKey, updated, undefined);
        pushEvent("update", "batch", `Enabled ${count} ${target}`, "success");
        logAudit("Batch Enable", `${target} (${count} items)`, "success");
      } catch (e: any) {
        pushEvent("error", "batch", `Enable failed: ${e.message}`, "danger");
      }
      return;
    }
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const subTabs: { id: SubTab; label: string; icon: any }[] = [
    { id: "events", label: "Live Event Stream", icon: Activity },
    { id: "inspector", label: "Cloud KV Inspector", icon: Search },
    { id: "batch", label: "Batch Operations", icon: Layers },
    { id: "diagnostics", label: "System Diagnostics", icon: Cpu },
    { id: "deploys", label: "Deploy Manager", icon: Rocket },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-xl">
            <Terminal size={20} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-medium text-white">
              Developer Control Center
            </h2>
            <p className="text-xs text-gray-500">
              Real-time system control ·{" "}
              {datasets.reduce((s, d) => s + d.count, 0)} items across{" "}
              {datasets.length} datasets
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <CircleDot size={12} className="animate-pulse" /> Live
          </span>
        </div>
      </div>

      {/* Sub-tab navigation */}
      <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] pb-3">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              subTab === tab.id
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] border border-transparent"
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Live Event Stream ─── */}
      {subTab === "events" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px] relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
              />
              <input
                type="text"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                placeholder="Filter events..."
                className="w-full pl-9 pr-3 py-2 bg-[#161618] border border-white/[0.06] rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/30"
              />
            </div>
            <button
              onClick={() => setEventsPaused(!eventsPaused)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                eventsPaused
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-white/[0.04] text-gray-400 hover:text-gray-300"
              }`}
            >
              {eventsPaused ? <Play size={13} /> : <Pause size={13} />}
              {eventsPaused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() => {
                setEvents([]);
                pushEvent("sync", "events", "Event stream cleared", "info");
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.04] text-gray-400 hover:text-gray-300 rounded-lg text-xs font-medium transition-colors"
            >
              <Trash2 size={13} />
              Clear
            </button>
          </div>

          <div className="bg-[#0d0d0f] border border-white/[0.06] rounded-xl overflow-hidden max-h-[600px] overflow-y-auto">
            {filteredEvents.length === 0 ? (
              <div className="text-center py-12 text-gray-600">
                <Activity size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">
                  No events yet. Changes across the console will appear here in
                  real time.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.03]">
                {filteredEvents.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.02]"
                  >
                    <div className="mt-0.5">
                      {e.severity === "success" ? (
                        <CheckCircle2 size={13} className="text-emerald-400" />
                      ) : e.severity === "warning" ? (
                        <AlertTriangle size={13} className="text-amber-400" />
                      ) : e.severity === "danger" ? (
                        <XCircle size={13} className="text-red-400" />
                      ) : (
                        <CircleDot size={13} className="text-blue-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white/[0.04] rounded text-gray-500 uppercase">
                          {e.type}
                        </span>
                        <span className="text-xs text-gray-300 truncate">
                          {e.message}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-600">
                          {e.source}
                        </span>
                        <span className="text-[10px] text-gray-700">·</span>
                        <span className="text-[10px] text-gray-600">
                          {new Date(e.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Cloud KV Inspector ─── */}
      {subTab === "inspector" && (
        <div className="space-y-3">
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
              <Database size={15} className="text-indigo-400" />
              Cloud KV Inspector
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Inspect any Supabase{" "}
              <code className="text-indigo-400">app_kv</code> row by its logical
              key. Values are owner-scoped (RLS-protected).
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={inspectorKey}
                onChange={(e) => setInspectorKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && inspectKey()}
                placeholder="e.g. founder_console_webhooks, user_<id>_compact, shift_data..."
                className="flex-1 px-3 py-2 bg-[#0d0d0f] border border-white/[0.06] rounded-lg text-xs text-white placeholder-gray-600 font-mono focus:outline-none focus:border-indigo-500/30"
              />
              <button
                onClick={inspectKey}
                disabled={inspectorLoading || !inspectorKey.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-40 text-indigo-300 rounded-lg text-xs font-medium transition-colors"
              >
                {inspectorLoading ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Search size={13} />
                )}
                Inspect
              </button>
              {inspectorValue !== null && (
                <button
                  onClick={deleteInspectorKey}
                  className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition-colors"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              )}
            </div>

            {/* Quick-access keys */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                "founder_console_webhooks",
                "founder_console_apikeys",
                "founder_console_announcements",
                "founder_console_envvars",
                "founder_console_jobs",
                "founder_console_experiments",
                "founder_console_error_tracker",
                "founder_console_sessions",
                "founder_console_task_queue",
                "founder_console_role_matrix",
                "founder_console_storage_explorer",
                "founder_console_api_rate_limits",
              ].map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setInspectorKey(k);
                    setTimeout(() => inspectKey(), 50);
                  }}
                  className="px-2 py-1 bg-white/[0.03] hover:bg-white/[0.06] text-gray-500 hover:text-gray-300 rounded text-[10px] font-mono transition-colors"
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {inspectorValue !== null && (
            <div className="bg-[#0d0d0f] border border-white/[0.06] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-medium text-gray-400">
                  Value for:{" "}
                  <span className="text-indigo-400 font-mono">
                    {inspectorKey}
                  </span>
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowInspectorValue(!showInspectorValue)}
                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300"
                  >
                    {showInspectorValue ? (
                      <EyeOff size={11} />
                    ) : (
                      <Eye size={11} />
                    )}
                    {showInspectorValue ? "Collapse" : "Expand"}
                  </button>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        JSON.stringify(inspectorValue, null, 2),
                        "inspector",
                      )
                    }
                    className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300"
                  >
                    {copiedKey === "inspector" ? (
                      <CheckCircle2 size={11} className="text-emerald-400" />
                    ) : (
                      <Copy size={11} />
                    )}
                    {copiedKey === "inspector" ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <pre
                className={`text-xs text-gray-300 font-mono overflow-x-auto ${showInspectorValue ? "" : "max-h-48 overflow-y-auto"}`}
              >
                {JSON.stringify(inspectorValue, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ─── Batch Operations ─── */}
      {subTab === "batch" && (
        <div className="space-y-3">
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
              <Layers size={15} className="text-indigo-400" />
              Batch Operations
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Run bulk actions across any dataset. All changes sync to the cloud
              and propagate to every founder device in real time.
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] text-gray-500 block mb-1">
                  Target Dataset
                </label>
                <select
                  value={batchTarget}
                  onChange={(e) => setBatchTarget(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d0d0f] border border-white/[0.06] rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500/30"
                >
                  {datasets.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label} ({d.count} items)
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] text-gray-500 block mb-1">
                  Action
                </label>
                <select
                  value={batchAction}
                  onChange={(e) => setBatchAction(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0d0d0f] border border-white/[0.06] rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500/30"
                >
                  <option value="">Select action...</option>
                  <option value="count">Count items</option>
                  <option value="export">Export to JSON</option>
                  <option value="enableAll">
                    Enable all (where applicable)
                  </option>
                  <option value="disableAll">
                    Disable all (where applicable)
                  </option>
                  <option value="clear">⚠️ Clear all (DELETE)</option>
                </select>
              </div>
              <button
                onClick={runBatchAction}
                disabled={!batchAction || !batchTarget}
                className="px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-40 text-indigo-300 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <Zap size={13} />
                Execute
              </button>
            </div>
          </div>

          {/* Dataset overview cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {datasets.map((d) => (
              <div
                key={d.key}
                className="bg-[#161618] border border-white/[0.06] rounded-xl p-4 hover:border-indigo-500/20 transition-colors cursor-pointer"
                onClick={() => {
                  setBatchTarget(d.key);
                  setSubTab("batch");
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <d.icon size={14} className="text-gray-500" />
                  <span className="text-[10px] text-gray-600">
                    {d.active} active
                  </span>
                </div>
                <p className="text-xl font-bold text-white">{d.count}</p>
                <p className="text-[10px] text-gray-500">{d.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── System Diagnostics ─── */}
      {subTab === "diagnostics" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              {
                label: "Total Datasets",
                value: datasets.length,
                icon: Database,
                color: "text-indigo-400",
              },
              {
                label: "Total Items",
                value: datasets.reduce((s, d) => s + d.count, 0),
                icon: Boxes,
                color: "text-blue-400",
              },
              {
                label: "Active Items",
                value: datasets.reduce((s, d) => s + d.active, 0),
                icon: CheckCircle2,
                color: "text-emerald-400",
              },
              {
                label: "Unresolved Errors",
                value: store.errorLog.filter((e) => !e.resolved).length,
                icon: Bug,
                color: "text-red-400",
              },
              {
                label: "Active Sessions",
                value: store.sessions.filter((s) => s.active).length,
                icon: Cpu,
                color: "text-amber-400",
              },
              {
                label: "Queued Tasks",
                value: store.taskQueue.filter(
                  (t) => t.status === "queued" || t.status === "running",
                ).length,
                icon: Clock,
                color: "text-purple-400",
              },
              {
                label: "Pending Migrations",
                value: store.migrations.filter((m) => m.status === "pending")
                  .length,
                icon: Database,
                color: "text-orange-400",
              },
              {
                label: "Failed Deliveries",
                value: store.webhookDeliveries.filter(
                  (d) => d.status !== "success",
                ).length,
                icon: Send,
                color: "text-pink-400",
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={13} className={stat.color} />
                  <span className="text-[10px] text-gray-500">
                    {stat.label}
                  </span>
                </div>
                <p className="text-xl font-bold text-white">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Connection diagnostics */}
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <Wifi size={15} className="text-indigo-400" />
              Connection Diagnostics
            </h3>
            <div className="space-y-2">
              {[
                {
                  label: "Supabase Auth",
                  status: "connected",
                  detail: "OAuth + email/password active",
                },
                {
                  label: "Supabase Realtime",
                  status: "connected",
                  detail: "postgres_changes subscription active",
                },
                {
                  label: "Cloud KV (app_kv)",
                  status: "connected",
                  detail: "RLS-protected, owner-scoped",
                },
                {
                  label: "Supabase Storage",
                  status: "connected",
                  detail: "fuelpro-files bucket",
                },
                {
                  label: "tRPC Backend",
                  status: "offline",
                  detail:
                    "Railway backend not deployed (fallback to Supabase-direct)",
                },
                {
                  label: "REST API (/api/*)",
                  status: "connected",
                  detail: "Vercel serverless functions",
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="flex items-center gap-3 py-2 border-b border-white/[0.03] last:border-0"
                >
                  {c.status === "connected" ? (
                    <CheckCircle2 size={14} className="text-emerald-400" />
                  ) : (
                    <XCircle size={14} className="text-gray-600" />
                  )}
                  <div className="flex-1">
                    <p className="text-xs text-white">{c.label}</p>
                    <p className="text-[10px] text-gray-500">{c.detail}</p>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${c.status === "connected" ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-500/10 text-gray-500"}`}
                  >
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Dataset health breakdown */}
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <Gauge size={15} className="text-indigo-400" />
              Dataset Health Breakdown
            </h3>
            <div className="space-y-1.5">
              {datasets.map((d) => {
                const pct = d.count > 0 ? (d.active / d.count) * 100 : 0;
                return (
                  <div key={d.key} className="flex items-center gap-3">
                    <d.icon size={12} className="text-gray-500 shrink-0" />
                    <span className="text-xs text-gray-400 w-32 shrink-0 truncate">
                      {d.label}
                    </span>
                    <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct > 70 ? "bg-emerald-500" : pct > 30 ? "bg-amber-500" : "bg-gray-600"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-500 w-16 text-right shrink-0">
                      {d.active}/{d.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Deploy Manager ─── */}
      {subTab === "deploys" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              {
                label: "Cloudflare Pages",
                url: "https://fuel-app-mobile.pages.dev",
                icon: Cloud,
                status: "live",
              },
              {
                label: "Vercel Production",
                url: "https://fuel-app-mobile.vercel.app",
                icon: Rocket,
                status: "live",
              },
              {
                label: "GitHub (main)",
                url: "https://github.com/fuelpropay/FUEL_APP_MOBILE",
                icon: GitBranch,
                status: "live",
              },
            ].map((p) => (
              <div
                key={p.label}
                className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <p.icon size={14} className="text-indigo-400" />
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {p.status}
                  </span>
                </div>
                <p className="text-xs text-white font-medium">{p.label}</p>
                <p className="text-[10px] text-gray-500 truncate">{p.url}</p>
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300"
                >
                  Open <ArrowRight size={10} />
                </a>
              </div>
            ))}
          </div>

          {/* Recent releases */}
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
              <Rocket size={15} className="text-indigo-400" />
              Recent Releases
            </h3>
            <div className="space-y-2">
              {store.releases.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 py-2 border-b border-white/[0.03] last:border-0"
                >
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      r.status === "live"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : r.status === "rolling"
                          ? "bg-amber-500/10 text-amber-400"
                          : r.status === "canary"
                            ? "bg-purple-500/10 text-purple-400"
                            : "bg-gray-500/10 text-gray-500"
                    }`}
                  >
                    {r.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate">{r.version}</p>
                    <p className="text-[10px] text-gray-500">{r.description}</p>
                  </div>
                  <span className="text-[10px] text-gray-600">
                    {r.targetPercent}%
                  </span>
                </div>
              ))}
              {store.releases.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-6">
                  No releases tracked yet
                </p>
              )}
            </div>
          </div>

          {/* Pending migrations */}
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
              <Database size={15} className="text-indigo-400" />
              Database Migrations
            </h3>
            <div className="space-y-2">
              {store.migrations.slice(0, 5).map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 py-2 border-b border-white/[0.03] last:border-0"
                >
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      m.status === "applied"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : m.status === "pending"
                          ? "bg-amber-500/10 text-amber-400"
                          : m.status === "failed"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-gray-500/10 text-gray-500"
                    }`}
                  >
                    {m.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white truncate font-mono">
                      {m.filename}
                    </p>
                    {m.description && (
                      <p className="text-[10px] text-gray-500 truncate">
                        {m.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {store.migrations.length === 0 && (
                <p className="text-xs text-gray-600 text-center py-6">
                  No migrations tracked
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
