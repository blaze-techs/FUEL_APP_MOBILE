/* auto-replenishment — pure computation for the Shell eVMI reverse-
 * engineered feature. Kept in a lib so it can be unit-tested without
 * rendering the component (mirrors theft-anomaly.ts).
 */
import type { TankReading } from "./forecourt-features";

export interface ReplenishmentSuggestion {
  id: string;
  fuelType: string;
  label: string;
  /** latest measured stock in litres */
  currentStock: number;
  /** litres/day derived from expected-level draw-downs */
  avgDailyUsage: number;
  /** days until current stock runs out at avg usage (Infinity when no usage) */
  daysToEmpty: number;
  /** litres required to restore stock to target days cover */
  suggestedQty: number;
  status: "critical" | "reorder" | "ok";
}

export const DEFAULT_TARGET_DAYS = 7;

export function computeReplenishmentSuggestions(
  readings: TankReading[],
  targetDays = DEFAULT_TARGET_DAYS,
): ReplenishmentSuggestion[] {
  if (!readings || readings.length === 0) return [];
  const byFuel = new Map<string, TankReading[]>();
  for (const r of readings) {
    const group = byFuel.get(r.fuelType) ?? [];
    group.push(r);
    byFuel.set(r.fuelType, group);
  }
  const out: ReplenishmentSuggestion[] = [];
  for (const [fuelType, group] of byFuel) {
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const spanDays = Math.max(
      1,
      Math.ceil(
        (new Date(last.date).getTime() - new Date(first.date).getTime()) /
          86_400_000,
      ),
    );
    let usageTotal = 0;
    for (let i = 1; i < sorted.length; i++) {
      const drop = sorted[i - 1].expectedLevel - sorted[i].expectedLevel;
      if (drop > 0) usageTotal += drop;
    }
    const avgDailyUsage = usageTotal / spanDays;
    const currentStock = Math.max(0, last.measuredLevel);
    const daysToEmpty =
      avgDailyUsage > 0 ? currentStock / avgDailyUsage : Infinity;
    const suggestedQty = Math.max(
      0,
      Math.ceil(targetDays * avgDailyUsage - currentStock),
    );
    const status =
      avgDailyUsage <= 0
        ? "ok"
        : daysToEmpty <= 1
          ? "critical"
          : daysToEmpty <= targetDays
            ? "reorder"
            : "ok";
    out.push({
      id: fuelType,
      fuelType,
      label: last.label || fuelType,
      currentStock,
      avgDailyUsage,
      daysToEmpty,
      suggestedQty,
      status,
    });
  }
  return out;
}
