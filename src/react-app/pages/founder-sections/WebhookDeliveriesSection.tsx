/**
 * WebhookDeliveriesSection — cloud-backed, real-time webhook delivery log.
 * View delivery attempts (status code, latency, attempt number, error),
 * retry failed deliveries, clear all, expandable request/response bodies.
 * Filter by status with success-rate stats.
 */

import { useMemo, useState } from "react";
import {
  Send,
  Search,
  Trash2,
  RotateCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Loader,
  AlertTriangle,
} from "lucide-react";
import type {
  WebhookDelivery,
  DeliveryStatus,
  FounderAdvancedStore,
} from "@/react-app/hooks/useFounderAdvancedStore";
import { SectionHeader, IconBtn, EmptyState } from "./WebhooksManagerSection";

interface Props {
  store: FounderAdvancedStore;
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

const STATUS_META: Record<
  DeliveryStatus,
  { color: string; icon: React.ReactNode }
> = {
  pending: { color: "bg-gray-500/20 text-gray-400", icon: <Clock size={10} /> },
  success: {
    color: "bg-green-500/20 text-green-400",
    icon: <CheckCircle2 size={10} />,
  },
  failed: { color: "bg-red-500/20 text-red-400", icon: <XCircle size={10} /> },
  retrying: {
    color: "bg-amber-500/20 text-amber-400",
    icon: <Loader size={10} className="animate-spin" />,
  },
  timeout: {
    color: "bg-orange-500/20 text-orange-400",
    icon: <AlertTriangle size={10} />,
  },
};

const STATUSES: DeliveryStatus[] = [
  "pending",
  "success",
  "failed",
  "retrying",
  "timeout",
];

export default function WebhookDeliveriesSection({ store, logAudit }: Props) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return store.webhookDeliveries.filter((d) => {
      const matchesQ =
        !q ||
        d.webhookName.toLowerCase().includes(q) ||
        d.event.toLowerCase().includes(q) ||
        d.url.toLowerCase().includes(q);
      const matchesStatus = filterStatus === "all" || d.status === filterStatus;
      return matchesQ && matchesStatus;
    });
  }, [store.webhookDeliveries, search, filterStatus]);

  const stats = useMemo(() => {
    const total = store.webhookDeliveries.length;
    const success = store.webhookDeliveries.filter(
      (d) => d.status === "success",
    ).length;
    const failed = store.webhookDeliveries.filter(
      (d) => d.status === "failed" || d.status === "timeout",
    ).length;
    const rate = total === 0 ? 0 : Math.round((success / total) * 100);
    return { total, success, failed, rate };
  }, [store.webhookDeliveries]);

  const handleRetry = (d: WebhookDelivery) => {
    store.retryDelivery(d.id);
    logAudit(
      "Delivery Retried",
      `"${d.webhookName}" (${d.event}) attempt ${d.attempt + 1}`,
      "info",
    );
  };

  const handleClear = () => {
    if (store.webhookDeliveries.length === 0) return;
    if (
      !confirm(`Clear all ${store.webhookDeliveries.length} delivery records?`)
    )
      return;
    store.clearDeliveries();
    logAudit(
      "Deliveries Cleared",
      `${store.webhookDeliveries.length} records`,
      "warning",
    );
  };

  const toggleExpand = (id: string) =>
    setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Send}
        title="Webhook Deliveries"
        subtitle="Delivery attempt log — real-time synced across devices"
        count={store.webhookDeliveries.length}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard
          label="Total Deliveries"
          value={stats.total}
          color="text-gray-100"
        />
        <StatCard
          label="Success Rate"
          value={stats.rate}
          suffix="%"
          color="text-green-400"
        />
        <StatCard
          label="Successful"
          value={stats.success}
          color="text-blue-400"
        />
        <StatCard label="Failed" value={stats.failed} color="text-red-400" />
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
            placeholder="Search by webhook, event, url..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm border border-red-500/20"
        >
          <Trash2 size={16} /> Clear All
        </button>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <EmptyState icon={Send} text="No delivery records" />
        )}
        {filtered.map((d) => {
          const meta = STATUS_META[d.status];
          return (
            <div
              key={d.id}
              className="rounded-xl bg-white/5 border border-white/10 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {d.webhookName}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">
                      {d.event}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${meta.color}`}
                    >
                      {meta.icon}
                      {d.status}
                    </span>
                    {d.statusCode !== undefined && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${d.statusCode >= 200 && d.statusCode < 300 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}
                      >
                        {d.statusCode}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                      attempt #{d.attempt}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                    {d.url}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-500 flex-wrap">
                    <span>Queued: {new Date(d.queuedAt).toLocaleString()}</span>
                    {d.deliveredAt && (
                      <span>
                        Delivered: {new Date(d.deliveredAt).toLocaleString()}
                      </span>
                    )}
                    {d.latencyMs !== undefined && (
                      <span>Latency: {d.latencyMs}ms</span>
                    )}
                    {d.nextRetryAt && (
                      <span>
                        Next retry: {new Date(d.nextRetryAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {d.errorMessage && (
                    <p className="text-[11px] text-red-400 mt-1 flex items-center gap-1">
                      <AlertTriangle size={11} /> {d.errorMessage}
                    </p>
                  )}
                  {(d.requestBody || d.responseBody) && (
                    <button
                      onClick={() => toggleExpand(d.id)}
                      className="mt-1.5 text-[10px] text-gray-400 hover:text-white flex items-center gap-1"
                    >
                      {expanded[d.id] ? (
                        <ChevronDown size={11} />
                      ) : (
                        <ChevronRight size={11} />
                      )}
                      {expanded[d.id] ? "Hide" : "Show"} request/response
                    </button>
                  )}
                  {expanded[d.id] && (d.requestBody || d.responseBody) && (
                    <div className="mt-2 space-y-2">
                      {d.requestBody && (
                        <div>
                          <p className="text-[9px] text-gray-500 uppercase mb-0.5">
                            Request body
                          </p>
                          <pre className="text-[10px] text-gray-400 font-mono whitespace-pre-wrap break-words bg-black/40 rounded p-2">
                            {d.requestBody}
                          </pre>
                        </div>
                      )}
                      {d.responseBody && (
                        <div>
                          <p className="text-[9px] text-gray-500 uppercase mb-0.5">
                            Response body
                          </p>
                          <pre className="text-[10px] text-gray-400 font-mono whitespace-pre-wrap break-words bg-black/40 rounded p-2">
                            {d.responseBody}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <IconBtn title="Retry" onClick={() => handleRetry(d)}>
                    <RotateCw size={15} className="text-amber-400" />
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
  suffix,
  color,
}: {
  label: string;
  value: number;
  suffix?: string;
  color: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <span className="text-[10px] text-gray-500">{label}</span>
      <p className={`text-lg font-semibold ${color}`}>
        {value}
        {suffix}
      </p>
    </div>
  );
}
