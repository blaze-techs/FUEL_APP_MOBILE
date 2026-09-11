/* AutoReplenishment — reverse-engineered Shell eVMI (electronic vendor
 * managed inventory). Unlike TankMonitor's manual "Create re-order" CTA,
 * this component continuously derives average daily usage from the tank
 * reading history and automatically queues a suggested order when a fuel
 * drops below the configured target days-cover. One click converts a
 * suggestion into a purchase order (Suppliers tab); the queue is the
 * "no manual orders" workflow Shell's eVMI page describes.
 * Cloud KV `auto_replenishment_target_days` (station-scoped target days
 * cover, default 7) + `auto_replenishment_dismissed` (dismissed queue ids).
 */
import { AlarmClock, Fuel, ShoppingCart, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type TankReading,
} from "@/react-app/lib/forecourt-features";
import {
  computeReplenishmentSuggestions,
  DEFAULT_TARGET_DAYS,
} from "@/react-app/lib/auto-replenishment";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const TARGET_KEY = "auto_replenishment_target_days";
const DISMISSED_KEY = "auto_replenishment_dismissed";

export default function AutoReplenishment() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const { data: readings } = useCloudKV<TankReading[]>(
    CLOUD_KEYS.tankReadings,
    stationId,
    [],
  );
  const { data: targetDays, setData: setTargetDays } = useCloudKV<number>(
    TARGET_KEY,
    stationId,
    DEFAULT_TARGET_DAYS,
  );
  const { data: dismissed, setData: setDismissed } = useCloudKV<string[]>(
    DISMISSED_KEY,
    stationId,
    [],
  );

  const [targetInput, setTargetInput] = useState("");

  const suggestions = useMemo(
    () =>
      computeReplenishmentSuggestions(
        readings || [],
        targetDays ?? DEFAULT_TARGET_DAYS,
      ),
    [readings, targetDays],
  );

  const visibleQueue = suggestions.filter(
    (s) => s.status !== "ok" && !(dismissed || []).includes(s.id),
  );

  const handleDismiss = (id: string) => {
    setDismissed([...(dismissed || []), id]);
    toastSuccess("Suggestion dismissed. It will re-appear on next edit.");
  };

  const handleApplyTarget = () => {
    const n = parseFloat(targetInput);
    if (Number.isFinite(n) && n >= 1 && n <= 90) {
      setTargetDays(n);
      setTargetInput("");
      toastSuccess(`Target days cover set to ${n} days.`);
    } else {
      toastError("Enter a value between 1 and 90 days.");
    }
  };

  return (
    <div className="card space-y-3 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-emerald-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Auto-Replenishment (eVMI)
            </h4>
            <p className="text-xs text-gray-500">
              Computed continuously from tank readings — orders suggested when
              stock drops below your days-cover target.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={90}
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            placeholder={`${targetDays ?? DEFAULT_TARGET_DAYS}d`}
            className="w-20 px-2 py-1 bg-white dark:bg-gray-700 rounded text-xs"
            aria-label="Target days cover"
          />
          <button
            onClick={handleApplyTarget}
            className="btn btn-secondary !p-1.5 !text-xs"
          >
            Apply
          </button>
        </div>
      </div>

      {visibleQueue.length === 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          All fuel levels are within the target days cover. No orders suggested
          right now.
        </p>
      ) : (
        <div className="space-y-2">
          {visibleQueue.map((s) => (
            <div
              key={s.id}
              className={`rounded border p-3 flex flex-wrap items-center gap-2 justify-between ${
                s.status === "critical"
                  ? "border-red-400 bg-red-50/60 dark:bg-red-900/20"
                  : "border-amber-400 bg-amber-50/60 dark:bg-amber-900/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <Fuel className="w-4 h-4" />
                <div>
                  <p className="font-semibold text-sm">{s.label}</p>
                  <p className="text-xs">
                    Stock {s.currentStock.toLocaleString()} L · usage{" "}
                    {s.avgDailyUsage.toFixed(1)} L/day ·{" "}
                    {s.daysToEmpty === Infinity
                      ? "—"
                      : `${s.daysToEmpty.toFixed(1)}d left`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {s.suggestedQty > 0 && (
                  <span className="text-xs font-semibold">
                    Order {s.suggestedQty.toLocaleString()} L
                  </span>
                )}
                <button
                  onClick={() => switchToTab("suppliers")}
                  className="btn btn-primary !p-1.5 !text-xs flex items-center gap-1"
                >
                  <ShoppingCart className="w-3 h-3" /> Create PO
                </button>
                <button
                  onClick={() => handleDismiss(s.id)}
                  className="btn btn-secondary !p-1.5 !text-xs"
                  aria-label={`Dismiss suggestion for ${s.label}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-gray-500 flex items-center gap-1">
        <AlarmClock className="w-3 h-3" />
        Suggested quantities restore stock to your target days cover from real
        usage velocity. Dismissed items may re-appear as stock changes.
      </div>
    </div>
  );
}
