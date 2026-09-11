/* TankWaterTrace — Advatech ATG-style water-ingress history: scans the
 * existing tank readings (CLOUD_KEYS.tankReadings) for waterMm readings and
 * renders a per-fuel water-trend mini-chart plus a worst-current reading.
 * Water above 5 mm flags red; trend over 14 days is shown as an SVG
 * sparkline so ingress can be spotted early.
 */
import { Droplets } from "lucide-react";
import { useMemo, useEffect, useRef } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type TankReading,
} from "@/react-app/lib/forecourt-features";
import { emitFeatureEvent } from "@/react-app/lib/feature-events";

const WATER_ALERT_MM = 5;

interface FuelWaterTrend {
  fuelType: string;
  pts: { date: string; mm: number }[];
  currentMm: number;
}

export default function TankWaterTrace() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: readings } = useCloudKV<TankReading[]>(
    CLOUD_KEYS.tankReadings,
    stationId,
    [],
  );

  const trends = useMemo<FuelWaterTrend[]>(() => {
    const byFuel = new Map<string, { date: string; mm: number }[]>();
    for (const r of readings || []) {
      if (r.waterMm == null) continue;
      const arr = byFuel.get(r.fuelType) || [];
      arr.push({ date: r.date, mm: r.waterMm });
      byFuel.set(r.fuelType, arr);
    }
    const out: FuelWaterTrend[] = [];
    for (const [fuelType, ptsRaw] of byFuel) {
      const pts = [...ptsRaw].sort((a, b) => a.date.localeCompare(b.date));
      out.push({ fuelType, pts, currentMm: pts[pts.length - 1]?.mm ?? 0 });
    }
    return out.sort((a, b) => b.currentMm - a.currentMm);
  }, [readings]);

  // Emit one alert per fuel when the current reading crosses the 5 mm
  // threshold. Re-fires if it goes below and rises again.
  const lastEmittedRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    for (const t of trends) {
      const last = lastEmittedRef.current.get(t.fuelType) ?? 0;
      if (t.currentMm > WATER_ALERT_MM && t.currentMm !== last) {
        lastEmittedRef.current.set(t.fuelType, t.currentMm);
        emitFeatureEvent({
          type: "tank-water.alert",
          payload: { fuelType: t.fuelType, waterMm: t.currentMm },
        });
      }
      if (t.currentMm <= WATER_ALERT_MM) {
        lastEmittedRef.current.delete(t.fuelType);
      }
    }
  }, [trends]);

  const spark = (pts: { date: string; mm: number }[]) => {
    const w = 160;
    const h = 32;
    const max = Math.max(WATER_ALERT_MM * 2, ...pts.map((p) => p.mm));
    const step = w / Math.max(1, pts.length - 1);
    const path = pts
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${i * step},${h - (p.mm / (max || 1)) * (h - 4) + 2}`,
      )
      .join(" ");
    return path;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Droplets size={16} /> Water Ingress History
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Free-water trend per fuel from ATG/dip readings. Above 5 mm requires
        tank surveillance.
      </p>
      {trends.length === 0 ? (
        <p className="text-sm text-gray-500">
          No water readings yet — add tank readings with a water_mm value.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {trends.map((t) => (
            <div
              key={t.fuelType}
              className={`rounded-lg border p-3 ${t.currentMm > WATER_ALERT_MM ? "border-red-400 bg-red-50 dark:bg-red-900/20" : "border-gray-200 dark:border-gray-600"}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm text-gray-900 dark:text-gray-900 dark:text-white">
                  {t.fuelType}
                </span>
                <span
                  className={`text-sm font-bold ${t.currentMm > WATER_ALERT_MM ? "text-red-600" : "text-emerald-600"}`}
                >
                  {t.currentMm} mm
                </span>
              </div>
              <svg width="160" height="32" className="w-full">
                <path
                  d={spark(t.pts)}
                  stroke={t.currentMm > WATER_ALERT_MM ? "#dc2626" : "#059669"}
                  strokeWidth="1.5"
                  fill="none"
                />
                <line
                  x1="0"
                  y1={
                    32 -
                    (WATER_ALERT_MM / Math.max(10, ...t.pts.map((p) => p.mm))) *
                      28
                  }
                  x2="160"
                  y2={
                    32 -
                    (WATER_ALERT_MM / Math.max(10, ...t.pts.map((p) => p.mm))) *
                      28
                  }
                  stroke="#f59e0b"
                  strokeDasharray="3 2"
                  strokeWidth="1"
                />
              </svg>
              <p className="text-[11px] text-gray-500 mt-1">
                {t.pts.length} readings • {t.pts[0]?.date} →{" "}
                {t.pts[t.pts.length - 1]?.date}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
