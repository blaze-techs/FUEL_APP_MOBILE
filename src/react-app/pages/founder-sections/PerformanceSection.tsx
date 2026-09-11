import { useState, useEffect, useCallback } from "react";
import {
  Zap,
  Gauge,
  Cpu,
  HardDrive,
  Wifi,
  Activity,
  Timer,
  Target,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import {
  initVitalsTracking,
  getVitalsSnapshot,
  checkPerformanceTargets,
  getMemoryUsage,
  type WebVitals,
} from "@/react-app/lib/performance";

const SETTINGS_KEY = "fuelpro_performance_settings";

interface PerfSettings {
  lazyLoad: boolean;
  cacheEnabled: boolean;
  debounceEnabled: boolean;
  skeletonEnabled: boolean;
  monitorEnabled: boolean;
  swEnabled: boolean;
  imageOptimization: boolean;
  prefetchEnabled: boolean;
}

function loadSettings(): PerfSettings {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return {
    lazyLoad: true,
    cacheEnabled: true,
    debounceEnabled: true,
    skeletonEnabled: true,
    monitorEnabled: true,
    swEnabled: true,
    imageOptimization: true,
    prefetchEnabled: false,
  };
}

function saveSettings(s: PerfSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function PerformanceSection({ logAudit }: Props) {
  const [vitals, setVitals] = useState<WebVitals>({});
  const [memory, setMemory] = useState(getMemoryUsage());
  const [settings, setSettings] = useState<PerfSettings>(loadSettings);
  const [resourceCount, setResourceCount] = useState(0);
  const [pageWeight, setPageWeight] = useState(0);
  const [longTasks, setLongTasks] = useState(0);

  useEffect(() => {
    initVitalsTracking((v) => setVitals({ ...v }));
    const res = performance.getEntriesByType("resource");
    setResourceCount(res.length);
    setPageWeight(
      res.reduce(
        (s, r) => s + (r as PerformanceResourceTiming).transferSize,
        0,
      ),
    );

    // Long Task Observer
    if ("PerformanceLongTaskTiming" in window) {
      try {
        new PerformanceObserver((list) => {
          setLongTasks((prev) => prev + list.getEntries().length);
        }).observe({ type: "longtask", buffered: true });
      } catch {
        /* */
      }
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setMemory(getMemoryUsage());
      setVitals(getVitalsSnapshot());
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const targets = checkPerformanceTargets(vitals);
  const allPass = targets.every((t) => t.pass);

  const toggleSetting = useCallback(
    (key: keyof PerfSettings) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        saveSettings(next);
        logAudit(
          "Performance Setting Changed",
          `${key}: ${next[key] ? "enabled" : "disabled"}`,
          "info",
        );
        return next;
      });
    },
    [logAudit],
  );

  const clearCache = useCallback(() => {
    caches
      .keys()
      .then((names) => Promise.all(names.map((n) => caches.delete(n))))
      .then(() => {
        logAudit("Cache Cleared", "All caches cleared", "warning");
      });
  }, [logAudit]);

  const clearPerformanceEntries = useCallback(() => {
    performance.clearResourceTimings();
    setResourceCount(0);
    setPageWeight(0);
    setLongTasks(0);
    logAudit(
      "Performance Entries Cleared",
      "Resource timing entries cleared",
      "info",
    );
  }, [logAudit]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Zap size={18} className="text-yellow-400" /> Performance Center
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Core Web Vitals, memory, and optimization settings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 ${allPass ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}
          >
            {allPass ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {allPass ? "All Targets Met" : "Needs Attention"}
          </span>
        </div>
      </div>

      {/* Core Web Vitals Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {targets.map((t) => (
          <div
            key={t.metric}
            className="bg-[#161618] border border-white/[0.06] rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500">{t.metric}</span>
              {t.pass ? (
                <CheckCircle2 size={12} className="text-emerald-400" />
              ) : (
                <XCircle size={12} className="text-red-400" />
              )}
            </div>
            <p className="text-lg font-bold text-white">
              {t.metric === "CLS"
                ? t.value.toFixed(3)
                : `${Math.round(t.value)}ms`}
            </p>
            <p className="text-[9px] text-gray-600">
              Target: {t.metric === "CLS" ? "< 0.05" : `< ${t.target}ms`}
            </p>
          </div>
        ))}
      </div>

      {/* Resource Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Wifi size={14} className="text-blue-400" />
            <span className="text-[11px] text-gray-500">Page Weight</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {(pageWeight / 1024 / 1024).toFixed(2)} MB
          </p>
          <p className="text-[10px] text-gray-500">
            {resourceCount} resources loaded
          </p>
        </div>
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Cpu size={14} className="text-purple-400" />
            <span className="text-[11px] text-gray-500">Main Thread</span>
          </div>
          <p className="text-2xl font-bold text-white">{longTasks}</p>
          <p className="text-[10px] text-gray-500">Long tasks detected</p>
        </div>
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive size={14} className="text-green-400" />
            <span className="text-[11px] text-gray-500">Memory</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {memory ? `${memory.used} MB` : "N/A"}
          </p>
          <p className="text-[10px] text-gray-500">
            {memory ? `${memory.limit} MB limit` : "Not available"}
          </p>
          {memory && (
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-green-400 rounded-full"
                style={{ width: `${(memory.used / memory.limit) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Optimization Settings */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <Target size={14} className="text-yellow-400" /> Optimization Toggles
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            {
              key: "lazyLoad" as const,
              label: "Lazy Loading",
              desc: "Load components on demand",
              icon: Timer,
            },
            {
              key: "cacheEnabled" as const,
              label: "Cache Strategy",
              desc: "Service worker caching",
              icon: HardDrive,
            },
            {
              key: "debounceEnabled" as const,
              label: "Input Debounce",
              desc: "Debounce search/filters",
              icon: Activity,
            },
            {
              key: "skeletonEnabled" as const,
              label: "Skeleton Screens",
              desc: "Show layout placeholders",
              icon: Zap,
            },
            {
              key: "monitorEnabled" as const,
              label: "Live Monitor",
              desc: "Show vitals overlay",
              icon: Gauge,
            },
            {
              key: "swEnabled" as const,
              label: "Service Worker",
              desc: "Offline support",
              icon: Wifi,
            },
            {
              key: "imageOptimization" as const,
              label: "Image Optim.",
              desc: "Lazy load images",
              icon: Activity,
            },
            {
              key: "prefetchEnabled" as const,
              label: "Prefetch Routes",
              desc: "Preload likely routes",
              icon: Timer,
            },
          ].map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between p-3 bg-white/[0.02] rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center">
                  <s.icon size={14} className="text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-white">{s.label}</p>
                  <p className="text-[10px] text-gray-500">{s.desc}</p>
                </div>
              </div>
              <button
                onClick={() => toggleSetting(s.key)}
                className={`relative w-10 h-5.5 rounded-full transition-colors ${settings[s.key] ? "bg-green-500" : "bg-gray-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${settings[s.key] ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={clearCache}
          className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-lg border border-red-500/20 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw size={12} /> Clear All Caches
        </button>
        <button
          onClick={clearPerformanceEntries}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded-lg transition-colors flex items-center gap-1.5"
        >
          <RotateCcw size={12} /> Reset Timings
        </button>
        <button
          onClick={() => {
            saveSettings(settings);
            logAudit("Settings Saved", "Performance settings saved", "success");
          }}
          className="px-4 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center gap-1.5"
        >
          <Save size={12} /> Save Settings
        </button>
      </div>

      {/* Performance Budget */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-3">
          Performance Budget
        </h3>
        <div className="space-y-3">
          {[
            {
              label: "Total Page Weight",
              current: pageWeight / 1024 / 1024,
              target: 1.2,
              unit: "MB",
            },
            {
              label: "JavaScript Bundle",
              current: (pageWeight * 0.3) / 1024 / 1024,
              target: 0.5,
              unit: "MB",
            },
            {
              label: "CSS Bundle",
              current: (pageWeight * 0.05) / 1024 / 1024,
              target: 0.1,
              unit: "MB",
            },
            {
              label: "Image Assets",
              current: (pageWeight * 0.5) / 1024 / 1024,
              target: 0.6,
              unit: "MB",
            },
          ].map((b) => {
            const pct = Math.min((b.current / b.target) * 100, 100);
            const overBudget = b.current > b.target;
            return (
              <div key={b.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">{b.label}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono ${overBudget ? "text-red-400" : "text-emerald-400"}`}
                    >
                      {b.current.toFixed(2)} {b.unit}
                    </span>
                    <span className="text-gray-600">
                      / {b.target} {b.unit}
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${overBudget ? "bg-red-400" : "bg-emerald-400"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
