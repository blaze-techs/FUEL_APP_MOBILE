import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { supabase } from "@/supabase/client";
import { useStations } from "@/react-app/context/StationContext";
import { calculateFuelReconciliation } from "@/react-app/lib/fuelpro-operations";

type Reading = {
  id: string;
  shift_id: string;
  pump_id: string | null;
  nozzle_code: string | null;
  opening_meter: number;
  closing_meter: number;
  price_per_liter: number;
  actual_sales: number | null;
};

export default function OperationsIntegrityPanel() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const [readings, setReadings] = useState<Reading[]>([]);
  const [pendingSync, setPendingSync] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [r, q, p, l] = await Promise.all([
        supabase.from("shift_pump_readings").select("id,shift_id,pump_id,nozzle_code,opening_meter,closing_meter,price_per_liter,actual_sales").eq("station_id", stationId).order("created_at", { ascending: false }).limit(20),
        supabase.from("sync_outbox").select("id", { count: "exact", head: true }).eq("station_id", stationId).in("status", ["pending","failed","conflict"]),
        supabase.from("payment_transactions").select("id", { count: "exact", head: true }).eq("station_id", stationId).eq("status", "pending"),
        supabase.from("accounting_period_locks").select("id", { count: "exact", head: true }).eq("station_id", stationId).lte("period_start", today).gte("period_end", today),
      ]);
      if (r.error) throw r.error;
      setReadings((r.data ?? []) as Reading[]);
      setPendingSync(q.count ?? 0);
      setPendingPayments(p.count ?? 0);
      setLocked((l.count ?? 0) > 0);
    } catch {
      // Dashboard remains usable if the operations foundation has not yet been migrated.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [stationId]);

  const summary = useMemo(() => {
    let litres = 0, expected = 0, actual = 0, variance = 0, varianceCount = 0;
    for (const r of readings) {
      const c = calculateFuelReconciliation(Number(r.opening_meter), Number(r.closing_meter), Number(r.price_per_liter), r.actual_sales == null ? null : Number(r.actual_sales));
      litres += c.litresSold;
      expected += c.expectedSales;
      if (c.actualSales != null) actual += c.actualSales;
      if (c.varianceAmount != null) {
        variance += c.varianceAmount;
        if (c.status === "variance") varianceCount++;
      }
    }
    return { litres, expected, actual, variance, varianceCount };
  }, [readings]);

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <section className="rounded-xl border border-edge-light bg-bg-card p-4 dark:border-white/10">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-emerald-500" />
            <h3 className="font-semibold text-stat-primary">Operations Integrity</h3>
          </div>
          <p className="text-xs text-stat-secondary mt-1">Meter reconciliation, payment exceptions, offline queue and period controls.</p>
        </div>
        <button onClick={load} disabled={loading || !stationId} className="fp-btn-secondary" title="Refresh operations integrity">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Recent litres</p><p className="text-lg font-semibold text-stat-primary">{fmt(summary.litres)} L</p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Expected sales</p><p className="text-lg font-semibold text-stat-primary">{fmt(summary.expected)}</p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Variance</p>
          <p className={summary.varianceCount ? "text-lg font-semibold text-amber-500" : "text-lg font-semibold text-emerald-500"}>{fmt(summary.variance)}</p>
        </div>
        <div className="rounded-lg border border-edge-light p-3">
          <p className="text-xs text-stat-secondary">Exceptions</p>
          <p className="text-lg font-semibold text-stat-primary">{pendingSync + pendingPayments + summary.varianceCount}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          {summary.varianceCount ? <AlertTriangle size={13} className="text-amber-500" /> : <CheckCircle2 size={13} className="text-emerald-500" />}
          {summary.varianceCount} meter variances
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <RefreshCw size={13} /> {pendingSync} sync exceptions
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          <WalletCards size={13} /> {pendingPayments} pending payments
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1">
          {locked ? <ShieldCheck size={13} className="text-amber-500" /> : <CheckCircle2 size={13} className="text-emerald-500" />}
          {locked ? "Today is locked" : "Today is open"}
        </span>
      </div>
    </section>
  );
}
