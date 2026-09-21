import { ensurePriceChangeAAL2 } from "@/react-app/lib/price-security";
import {
  getDuePriceSchedules,
  isValidFutureSchedule,
} from "@/react-app/lib/price-schedule";
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
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { recordPriceChange } from "@/react-app/lib/price-history";
import { normalizeFuelType } from "@/react-app/config/pricing";
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
import {
  getPricingMode,
  getPricingModeSync,
  setPricingMode,
  pricingModeDescription,
  PRICING_MODES,
  type PricingMode,
} from "@/react-app/lib/pricing-mode";

export default function PriceScheduler() {
  const { state, syncPriceToFuelTypes } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes(stationId, false);
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  const {
    data: schedules,
    setLocalData: setLocalSchedules,
    reload: reloadSchedules,
    loading: schedulesLoading,
  } = useCloudKV<PriceSchedule[]>(CLOUD_KEYS.priceSchedules, stationId, []);

  const applyingRef = useRef(new Set<string>());
  const [clockTick, setClockTick] = useState(0);
  const normalizedSchedulesRef = useRef(false);

  useEffect(() => {
    normalizedSchedulesRef.current = false;
  }, [stationId]);
  const [pricingMode, _setPricingMode] = useState<PricingMode>(() =>
    getPricingModeSync(stationId),
  );

  // Load the authoritative pricing mode from cloud on station change.
  useEffect(() => {
    let cancelled = false;
    getPricingMode(stationId).then((mode) => {
      if (!cancelled) _setPricingMode(mode);
    });
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const changePricingMode = (mode: PricingMode) => {
    _setPricingMode(mode);
    void setPricingMode(mode, stationId);
  };

  // Re-check the queue periodically so a schedule that becomes due while this
  // screen remains open is applied without requiring a tab switch or refresh.
  useEffect(() => {
    const id = window.setInterval(() => {
      setClockTick((v) => v + 1);
      void reloadSchedules();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [reloadSchedules]);

  // Legacy rows without action timestamps cannot prove that an action really
  // happened. Preserve them, but remove them from the verified counters.
  useEffect(() => {
    if (schedulesLoading || normalizedSchedulesRef.current || !stationId) return;
    normalizedSchedulesRef.current = true;
    const normalized = schedules.map((s) => {
      if (s.status === "applied" && !s.appliedAt) return { ...s, status: "unverified" as const };
      if (s.status === "cancelled" && !s.cancelledAt) return { ...s, status: "unverified" as const };
      return s;
    });
    if (JSON.stringify(normalized) !== JSON.stringify(schedules)) {
      void cloudStorageService
        .set(CLOUD_KEYS.priceSchedules, normalized, stationId, { throwOnFailure: true })
        .then(() => setLocalSchedules(normalized))
        .catch((error) => console.error("[PriceScheduler] failed to normalize legacy history", error));
    }
  }, [schedules, schedulesLoading, stationId, setLocalSchedules]);

  // Apply due schedules only after the authoritative station price write
  // succeeds. The previous implementation marked a schedule "applied" before
  // the async price write completed and permanently suppressed retries when
  // that write failed. That produced false applied/cancelled history.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const due = getDuePriceSchedules(schedules, new Date()).filter(
        (s) => !applyingRef.current.has(s.id),
      );
      if (due.length === 0) return;

      for (const s of due) {
        if (applyingRef.current.has(s.id)) continue;
        applyingRef.current.add(s.id);
        try {
          const configured =
            (await cloudStorageService.get<any[]>(
              "fuel_types_config",
              stationId,
            )) || [];
          const index = Array.isArray(configured)
            ? configured.findIndex(
                (ft) =>
                  normalizeFuelType(String(ft?.name || "")) ===
                  normalizeFuelType(s.fuelType || s.label),
              )
            : -1;

          if (index < 0) {
            throw new Error(
              `Fuel type "${s.fuelType || s.label}" is not configured for this station.`,
            );
          }

          const previous = Number(configured[index]?.price);
          const next = configured.map((ft, i) =>
            i === index
              ? { ...ft, price: s.price, source: "scheduled" as const }
              : ft,
          );

          await cloudStorageService.set(
            "fuel_types_config",
            next,
            stationId,
            { throwOnFailure: true },
          );

          if (Number.isFinite(previous) && previous !== s.price) {
            await recordPriceChange({
              fuelType: s.label || s.fuelType,
              oldPrice: previous,
              newPrice: s.price,
              changedBy: "Price Scheduler",
              stationId,
            });
          }

          // Refresh the FuelContext legacy scalars/bus. The authoritative
          // fuel_types_config write above is already complete, so this call
          // cannot be the source of truth for success/failure.
          syncPriceToFuelTypes(
            s.label || s.fuelType,
            s.price,
            "Price Scheduler",
            "scheduled",
          );

          if (!cancelled) {
            const appliedSchedules = schedules.map((item) =>
              item.id === s.id
                ? {
                    ...item,
                    status: "applied" as const,
                    appliedAt: new Date().toISOString(),
                    executionId: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    appliedFromPrice: Number.isFinite(previous) ? previous : undefined,
                    appliedToPrice: s.price,
                  }
                : item,
            );
            await cloudStorageService.set(
              CLOUD_KEYS.priceSchedules,
              appliedSchedules,
              stationId,
              { throwOnFailure: true },
            );
            setLocalSchedules(appliedSchedules);
          }
        } catch (error) {
          console.error("[PriceScheduler] schedule apply failed", {
            scheduleId: s.id,
            error,
          });
          // Leave it pending. The next clock tick retries it instead of
          // fabricating an applied result.
        } finally {
          applyingRef.current.delete(s.id);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [schedules, clockTick, stationId, syncPriceToFuelTypes, setSchedules]);

  const [fuel, setFuel] = useState("");
  const [price, setPrice] = useState("");
  // Default to tomorrow 06:00 so Queue always has a valid datetime-local value.
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(6, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const fuelOptions = useMemo(() => {
    const fts = fuelTypeApi.fuelTypes ?? [];
    const opts = fts
      .filter((f) => f.active !== false)
      .map((f) => fuelTypeApi.labelOf(f.name ?? ""))
      .filter(Boolean);
    const uniq = [...new Set(opts)];
    return uniq;
  }, [fuelTypeApi]);

  // Default the fuel select only from the station's real configured fuels.
  // Never manufacture Petrol/Diesel options when cloud data is missing.
  useEffect(() => {
    if (fuelOptions.length > 0 && !fuelOptions.includes(fuel))
      setFuel(fuelOptions[0]);
    if (fuelOptions.length === 0) setFuel("");
  }, [fuelOptions, fuel]);

  const addSchedule = async () => {
    try {
      if (!(await ensurePriceChangeAAL2())) return;
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Confirmation required",
      );
      return;
    }
    const p = Number(price);
    if (!stationId) {
      window.alert("Select a station before scheduling a price change.");
      return;
    }
    if (fuelTypeApi.loading) {
      window.alert("Fuel configuration is still loading. Please wait and try again.");
      return;
    }
    const configuredFuel = fuelTypeApi.findFuelType(fuel);
    if (!configuredFuel) {
      window.alert("That fuel is not configured for the selected station.");
      return;
    }
    if (!fuel || !(p > 0) || !date) {
      window.alert(
        "Select a fuel, enter a price greater than zero, and choose an effective date.",
      );
      return;
    }
    const effectiveOn = new Date(date).toISOString();
    if (!isValidFutureSchedule(effectiveOn)) {
      window.alert("The scheduled time must be in the future.");
      return;
    }
    if (
      schedules.some(
        (s) =>
          s.status === "pending" &&
          s.fuelType === fuel &&
          s.effectiveOn === effectiveOn,
      )
    ) {
      window.alert("An identical pending schedule already exists.");
      return;
    }
    const entry: PriceSchedule = {
      id: `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      fuelType: fuel,
      label: fuel,
      price: p,
      effectiveOn,
      status: "pending",
      createdAt: new Date().toISOString(),
      verificationConfirmedAt: new Date().toISOString(),
    };
    const nextSchedules = [...schedules, entry];
    try {
      await cloudStorageService.set(
        CLOUD_KEYS.priceSchedules,
        nextSchedules,
        stationId,
        { throwOnFailure: true },
      );
      setLocalSchedules(nextSchedules);
      setPrice("");
      setDate("");
    } catch (error) {
      console.error("[PriceScheduler] failed to persist schedule", error);
      window.alert("The price schedule could not be saved. Nothing was queued.");
    }
  };

  const cancel = async (id: string) => {
    const next = schedules.map((s) =>
      s.id === id
        ? { ...s, status: "cancelled" as const, cancelledAt: new Date().toISOString() }
        : s,
    );
    try {
      await cloudStorageService.set(CLOUD_KEYS.priceSchedules, next, stationId, {
        throwOnFailure: true,
      });
      setLocalSchedules(next);
    } catch (error) {
      console.error("[PriceScheduler] failed to cancel schedule", error);
      window.alert("The schedule could not be cancelled.");
    }
  };
  const remove = async (id: string) => {
    const next = schedules.filter((s) => s.id !== id);
    try {
      await cloudStorageService.set(CLOUD_KEYS.priceSchedules, next, stationId, {
        throwOnFailure: true,
      });
      setSchedules(next);
    } catch (error) {
      console.error("[PriceScheduler] failed to remove schedule", error);
      window.alert("The schedule could not be removed.");
    }
  };

  const pending = schedules.filter((s) => s.status === "pending");
  const history = schedules.filter((s) => s.status !== "pending");
  const appliedCount = schedules.filter((s) => s.status === "applied" && !!s.appliedAt).length;
  const cancelledCount = schedules.filter((s) => s.status === "cancelled" && !!s.cancelledAt).length;
  const unverifiedCount = schedules.filter((s) => s.status === "unverified").length;

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
        const hasPrice = typeof f.price === "number" && f.price > 0;
        const hasCost = typeof f.costPrice === "number" && f.costPrice > 0;
        const m = marginInfo(hasPrice ? f.price! : 0, hasCost ? f.costPrice! : 0);
        return {
          raw: fuelTypeApi.labelOf(f.name ?? ""),
          price: hasPrice ? f.price! : 0,
          cost: hasCost ? f.costPrice! : 0,
          hasPrice,
          hasCost,
          ...m,
        };
      }),
    [fuelTypeApi],
  );

  const thin = marginRows.filter(
    (r) => r.hasPrice && r.hasCost && r.marginPct < LOW_MARGIN_PCT,
  );

  return (
    <div className="space-y-4">
      {/* --- pricing mode (the station's price-stability standard) --- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-amber-500" /> Pricing Mode
          </h3>
          <span className="text-xs text-gray-500">
            How prices are populated across the site
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PRICING_MODES.map((m) => {
            const active = pricingMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => changePricingMode(m.id)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-500/10"
                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    active
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-gray-800 dark:text-gray-200"
                  }`}
                >
                  {m.label}
                </p>
                <p className="text-xs text-gray-500 mt-1">{m.description}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-gray-500 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
          {pricingModeDescription(pricingMode)} Scheduled changes always apply —
          the mode only controls regulator auto-sync.
        </p>
      </div>

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
        {fuelTypeApi.loading ? (
          <p className="mb-3 text-xs text-gray-500">Loading live station fuel configuration…</p>
        ) : fuelOptions.length === 0 ? (
          <div className="mb-3 rounded-lg border border-amber-300/40 bg-amber-50/5 px-3 py-2 text-xs text-amber-300">
            No station fuel prices are configured in cloud data. The scheduler will not use regulator/static prices as a substitute.
          </div>
        ) : (
          <p className="mb-3 text-xs text-gray-500">
            Prices are read from this station&apos;s configured cloud data. No static/regulator fallback is used here.
          </p>
        )}
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
              {pending.length} pending · {appliedCount} verified applied · {cancelledCount} verified cancelled{unverifiedCount > 0 ? ` · ${unverifiedCount} unverified legacy` : ""}
            </summary>
            <div className="mt-2 space-y-1">
              {history.map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2 text-sm flex items-center gap-2"
                >
                  {s.status === "applied" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  ) : s.status === "cancelled" ? (
                    <CircleOff className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />
                  )}
                  <span className="text-gray-600 dark:text-gray-400">
                    {s.label} → {currencySymbol}
                    {formatNumber(s.price)} ({s.status}) —{" "}
                    {s.effectiveOn.slice(0, 10)}
                    {s.appliedAt ? ` · applied ${s.appliedAt.slice(0, 16).replace("T", " ")}` : ""}
                    {s.cancelledAt ? ` · cancelled ${s.cancelledAt.slice(0, 16).replace("T", " ")}` : ""}
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
                    {r.hasPrice
                      ? `${currencySymbol}${r.price.toFixed(2)}`
                      : "No station price"}
                  </td>
                  <td className="py-1.5 pr-4 text-right">
                    {r.hasCost ? `${currencySymbol}${r.cost.toFixed(2)}` : "No cost data"}
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
