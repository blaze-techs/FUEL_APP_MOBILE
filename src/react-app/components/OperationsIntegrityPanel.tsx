import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Timer,
  WalletCards,
} from "lucide-react";
import { supabase } from "@/supabase/client";
import { useStations } from "@/react-app/context/StationContext";
import { getBackendUrl } from "@/utils/apiConfig";

type CloseRun = {
  meter_expected_total: number;
  canonical_sales_total: number;
  meter_variance_amount: number;
  payment_expected_total: number;
  payment_counted_total: number;
  payment_variance_amount: number;
  max_variance_amount: number;
  status: string;
  created_at: string;
};

type Health = {
  status: "ok" | "warning" | "critical";
  database?: { latencyMs?: number };
  sync?: { exceptions?: number };
  anomalies?: { open?: number };
  etims?: { backlog?: number };
  apiLatencyMs?: number;
};

export default function OperationsIntegrityPanel() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const [latestRun, setLatestRun] = useState<CloseRun | null>(null);
  const [pendingSync, setPendingSync] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  const [openAnomalies, setOpenAnomalies] = useState(0);
  const [locked, setLocked] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [runs, sync, payments, anomalies, locks, healthResponse] =
        await Promise.all([
          supabase
            .from("canonical_shift_close_summary")
            .select(
              "meter_expected_total,canonical_sales_total,meter_variance_amount,payment_expected_total,payment_counted_total,payment_variance_amount,max_variance_amount,status,created_at",
            )
            .eq("station_id", stationId)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("sync_outbox")
            .select("id", { count: "exact", head: true })
            .eq("station_id", stationId)
            .in("status", ["pending", "failed", "conflict"]),
          supabase
            .from("payment_transactions")
            .select("id", { count: "exact", head: true })
            .eq("station_id", stationId)
            .eq("status", "pending"),
          supabase
            .from("anomaly_events")
            .select("id", { count: "exact", head: true })
            .eq("station_id", stationId)
            .eq("status", "open"),
          supabase
            .from("accounting_period_locks")
            .select("id", { count: "exact", head: true })
            .eq("station_id", stationId)
            .lte("period_start", today)
            .gte("period_end", today),
          fetch(`${getBackendUrl()}/api/system/health`, {
            headers: { Accept: "application/json" },
          }).catch(() => null),
        ]);

      if (!runs.error) setLatestRun((runs.data?.[0] as CloseRun) ?? null);
      setPendingSync(sync.count ?? 0);
      setPendingPayments(payments.count ?? 0);
      setOpenAnomalies(anomalies.count ?? 0);
      setLocked((locks.count ?? 0) > 0);

      if (healthResponse?.ok) {
        const body = await healthResponse.json().catch(() => null);
        if (body?.success) setHealth(body as Health);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [stationId]);

  const fmt = (n: number | undefined | null) =>
    Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

  const exceptionCount =
    pendingSync +
    pendingPayments +
    openAnomalies +
    (latestRun?.status === "pending_approval" ? 1 : 0);

  return (
    <section className="rounded-xl border border-edge-light bg-bg-card p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-500" />
            <h3 className="font-semibold text-stat-primary">
              Operations Integrity
            </h3>
          </div>
          <p className="text-xs text-stat-secondary mt-1">
            Canonical shift reconciliation, anomaly queue, sync health,
            payments, period locks and API/database latency.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading || !stationId}
          className="fp-btn-secondary"
          title="Refresh operations integrity"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Latest expected</p>
          <p className="text-lg font-semibold text-stat-primary">
            {fmt(latestRun?.meter_expected_total)}
          </p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Latest sales</p>
          <p className="text-lg font-semibold text-stat-primary">
            {fmt(latestRun?.canonical_sales_total)}
          </p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Meter variance</p>
          <p
            className={
              Math.abs(Number(latestRun?.meter_variance_amount || 0)) > 0.01
                ? "text-lg font-semibold text-amber-500"
                : "text-lg font-semibold text-emerald-500"
            }
          >
            {fmt(latestRun?.meter_variance_amount)}
          </p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Payment variance</p>
          <p
            className={
              Math.abs(Number(latestRun?.payment_variance_amount || 0)) > 0.01
                ? "text-lg font-semibold text-amber-500"
                : "text-lg font-semibold text-emerald-500"
            }
          >
            {fmt(latestRun?.payment_variance_amount)}
          </p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">DB latency</p>
          <p className="text-lg font-semibold text-stat-primary">
            {health?.database?.latencyMs == null
              ? "—"
              : `${health.database.latencyMs} ms`}
          </p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Exceptions</p>
          <p className="text-lg font-semibold text-stat-primary">
            {exceptionCount}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          {latestRun?.status === "pending_approval" ? (
            <AlertTriangle size={13} className="text-amber-500" />
          ) : (
            <CheckCircle2 size={13} className="text-emerald-500" />
          )}
          {latestRun?.status === "pending_approval"
            ? "variance approval required"
            : "latest close reconciled"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <RefreshCw size={13} /> {pendingSync} sync exceptions
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <WalletCards size={13} /> {pendingPayments} pending payments
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <AlertTriangle size={13} /> {openAnomalies} open anomalies
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <Database size={13} />{" "}
          {health?.status ? `system ${health.status}` : "health unavailable"}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <Timer size={13} />{" "}
          {health?.apiLatencyMs == null ? "API —" : `API ${health.apiLatencyMs} ms`}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <Gauge size={13} /> eTIMS backlog {health?.etims?.backlog ?? 0}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          {locked ? (
            <ShieldCheck size={13} className="text-amber-500" />
          ) : (
            <CheckCircle2 size={13} className="text-emerald-500" />
          )}
          {locked ? "Today is locked" : "Today is open"}
        </span>
      </div>
    </section>
  );
}
