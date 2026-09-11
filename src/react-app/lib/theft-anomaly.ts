/* theft-anomaly.ts — pure, testable sudden-drop anomaly detection on tank
 * readings. Reverse-engineered from the telematics fuel-monitoring vector
 * (trackntrace / karooooo / blackboxgps / naj / sicuro): readings of a fuel
 * type are compared in date order; a drop (expectedLevel N+1 < N by more than
 * `thresholdPct` of the previous expected) is flagged as a possible theft
 * anomaly. Shared by TheftAnomalyDetector + tests.
 */
import type { TankReading } from "@/react-app/lib/forecourt-features";

export interface TheftAnomaly {
  id: string;
  fuelLabel: string;
  date: string;
  fromLevel: number;
  toLevel: number;
  dropPct: number;
}

export function computeAnomalies(
  readings: TankReading[],
  thresholdPct: number,
): TheftAnomaly[] {
  if (!readings || readings.length < 2) return [];
  // Group by fuelType, sort by date ASC, scan consecutive expected levels.
  const byFuel = new Map<string, TankReading[]>();
  for (const r of readings) {
    if (!byFuel.has(r.fuelType)) byFuel.set(r.fuelType, []);
    byFuel.get(r.fuelType)!.push(r);
  }
  const out: TheftAnomaly[] = [];
  for (const [fuel, rows] of byFuel) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].expectedLevel ?? 0;
      const cur = rows[i].expectedLevel ?? 0;
      if (prev <= 0) continue;
      const drop = prev - cur;
      if (drop <= 0) continue;
      const dropPct = (drop / prev) * 100;
      if (dropPct > thresholdPct) {
        out.push({
          id: `${rows[i].id}-anomaly`,
          fuelLabel: rows[i].label || fuel,
          date: rows[i].date,
          fromLevel: prev,
          toLevel: cur,
          dropPct,
        });
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
