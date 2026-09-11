/* EvaporationDriftDetector — reverse-engineered Advatech "consumption
 * anomalies (meter drift, evaporation)": scans tank readings for measured
 * levels that drift BELOW the expected book level by a slow, steady margin
 * (not a sudden theft drop — TheftAnomalyDetector covers those). A slow
 * per-reading drain points to meter drift / evaporation loss rather than
 * deliberate pilferage. Tunable threshold (cloud KV uses the shared
 * `theft_anomaly_threshold_pct`); computed from `tank_readings`.
 */
import { FlaskConical, Info } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type TankReading,
} from "@/react-app/lib/forecourt-features";

const THRESHOLD_KEY = "theft_anomaly_threshold_pct";

interface DriftHit {
  fuelType: string;
  label: string;
  readings: number;
  avgLossPerReading: number;
  avgLossPct: number;
  totalLoss: number;
}

export default function EvaporationDriftDetector() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: readings } = useCloudKV<TankReading[]>(
    CLOUD_KEYS.tankReadings,
    stationId,
    [],
  );
  const { data: thresholdPct } = useCloudKV<number>(
    THRESHOLD_KEY,
    stationId,
    2,
  );

  const hits = useMemo<DriftHit[]>(() => {
    const byFuel = new Map<string, TankReading[]>();
    for (const r of readings || []) {
      const group = byFuel.get(r.fuelType) ?? [];
      group.push(r);
      byFuel.set(r.fuelType, group);
    }
    const out: DriftHit[] = [];
    const threshold = thresholdPct ?? 2;
    for (const [fuelType, group] of byFuel) {
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length < 3) continue;
      let lossTotal = 0;
      let lossReadings = 0;
      let totalLoss = 0;
      for (const r of sorted) {
        const loss = r.expectedLevel - r.measuredLevel;
        if (loss > 0) {
          const pct = r.expectedLevel > 0 ? (loss / r.expectedLevel) * 100 : 0;
          // slow drift = per-reading loss above threshold but below a sudden
          // theft drop (theft detector flags jumps; drift is a persistent base)
          if (pct >= threshold && pct < threshold * 4) {
            lossTotal += loss;
            lossReadings += 1;
          }
          totalLoss += loss;
        }
      }
      if (lossReadings >= 2) {
        const avgLossPerReading = lossTotal / lossReadings;
        const first = sorted[0];
        const avgLossPct =
          first.expectedLevel > 0
            ? (avgLossPerReading / first.expectedLevel) * 100
            : 0;
        out.push({
          fuelType,
          label: sorted[sorted.length - 1].label || fuelType,
          readings: lossReadings,
          avgLossPerReading,
          avgLossPct,
          totalLoss,
        });
      }
    }
    return out.sort((a, b) => b.totalLoss - a.totalLoss);
  }, [readings, thresholdPct]);

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-indigo-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Evaporation &amp; Meter-Drift Detector
            </h4>
            <p className="text-xs text-gray-500">
              Slow persistent losses (Advatech anomaly detection): meter drift /
              evaporation, distinct from sudden theft drops.
            </p>
          </div>
        </div>
      </div>

      {hits.length === 0 ? (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <Info className="w-3 h-3" /> No slow-drift pattern detected — tank
          losses are within threshold (or too few readings).
        </p>
      ) : (
        <div className="space-y-2">
          {hits.map((h) => (
            <div
              key={h.fuelType}
              className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/10 p-3"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{h.label}</span>
                <span className="text-xs text-amber-700 dark:text-amber-300">
                  {h.readings} readings · avg −
                  {h.avgLossPerReading.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{" "}
                  L (~{h.avgLossPct.toFixed(1)}%)
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Persistent slow drain totalling{" "}
                {h.totalLoss.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}{" "}
                L — suspect meter drift, leaking joints or evaporation.
                Recalibrate the meter (Calibration tab) and inspect tank seals.
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
