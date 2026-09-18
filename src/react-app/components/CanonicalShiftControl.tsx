import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, LockKeyhole, Moon, RefreshCw, RotateCcw, Sun } from "lucide-react";
import { supabase } from "@/supabase/client";
import { useStations } from "@/react-app/context/StationContext";
import { getBackendUrl } from "@/utils/apiConfig";

type ShiftRow = {
  id: string;
  shift_date: string;
  shift_type: "day" | "night";
  status: "open" | "pending_approval" | "closed" | "reopened" | "void";
  variance_reason?: string | null;
  closed_at?: string | null;
};

type NozzleRow = {
  id: string;
  nozzle_code: string;
  display_name?: string | null;
  pump_id: string;
  fuel_type_id: string;
  pumpNumber?: string;
  pumpName?: string;
  fuelName?: string;
  price: number;
  previousClosing: number;
};

type MeterInput = {
  nozzleId: string;
  opening: number;
  closing: number;
  price: number;
  actual: number;
};

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Authentication required.");
  return data.session.access_token;
}

async function api(path: string, body: unknown) {
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await accessToken()}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}

export default function CanonicalShiftControl() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const [shift, setShift] = useState<ShiftRow | null>(null);
  const [nozzles, setNozzles] = useState<NozzleRow[]>([]);
  const [meters, setMeters] = useState<Record<string, MeterInput>>({});
  const [cash, setCash] = useState(0);
  const [mpesa, setMpesa] = useState(0);
  const [card, setCard] = useState(0);
  const [credit, setCredit] = useState(0);
  const [varianceReason, setVarianceReason] = useState("");
  const [approvalReason, setApprovalReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    if (!stationId) return;
    setBusy(true);
    try {
      const [shiftResult, nozzleResult] = await Promise.all([
        supabase
          .from("operational_shifts")
          .select("id,shift_date,shift_type,status,variance_reason,closed_at")
          .eq("station_id", stationId)
          .eq("shift_date", today)
          .neq("status", "void")
          .order("opened_at", { ascending: false })
          .limit(1),
        supabase
          .from("pump_nozzles")
          .select("id,nozzle_code,display_name,pump_id,fuel_type_id,pumps(pump_number,name,price_per_liter),fuel_types(name,code)")
          .eq("station_id", stationId)
          .eq("is_active", true),
      ]);
      if (shiftResult.error) throw shiftResult.error;
      if (nozzleResult.error) throw nozzleResult.error;
      const activeShift = (shiftResult.data?.[0] || null) as ShiftRow | null;
      setShift(activeShift);

      const baseNozzles = (nozzleResult.data || []) as any[];
      const normalized: NozzleRow[] = [];
      for (const n of baseNozzles) {
        const { data: priceRows } = await supabase
          .from("nozzle_price_history")
          .select("price_per_liter")
          .eq("nozzle_id", n.id)
          .is("valid_to", null)
          .order("valid_from", { ascending: false })
          .limit(1);
        const { data: previous } = await supabase
          .from("operational_shift_meters")
          .select("closing_meter,created_at")
          .eq("station_id", stationId)
          .eq("nozzle_id", n.id)
          .order("created_at", { ascending: false })
          .limit(1);

        normalized.push({
          id: n.id,
          nozzle_code: n.nozzle_code,
          display_name: n.display_name,
          pump_id: n.pump_id,
          fuel_type_id: n.fuel_type_id,
          pumpNumber: n.pumps?.pump_number,
          pumpName: n.pumps?.name,
          fuelName: n.fuel_types?.name || n.fuel_types?.code,
          price: Number(priceRows?.[0]?.price_per_liter ?? n.pumps?.price_per_liter ?? 0),
          previousClosing: Number(previous?.[0]?.closing_meter ?? 0),
        });
      }
      setNozzles(normalized);
      setMeters(
        Object.fromEntries(
          normalized.map((n) => [
            n.id,
            {
              nozzleId: n.id,
              opening: n.previousClosing,
              closing: n.previousClosing,
              price: n.price,
              actual: 0,
            },
          ]),
        ),
      );
      setMessage(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not load canonical shift data.";
      // New installations may not have applied migrations yet; keep the legacy scheduler usable.
      setMessage({ type: "error", text });
    } finally {
      setBusy(false);
    }
  }, [stationId, today]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return Object.values(meters).reduce(
      (acc, row) => {
        const litres = Math.max(0, Number(row.closing || 0) - Number(row.opening || 0));
        const expected = litres * Number(row.price || 0);
        acc.litres += litres;
        acc.expected += expected;
        acc.actual += Number(row.actual || 0);
        return acc;
      },
      { litres: 0, expected: 0, actual: 0 },
    );
  }, [meters]);

  const paymentTotal = cash + mpesa + card + credit;
  const expectedVariance = totals.actual - totals.expected;

  const openShift = async (type: "day" | "night") => {
    if (!stationId) return;
    setBusy(true);
    try {
      const result = await api("/api/operations/shift?action=open", {
        stationId,
        shiftDate: today,
        shiftType: type,
      });
      setShift(result.data);
      setMessage({ type: "ok", text: `${type === "day" ? "Day" : "Night"} shift opened.` });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not open shift." });
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async () => {
    if (!shift) return;
    setBusy(true);
    try {
      const rows = Object.values(meters);
      if (rows.length === 0) throw new Error("Map at least one pump/nozzle before closing a shift.");
      const result = await api("/api/operations/shift?action=close", {
        shiftId: shift.id,
        meters: rows.map((row) => ({
          nozzle_id: row.nozzleId,
          opening_meter: Number(row.opening),
          closing_meter: Number(row.closing),
          price_per_liter: Number(row.price),
          actual_sales: Number(row.actual),
        })),
        payments: [
          { payment_method: "cash", expected_amount: cash, counted_amount: cash },
          { payment_method: "mpesa", expected_amount: mpesa, counted_amount: mpesa },
          { payment_method: "card", expected_amount: card, counted_amount: card },
          { payment_method: "credit", expected_amount: credit, counted_amount: credit },
        ],
        varianceReason: varianceReason || null,
      });
      setMessage({
        type: result.data.status === "pending_approval" ? "error" : "ok",
        text:
          result.data.status === "pending_approval"
            ? `Shift closed pending variance approval. Maximum variance: ${Number(result.data.max_variance || 0).toFixed(2)}.`
            : "Shift closed and reconciled.",
      });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not close shift." });
    } finally {
      setBusy(false);
    }
  };

  const approveVariance = async () => {
    if (!shift) return;
    if (!approvalReason.trim()) {
      setMessage({ type: "error", text: "Enter an approval reason." });
      return;
    }
    setBusy(true);
    try {
      await api("/api/operations/shift?action=approve", { shiftId: shift.id, reason: approvalReason.trim() });
      setMessage({ type: "ok", text: "Variance approved and shift closed." });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Approval failed." });
    } finally {
      setBusy(false);
    }
  };

  const reopenShift = async () => {
    if (!shift) return;
    const reason = approvalReason.trim() || "Authorized correction";
    setBusy(true);
    try {
      await api("/api/operations/shift?action=reopen", { shiftId: shift.id, reason });
      setMessage({ type: "ok", text: "Shift reopened with audit trail. Existing meter rows remain immutable." });
      await load();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Reopen failed." });
    } finally {
      setBusy(false);
    }
  };

  if (!stationId) return null;

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">Canonical Day / Night Shift Close</h3>
          <p className="text-xs text-gray-500 mt-1">
            Pump-meter continuity, immutable readings, payment reconciliation and supervisor variance approval.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} className="px-3 py-2 rounded-lg border text-xs flex items-center gap-2">
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {message && (
        <div className={`rounded-lg px-3 py-2 text-xs flex gap-2 items-start ${message.type === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"}`}>
          {message.type === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{message.text}</span>
        </div>
      )}

      {!shift ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void openShift("day")} disabled={busy} className="px-4 py-2 rounded-lg bg-amber-500 text-white flex items-center gap-2">
            <Sun size={16} /> Open Day Shift
          </button>
          <button type="button" onClick={() => void openShift("night")} disabled={busy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white flex items-center gap-2">
            <Moon size={16} /> Open Night Shift
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 font-medium uppercase">{shift.shift_type}</span>
            <span className="px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700">{shift.status.replace("_", " ")}</span>
            <span className="text-gray-500">{shift.shift_date}</span>
          </div>

          {(shift.status === "open" || shift.status === "reopened") && (
            <>
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900/40">
                    <tr>
                      <th className="p-2 text-left">Pump / Nozzle</th>
                      <th className="p-2 text-right">Opening</th>
                      <th className="p-2 text-right">Closing</th>
                      <th className="p-2 text-right">Price/L</th>
                      <th className="p-2 text-right">Actual sales</th>
                      <th className="p-2 text-right">Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nozzles.map((n) => {
                      const row = meters[n.id];
                      const expected = row ? Math.max(0, row.closing - row.opening) * row.price : 0;
                      return (
                        <tr key={n.id} className="border-t dark:border-gray-700">
                          <td className="p-2">
                            <div className="font-medium">{n.pumpName || `Pump ${n.pumpNumber || "—"}`} / {n.display_name || n.nozzle_code}</div>
                            <div className="text-[10px] text-gray-500">{n.fuelName || "Fuel"} · previous close {n.previousClosing.toFixed(3)}</div>
                          </td>
                          {(["opening", "closing", "price", "actual"] as const).map((field) => (
                            <td key={field} className="p-2">
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                value={row?.[field] ?? 0}
                                readOnly={field === "opening"}
                                onChange={(e) =>
                                  setMeters((prev) => ({
                                    ...prev,
                                    [n.id]: { ...prev[n.id], [field]: Number(e.target.value) },
                                  }))
                                }
                                className="w-28 max-w-full px-2 py-1.5 text-right border rounded dark:bg-gray-900 dark:border-gray-700 disabled:opacity-70"
                              />
                            </td>
                          ))}
                          <td className="p-2 text-right font-medium">{expected.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  ["Cash", cash, setCash],
                  ["M-Pesa", mpesa, setMpesa],
                  ["Card/Bank", card, setCard],
                  ["Credit", credit, setCredit],
                ].map(([label, value, setter]) => (
                  <label key={String(label)} className="text-xs">
                    <span className="block text-gray-500 mb-1">{String(label)}</span>
                    <input type="number" min="0" step="0.01" value={Number(value)} onChange={(e) => (setter as (v:number)=>void)(Number(e.target.value))} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700" />
                  </label>
                ))}
              </div>

              <div className="grid sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3"><span className="text-gray-500 block">Litres</span><strong>{totals.litres.toFixed(3)} L</strong></div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3"><span className="text-gray-500 block">Expected</span><strong>{totals.expected.toFixed(2)}</strong></div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3"><span className="text-gray-500 block">Actual</span><strong>{totals.actual.toFixed(2)}</strong></div>
                <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 p-3"><span className="text-gray-500 block">Payment total</span><strong>{paymentTotal.toFixed(2)}</strong></div>
              </div>

              <label className="text-xs block">
                <span className="block text-gray-500 mb-1">Variance explanation (required by policy when material)</span>
                <textarea value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} className="w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700" rows={2} placeholder={`Current meter-sales variance: ${expectedVariance.toFixed(2)}`} />
              </label>

              <button type="button" onClick={() => void closeShift()} disabled={busy || nozzles.length === 0} className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium flex items-center gap-2">
                <LockKeyhole size={16} /> Close & Reconcile Shift
              </button>
            </>
          )}

          {shift.status === "pending_approval" && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">This shift has a material variance and requires manager/supervisor approval.</p>
              <textarea value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} rows={2} placeholder="Approval reason / investigation note" className="w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:border-gray-700" />
              <button type="button" onClick={() => void approveVariance()} disabled={busy} className="px-4 py-2 rounded-lg bg-amber-600 text-white">Approve Variance & Close</button>
            </div>
          )}

          {shift.status === "closed" && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> Reconciled and immutable</span>
              <input value={approvalReason} onChange={(e) => setApprovalReason(e.target.value)} placeholder="Reason to reopen" className="px-3 py-2 border rounded-lg text-xs dark:bg-gray-900 dark:border-gray-700" />
              <button type="button" onClick={() => void reopenShift()} disabled={busy} className="px-3 py-2 rounded-lg border text-xs flex items-center gap-2"><RotateCcw size={14} /> Authorized Reopen</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
