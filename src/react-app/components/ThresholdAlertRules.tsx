/* ThresholdAlertRules — reverse-engineered Pesapal PFMS "real-time remote
 * monitoring" alert rules: owner defines thresholds (low tank level %,
 * variance %, high water mm, price deviation) evaluated against the latest
 * tank readings, and the matching results light up on the Dashboard's
 * exception feed. Rules persist per station; evaluation is computed from
 * `tank_readings`. Cloud KV `alert_threshold_rules`.
 */
import { Bell, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type TankReading,
} from "@/react-app/lib/forecourt-features";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const RULES_KEY = "alert_threshold_rules";

interface Rule {
  id: string;
  metric: "level" | "variance" | "water";
  operator: "<" | ">" | "|x|>";
  value: number;
  active: boolean;
}

interface AlertHit {
  rule: Rule;
  fuelLabel: string;
  current: number;
}

function id() {
  return `ar_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function metricOf(r: TankReading, metric: Rule["metric"]): number {
  if (metric === "level")
    return r.expectedLevel > 0 ? (r.measuredLevel / r.expectedLevel) * 100 : 0;
  if (metric === "variance") return Math.abs(r.variancePct || 0);
  return r.waterMm ?? 0;
}

export default function ThresholdAlertRules() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: rules, setData: setRules } = useCloudKV<Rule[]>(
    RULES_KEY,
    stationId,
    [],
  );
  const { data: readings } = useCloudKV<TankReading[]>(
    CLOUD_KEYS.tankReadings,
    stationId,
    [],
  );

  const [form, setForm] = useState({
    metric: "level" as Rule["metric"],
    operator: "<" as Rule["operator"],
    value: "",
  });

  const latestPerFuel = useMemo(() => {
    const map = new Map<string, TankReading>();
    for (const r of readings || []) {
      const existing = map.get(r.fuelType);
      if (!existing || r.date > existing.date) map.set(r.fuelType, r);
    }
    return Array.from(map.values());
  }, [readings]);

  const hits = useMemo<AlertHit[]>(() => {
    const out: AlertHit[] = [];
    for (const rule of rules || []) {
      if (!rule.active) continue;
      for (const r of latestPerFuel) {
        if (rule.metric === "water" && (r.waterMm ?? 0) <= rule.value) continue;
        if (
          rule.metric === "variance" &&
          Math.abs(r.variancePct || 0) <= rule.value
        ) {
          continue;
        }
        if (rule.metric === "level") {
          const pct =
            r.expectedLevel > 0 ? (r.measuredLevel / r.expectedLevel) * 100 : 0;
          if (pct >= rule.value) continue;
          out.push({
            rule,
            fuelLabel: r.label || r.fuelType,
            current: pct,
          });
          continue;
        }
        out.push({
          rule,
          fuelLabel: r.label || r.fuelType,
          current: metricOf(r, rule.metric),
        });
      }
    }
    return out;
  }, [rules, latestPerFuel]);

  const addRule = () => {
    const value = parseFloat(form.value);
    if (!Number.isFinite(value) || value < 0) {
      toastError("Enter a valid threshold value.");
      return;
    }
    setRules([
      ...(rules || []),
      {
        id: id(),
        metric: form.metric,
        operator: form.operator,
        value,
        active: true,
      },
    ]);
    setForm((f) => ({ ...f, value: "" }));
    toastSuccess("Alert rule added.");
  };

  const METRIC_LABELS: Record<Rule["metric"], string> = {
    level: "Tank level % <",
    variance: "|Variance| % >",
    water: "Water mm >",
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <Bell className="w-5 h-5 text-sky-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Threshold Alert Rules
          </h4>
          <p className="text-xs text-gray-500">
            Pesapal remote-monitoring rules evaluated against latest tank
            readings. {hits.length} active hit(s).
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Trigger when</p>
          <select
            value={form.metric}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                metric: e.target.value as Rule["metric"],
              }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="level">tank level % is below</option>
            <option value="variance">|variance| % exceeds</option>
            <option value="water">water mm exceeds</option>
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Value</p>
          <input
            type="number"
            min={0}
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            className="px-2 py-1 rounded text-xs w-24"
          />
        </div>
        <button onClick={addRule} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Add Rule
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(rules || []).map((r) => (
          <span
            key={r.id}
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${
              r.active
                ? "border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300"
                : "border-gray-300 text-gray-500 dark:border-gray-600"
            }`}
          >
            {METRIC_LABELS[r.metric]} {r.value}
            <button
              onClick={() =>
                setRules(
                  (rules || []).map((x) =>
                    x.id === r.id ? { ...x, active: !x.active } : x,
                  ),
                )
              }
              className="underline"
            >
              {r.active ? "Pause" : "Resume"}
            </button>
            <Trash2
              className="w-3 h-3 text-red-500 cursor-pointer"
              onClick={() =>
                setRules((rules || []).filter((x) => x.id !== r.id))
              }
            />
          </span>
        ))}
        {(rules || []).length === 0 && (
          <p className="text-xs text-gray-500">
            No rules yet — add a threshold to start monitoring.
          </p>
        )}
      </div>

      {hits.length > 0 && (
        <div className="rounded border border-red-300 dark:border-red-700 bg-red-50/60 dark:bg-red-900/20 p-3 space-y-1">
          <p className="text-xs font-semibold text-red-600">Active alerts</p>
          {hits.map((h, i) => (
            <p key={i} className="text-xs text-red-600">
              {h.fuelLabel}: {METRIC_LABELS[h.rule.metric]} {h.rule.value} —
              current{" "}
              {h.current.toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
