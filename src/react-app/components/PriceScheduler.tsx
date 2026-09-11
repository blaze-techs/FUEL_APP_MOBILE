/**
 * PriceScheduler.tsx — scheduled price changes + margin guard
 * (Shell / Livetrac price-calendar concept). Lives as a sub-tab inside
 * Fuel Type Manager's Fuel context.
 *   - Queue a future price per fuel; on mount, pending entries whose
 *     effective date has passed are auto-applied via
 *     useFuel().syncPriceToFuelTypes so Dashboard/POS/Reports update.
 *   - Margin guard shows price − cost margins and flags thin margins.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Plus,
  Trash2,
  AlarmClock,
  TriangleAlert,
  CheckCircle2,
  Download,
  CircleOff,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import {
  CLOUD_KEYS,
  type PriceSchedule,
  marginInfo,
  LOW_MARGIN_PCT,
  downloadCsv,
} from "@/react-app/lib/forecourt-features";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";

export default function PriceScheduler() {
  const { state, syncPriceToFuelTypes } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  const { data: schedules, setData: setSchedules } = useCloudKV<
    PriceSchedule[]
  >(CLOUD_KEYS.priceSchedules, stationId, []);

  const appliedRef = useRef(false);

  // Auto-apply any pending schedules whose effective date has passed.
  useEffect(() => {
    if (appliedRef.current) return;
    const now = new Date();
    const due = schedules.filter(
      (s) => s.status === "pending" && new Date(s.effectiveOn) <= now,
    );
    if (due.length === 0) return;
    appliedRef.current = true;
    for (const s of due) {
      // changedBy flows into the shared price-history trail (Rate History).
      syncPriceToFuelTypes(s.label || s.fuelType, s.price, "Price Scheduler");
    }
    setSchedules((prev) =>
      prev.map((s) =>
        due.find((d) => d.id === s.id)
          ? { ...s, status: "applied" as const }
          : s,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules]);

  const [fuel, setFuel] = useState("");
  const [price, setPrice] = useState("");
  // Default to tomorrow 06:00 so Queue always has a valid datetime-local value.
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(6, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:0${d.getMinutes()}`;
  });

  const fuelOptions = useMemo(() => {
    const fts = fuelTypeApi.fuelTypes ?? [];
    const opts = fts
      .map((f) => fuelTypeApi.labelOf(f.name ?? ""))
      .filter(Boolean);
    const uniq = [...new Set(opts)];
    return uniq.length > 0 ? uniq : ["Super Petrol", "Diesel"];
  }, [fuelTypeApi]);

  // Default the fuel select to a real option once fuelTypes load.
  useEffect(() => {
    if (fuelOptions.length > 0 && !fuelOptions.includes(fuel))
      setFuel(fuelOptions[0]);
  }, [fuelOptions, fuel]);

  const addSchedule = () => {
    const p = Number(price);
    if (!fuel || !(p > 0) || !date) return;
    const entry: PriceSchedule = {
      id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fuelType: fuel,
      label: fuel,
      price: p,
      effectiveOn: new Date(date).toISOString(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    setSchedules((prev) => [...prev, entry]);
    setPrice("");
    setDate("");
  };

  const cancel = (id: string) =>
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "cancelled" } : s)),
    );
  const remove = (id: string) =>
    setSchedules((prev) => prev.filter((s) => s.id !== id));

  const pending = schedules.filter((s) => s.status === "pending");
  const history = schedules.filter((s) => s.status !== "pending");

  const exportRows = () =>
    downloadCsv("price-schedules.csv", [
      ["fuel", "price", "effective on", "status"],
      ...schedules.map((s) => [
        s.label,
        s.price.toFixed(3),
        s.effectiveOn.slice(0, 10),
        s.status,
      ]),
    ]);

  const marginRows = useMemo(
    () =>
      (fuelTypeApi.fuelTypes ?? []).map((f) => {
        const m = marginInfo(f.price ?? 0, f.costPrice ?? 0);
        return {
          raw: fuelTypeApi.labelOf(f.name ?? ""),
          price: f.price ?? 0,
          cost: f.costPrice ?? 0,
          ...m,
        };
      }),
    [fuelTypeApi],
  );

  const thin = marginRows.filter(
    (r) => r.price > 0 && r.marginPct < LOW_MARGIN_PCT,
  );

  return (
    <div className="space-y-4">
      {/* --- schedule a price change --- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-amber-500" /> Schedule a
            price change
          </h3>
          <button
            onClick={exportRows}
            disabled={schedules.length === 0}
            className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1 disabled:opacity-40"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <select
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            value={fuel}
            onChange={(e) => setFuel(e.target.value)}
          >
            <option value="">Fuel…</option>
            {fuelOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            placeholder={`New price (${currencySymbol}/L)`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
          />
          <input
            className="h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button
            onClick={addSchedule}
            className="h-12 px-4 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium flex items-center justify-center gap-1"
          >
            <Plus className="w-4 h-4" /> Queue
          </button>
        </div>

        {pending.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {pending
              .sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn))
              .map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3 flex items-center justify-between"
                >
                  <div className="text-sm">
                    <p className="font-medium text-gray-800 dark:text-gray-200">
                      {s.label} → {currencySymbol}
                      {formatNumber(s.price)}
                    </p>
                    <p className="text-xs text-gray-500 flex items-center gap-1">
                      <AlarmClock className="w-3 h-3" /> Applies{" "}
                      {s.effectiveOn.slice(0, 16).replace("T", " ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => cancel(s.id)}
                      className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
                    >
                      <CircleOff className="w-3.5 h-3.5" /> Cancel
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      className="text-red-400 hover:text-red-500"
                      aria-label="delete schedule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
        {history.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-gray-500 cursor-pointer">
              {history.length} applied / cancelled
            </summary>
            <div className="mt-2 space-y-1">
              {history.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2 text-sm flex items-center gap-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-gray-600 dark:text-gray-400">
                    {s.label} → {currencySymbol}
                    {formatNumber(s.price)} ({s.status}) —{" "}
                    {s.effectiveOn.slice(0, 10)}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* --- margin guard --- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mb-3">
          <TriangleAlert className="w-4 h-4 text-amber-500" /> Margin guard
          (price − cost)
        </h3>
        {marginRows.length === 0 ? (
          <p className="text-sm text-gray-500">No fuel types configured yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                <th className="py-1.5 pr-4">Fuel</th>
                <th className="py-1.5 pr-4 text-right">Price</th>
                <th className="py-1.5 pr-4 text-right">Cost</th>
                <th className="py-1.5 pr-4 text-right">Margin</th>
                <th className="py-1.5 pr-4 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {marginRows.map((r) => (
                <tr
                  key={r.raw}
                  className="border-b border-gray-100 dark:border-gray-700/60"
                >
                  <td className="py-1.5 pr-4 font-medium text-gray-800 dark:text-gray-200">
                    {r.raw}
                  </td>
                  <td className="py-1.5 pr-4 text-right">
                    {r.price > 0
                      ? `${currencySymbol}${r.price.toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right">
                    {r.cost > 0 ? `${currencySymbol}${r.cost.toFixed(2)}` : "—"}
                  </td>
                  <td
                    className={`py-1.5 pr-4 text-right font-semibold ${
                      r.margin < 0 ? "text-red-500" : "text-gray-700"
                    }`}
                  >
                    {r.margin !== 0
                      ? `${currencySymbol}${Math.abs(r.margin).toFixed(2)}${r.margin < 0 ? " loss" : ""}`
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-right">
                    {r.price > 0 ? (
                      <span
                        className={
                          r.marginPct < LOW_MARGIN_PCT
                            ? "text-red-500 font-semibold"
                            : "text-green-600"
                        }
                      >
                        {r.marginPct.toFixed(1)}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {thin.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            <TriangleAlert className="w-3.5 h-3.5" /> {thin.length} fuel type
            {thin.length > 1 ? "s" : ""} below the {LOW_MARGIN_PCT.toFixed(0)}%
            margin floor — review your selling price.
          </p>
        )}
      </div>
    </div>
  );
}
