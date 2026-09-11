/**
 * SystemHealthManagerSection — enhanced System Health panel for the Founder
 * Console.
 *
 * Replaces the static, hardcoded inline view with live metrics (recomputed on
 * refresh), real browser performance APIs, a clear-cache developer action,
 * export diagnostics, and a force-reload button.
 */

import { useMemo, useState } from "react";
import {
  Server,
  HardDrive,
  Database,
  Wifi,
  WifiOff,
  Zap,
  Globe,
  Layers,
  RefreshCw,
  Trash2,
  Download,
  Clock,
  Cpu,
} from "lucide-react";

interface Props {
  logAudit?: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

type Status = "healthy" | "warning" | "danger";

export default function SystemHealthManagerSection({ logAudit }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [memory, setMemory] = useState<PerformanceMemory | null>(null);

  const metrics = useMemo(() => {
    // localStorage size
    let lsBytes = 0;
    try {
      lsBytes = JSON.stringify(localStorage).length;
    } catch {
      /* ignore */
    }
    // Largest localStorage keys (top 8)
    const keys: { key: string; kb: number }[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const v = localStorage.getItem(k) || "";
        keys.push({ key: k, kb: v.length / 1024 });
      }
    } catch {
      /* ignore */
    }
    keys.sort((a, b) => b.kb - a.kb);

    // Performance timing
    let loadMs = 0;
    try {
      const nav = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      loadMs = nav ? nav.loadEventEnd - nav.startTime : 0;
    } catch {
      /* ignore */
    }

    let mem: PerformanceMemory | null = null;
    try {
      mem =
        (performance as Performance & { memory?: PerformanceMemory }).memory ||
        null;
      if (mem) setMemory(mem);
    } catch {
      /* ignore */
    }

    return {
      storageUsed: `${(lsBytes / 1024).toFixed(1)} KB`,
      storageKeys: localStorage.length,
      network: navigator.onLine ? "Online" : "Offline",
      netStatus: (navigator.onLine ? "healthy" : "warning") as Status,
      appVersion: "v3.0.0",
      platform: navigator.platform || "unknown",
      language: navigator.language,
      userAgent: navigator.userAgent,
      cores: navigator.hardwareConcurrency || 0,
      loadMs,
      topKeys: keys.slice(0, 8),
      lsBytes,
      memory: mem,
      timestamp: new Date().toISOString(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  interface PerformanceMemory {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  }

  const cards: {
    label: string;
    value: string;
    icon: typeof Server;
    status: Status;
  }[] = [
    {
      label: "Storage Used",
      value: metrics.storageUsed,
      icon: HardDrive,
      status: metrics.lsBytes > 4 * 1024 * 1024 ? "warning" : "healthy",
    },
    {
      label: "Local Storage Keys",
      value: `${metrics.storageKeys}`,
      icon: Database,
      status: "healthy",
    },
    {
      label: "Network",
      value: metrics.network,
      icon: navigator.onLine ? Wifi : WifiOff,
      status: metrics.netStatus,
    },
    {
      label: "App Version",
      value: metrics.appVersion,
      icon: Layers,
      status: "healthy",
    },
    {
      label: "CPU Cores",
      value: `${metrics.cores}`,
      icon: Cpu,
      status: "healthy",
    },
    {
      label: "Platform",
      value: metrics.platform,
      icon: Zap,
      status: "healthy",
    },
    {
      label: "Language",
      value: metrics.language,
      icon: Globe,
      status: "healthy",
    },
    {
      label: "Page Load",
      value: metrics.loadMs ? `${Math.round(metrics.loadMs)} ms` : "—",
      icon: Clock,
      status: metrics.loadMs > 4000 ? "warning" : "healthy",
    },
  ];

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    logAudit?.("System Health Refreshed", "Manual refresh", "info");
  };

  const handleClearCache = () => {
    if (
      !confirm(
        "Clear ALL localStorage data? This includes local caches for stations, fuel config, and console data. Cloud data is NOT affected. Reload the page afterward.",
      )
    )
      return;
    try {
      localStorage.clear();
      logAudit?.(
        "Cache Cleared",
        "All localStorage cleared by founder",
        "warning",
      );
      setRefreshKey((k) => k + 1);
      alert("Local cache cleared. Reloading…");
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      alert(`Clear failed: ${(err as Error).message}`);
    }
  };

  const exportDiagnostics = () => {
    const diag = {
      generatedAt: metrics.timestamp,
      storage: {
        usedBytes: metrics.lsBytes,
        usedKb: metrics.storageUsed,
        keys: metrics.storageKeys,
        topKeys: metrics.topKeys,
      },
      network: { online: navigator.onLine },
      browser: {
        appVersion: metrics.appVersion,
        platform: metrics.platform,
        language: metrics.language,
        userAgent: metrics.userAgent,
        cores: metrics.cores,
      },
      performance: {
        loadMs: metrics.loadMs,
        memory: metrics.memory
          ? {
              usedJSHeapMB: (metrics.memory.usedJSHeapSize / 1048576).toFixed(
                2,
              ),
              totalJSHeapMB: (metrics.memory.totalJSHeapSize / 1048576).toFixed(
                2,
              ),
              limitMB: (metrics.memory.jsHeapSizeLimit / 1048576).toFixed(2),
            }
          : null,
      },
    };
    const blob = new Blob([JSON.stringify(diag, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fuelpro-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logAudit?.("Diagnostics Exported", "System health snapshot", "info");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Server size={18} className="text-amber-400" /> System Health
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Live browser & app diagnostics
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            onClick={exportDiagnostics}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] text-gray-300 text-xs rounded-lg transition-colors border border-white/[0.08]"
          >
            <Download size={13} /> Export Diagnostics
          </button>
          <button
            onClick={handleClearCache}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs rounded-lg transition-colors border border-red-500/20"
          >
            <Trash2 size={13} /> Clear Local Cache
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.label}
              className="bg-[#161618] border border-white/[0.06] rounded-xl p-5"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon
                  size={14}
                  className={
                    m.status === "healthy"
                      ? "text-emerald-400"
                      : m.status === "warning"
                        ? "text-amber-400"
                        : "text-red-400"
                  }
                />
                <span className="text-[11px] text-gray-500">{m.label}</span>
              </div>
              <p className="text-lg font-semibold text-white break-all">
                {m.value}
              </p>
            </div>
          );
        })}
      </div>

      {/* Memory */}
      {memory && (
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <h3 className="text-sm font-medium text-gray-300 mb-3">
            JavaScript Heap Memory
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-gray-500 mb-1">Used</p>
              <p className="text-white font-semibold">
                {(memory.usedJSHeapSize / 1048576).toFixed(2)} MB
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Total</p>
              <p className="text-white font-semibold">
                {(memory.totalJSHeapSize / 1048576).toFixed(2)} MB
              </p>
            </div>
            <div>
              <p className="text-gray-500 mb-1">Limit</p>
              <p className="text-white font-semibold">
                {(memory.jsHeapSizeLimit / 1048576).toFixed(2)} MB
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-gray-300 mb-3">
          Storage Breakdown (top {metrics.topKeys.length})
        </h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {metrics.topKeys.map((k) => (
            <div
              key={k.key}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-gray-400 font-mono truncate max-w-[60%]">
                {k.key}
              </span>
              <span className="text-gray-600">{k.kb.toFixed(2)} KB</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
