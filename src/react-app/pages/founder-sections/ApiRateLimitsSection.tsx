/**
 * ApiRateLimitsSection — cloud-backed, real-time API rate-limit manager.
 * Add endpoints with per-minute + burst limits, toggle enable, delete,
 * reset counters, filter by method/strategy. Current request count shown
 * as progress bar vs limit. Stats: endpoints, enabled, total requests.
 */

import { useMemo, useState } from "react";
import {
  Gauge,
  Plus,
  X,
  Trash2,
  RotateCcw,
  Search,
  Power,
  Activity,
} from "lucide-react";
import type {
  ApiRateLimitEntry,
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

type RateLimitStrategy = ApiRateLimitEntry["strategy"];

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-blue-500/20 text-blue-400",
  POST: "bg-green-500/20 text-green-400",
  PUT: "bg-amber-500/20 text-amber-400",
  PATCH: "bg-purple-500/20 text-purple-400",
  DELETE: "bg-red-500/20 text-red-400",
};

const STRATEGY_STYLES: Record<RateLimitStrategy, string> = {
  fixed: "bg-gray-500/20 text-gray-400",
  sliding: "bg-blue-500/20 text-blue-400",
  "token-bucket": "bg-purple-500/20 text-purple-400",
  "leaky-bucket": "bg-cyan-500/20 text-cyan-400",
};

const STRATEGY_LABELS: Record<RateLimitStrategy, string> = {
  fixed: "fixed-window",
  sliding: "sliding-window",
  "token-bucket": "token-bucket",
  "leaky-bucket": "leaky-bucket",
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const STRATEGIES: RateLimitStrategy[] = [
  "fixed",
  "sliding",
  "token-bucket",
  "leaky-bucket",
];

export default function ApiRateLimitsSection({ store, logAudit }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMethod, setFilterMethod] = useState<string>("all");
  const [filterStrategy, setFilterStrategy] = useState<string>("all");
  const [endpoint, setEndpoint] = useState("");
  const [method, setMethod] = useState("GET");
  const [limitPerMin, setLimitPerMin] = useState(100);
  const [burstLimit, setBurstLimit] = useState(20);
  const [strategy, setStrategy] = useState<RateLimitStrategy>("sliding");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return store.apiRateLimits.filter((r) => {
      const matchesQ = !q || r.endpoint.toLowerCase().includes(q);
      const matchesMethod = filterMethod === "all" || r.method === filterMethod;
      const matchesStrategy =
        filterStrategy === "all" || r.strategy === filterStrategy;
      return matchesQ && matchesMethod && matchesStrategy;
    });
  }, [store.apiRateLimits, search, filterMethod, filterStrategy]);

  const stats = useMemo(() => {
    const total = store.apiRateLimits.length;
    const enabled = store.apiRateLimits.filter((r) => r.enabled).length;
    const requests = store.apiRateLimits.reduce(
      (sum, r) => sum + r.currentCount,
      0,
    );
    return { total, enabled, requests };
  }, [store.apiRateLimits]);

  const reset = () => {
    setEndpoint("");
    setMethod("GET");
    setLimitPerMin(100);
    setBurstLimit(20);
    setStrategy("sliding");
  };

  const add = () => {
    if (!endpoint.trim()) return;
    store.upsertRateLimit({
      id: store.uid(),
      endpoint: endpoint.trim(),
      method,
      limitPerMin,
      windowMs: 60_000,
      burstLimit,
      strategy,
      enabled: true,
      currentCount: 0,
      topIps: [],
      updatedAt: new Date().toISOString(),
    });
    logAudit("Rate Limit Added", `${method} ${endpoint.trim()}`, "success");
    reset();
    setShowAdd(false);
  };

  const handleToggle = (r: ApiRateLimitEntry) => {
    store.toggleRateLimit(r.id);
    logAudit(
      "Rate Limit Toggled",
      `${r.method} ${r.endpoint} -> ${!r.enabled ? "enabled" : "disabled"}`,
      !r.enabled ? "success" : "warning",
    );
  };

  const handleDelete = (r: ApiRateLimitEntry) => {
    if (!confirm(`Delete rate limit for ${r.method} ${r.endpoint}?`)) return;
    store.deleteRateLimit(r.id);
    logAudit("Rate Limit Deleted", `${r.method} ${r.endpoint}`, "warning");
  };

  const handleResetCounters = () => {
    if (!confirm("Reset all rate-limit counters to zero?")) return;
    store.resetRateCounters();
    logAudit("Rate Counters Reset", "All endpoints reset", "info");
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Gauge}
        title="API Rate Limits"
        subtitle="Per-endpoint throttling — real-time synced across devices"
        count={store.apiRateLimits.length}
      />

      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Total Endpoints"
          value={stats.total}
          color="text-gray-100"
        />
        <StatCard
          label="Enabled"
          value={stats.enabled}
          color="text-green-400"
        />
        <StatCard
          label="Current Requests"
          value={stats.requests}
          color="text-amber-400"
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
            placeholder="Search endpoints..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={filterMethod}
          onChange={(e) => setFilterMethod(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All methods</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={filterStrategy}
          onChange={(e) => setFilterStrategy(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All strategies</option>
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {STRATEGY_LABELS[s]}
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
          <Plus size={16} /> Add Endpoint
        </button>
        <button
          onClick={handleResetCounters}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm border border-white/10"
        >
          <RotateCcw size={16} /> Reset Counters
        </button>
      </div>

      {showAdd && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              Add Rate-Limited Endpoint
            </h3>
            <button
              onClick={() => setShowAdd(false)}
              className="text-gray-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Method">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="Endpoint">
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="/api/v1/users"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white font-mono"
                />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Limit / min">
              <input
                type="number"
                value={limitPerMin}
                onChange={(e) => setLimitPerMin(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Burst limit">
              <input
                type="number"
                value={burstLimit}
                onChange={(e) => setBurstLimit(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              />
            </Field>
            <Field label="Strategy">
              <select
                value={strategy}
                onChange={(e) =>
                  setStrategy(e.target.value as RateLimitStrategy)
                }
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
              >
                {STRATEGIES.map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABELS[s]}
                  </option>
                ))}
              </select>
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
              onClick={add}
              className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState
            icon={Gauge}
            text="No rate-limited endpoints configured"
          />
        )}
        {filtered.map((r) => {
          const pct =
            r.limitPerMin === 0
              ? 0
              : Math.min(100, (r.currentCount / r.limitPerMin) * 100);
          const near = pct >= 80;
          return (
            <div
              key={r.id}
              className="rounded-xl bg-white/5 border border-white/10 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${METHOD_STYLES[r.method] ?? "bg-gray-500/20 text-gray-400"}`}
                    >
                      {r.method}
                    </span>
                    <span className="text-sm font-medium text-white font-mono truncate">
                      {r.endpoint}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${STRATEGY_STYLES[r.strategy]}`}
                    >
                      {STRATEGY_LABELS[r.strategy]}
                    </span>
                    {r.enabled ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400" />{" "}
                        enabled
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-500">
                        disabled
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2 max-w-sm">
                    <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full transition-all ${near ? "bg-red-500" : "bg-amber-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-gray-400 font-mono whitespace-nowrap">
                      {r.currentCount}/{r.limitPerMin} /min
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                    <span>Burst: {r.burstLimit}</span>
                    {r.lastHitAt && (
                      <span>
                        Last hit: {new Date(r.lastHitAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {r.topIps && r.topIps.length > 0 && (
                    <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                      <Activity size={10} className="text-gray-500" />
                      {r.topIps.slice(0, 5).map((ip, idx) => (
                        <span
                          key={idx}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono"
                        >
                          {store.maskValue(ip, 2)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconBtn
                    title={r.enabled ? "Disable" : "Enable"}
                    onClick={() => handleToggle(r)}
                  >
                    <Power
                      size={15}
                      className={r.enabled ? "text-green-400" : "text-gray-500"}
                    />
                  </IconBtn>
                  <IconBtn title="Delete" onClick={() => handleDelete(r)}>
                    <Trash2 size={15} className="text-red-400" />
                  </IconBtn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
