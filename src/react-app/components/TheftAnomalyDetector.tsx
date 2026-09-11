/* TheftAnomalyDetector — explicit theft/anomaly detector on tank readings.
 * Reverse-engineered from the telematics fuel-monitoring vector
 * (trackntrace/karooooo/blackboxgps/naj/sicuro): scans tank readings and
 * flags sudden drops beyond running average — a heuristics layer on top of
 * TankMonitor data. Cloud KV `theft_anomaly_threshold`.
 * (Not a duplicate — TankMonitor stores readings & classifications; this
 * detector scores anomalies with a tunable threshold.)
 */
import { AlertTriangle, Gauge } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type TankReading,
} from "@/react-app/lib/forecourt-features";
import { computeAnomalies } from "@/react-app/lib/theft-anomaly";
import { toastSuccess } from "@/react-app/lib/toast";

const THRESHOLD_KEY = "theft_anomaly_threshold_pct";
const DEFAULT_THRESHOLD = 3;

export default function TheftAnomalyDetector() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: readings } = useCloudKV<TankReading[]>(
    CLOUD_KEYS.tankReadings,
    stationId,
    [],
  );
  const { data: threshold, setData: setThreshold } = useCloudKV<number>(
    THRESHOLD_KEY,
    stationId,
    DEFAULT_THRESHOLD,
  );
  const [input, setInput] = useState("");

  const anomalies = useMemo(
    () => computeAnomalies(readings || [], threshold ?? DEFAULT_THRESHOLD),
    [readings, threshold],
  );

  const handleApply = (value: string) => {
    const n = parseFloat(value || input);
    if (Number.isFinite(n) && n > 0) {
      setThreshold(n);
      setInput("");
      toastSuccess(`Anomaly threshold set to ${n}%.`);
    }
  };

  return (
    <div className="card space-y-3 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Theft / Anomaly Detector
            </h4>
            <p className="text-xs text-gray-500">
              Flags sudden drops in tank readings (telematics fuel-theft
              vector). Tunable threshold, scores against consecutive per-fuel
              readings.
            </p>
          </div>
        </div>
        <div className="flex gap-1 items-center">
          <input
            className="input w-20"
            placeholder={`${threshold ?? DEFAULT_THRESHOLD}%`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            className="btn btn-secondary"
            onClick={() => handleApply(input)}
          >
            Set
          </button>
        </div>
      </div>
      {readings.length < 2 ? (
        <p className="text-xs text-gray-500">
          At least 2 readings per fuel needed to detect anomalies. Add readings
          in Tank Monitor / Telemetry Ingest.
        </p>
      ) : anomalies.length === 0 ? (
        <p className="text-xs text-gray-500 rounded border p-2">
          No anomalies detected (drop threshold {threshold}%). ✓
        </p>
      ) : (
        <ul className="space-y-1.5">
          {anomalies.map((a) => (
            <li
              key={a.id}
              className="rounded border p-2 text-sm flex flex-wrap items-center gap-2"
            >
              <Gauge className="w-4 h-4 text-rose-500" />
              <span className="font-medium">{a.fuelLabel}</span>
              <span className="text-xs text-gray-500">
                {a.fromLevel.toLocaleString()} → {a.toLevel.toLocaleString()} L
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                -{a.dropPct.toFixed(1)}%
              </span>
              <span className="text-xs text-gray-400">
                {new Date(a.date).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
