/* BatteryBackupHealth — UPS/battery-bank health monitor (power/reliability
 * style): records battery voltage checks and flags units below the healthy
 * threshold (12.4 V resting ~ 100% charge for a 12 V lead bank).
 */
import { BatteryCharging, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface BatteryCheck {
  id: string;
  date: string;
  unit: string;
  volts: number;
  healthy: boolean;
}

const HEALTHY_VOLTS = 12.4;

export default function BatteryBackupHealth() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: checks, setData: setChecks } = useCloudKV<BatteryCheck[]>(
    "battery_health",
    stationId,
    [],
  );
  const [unit, setUnit] = useState("");
  const [volts, setVolts] = useState("");

  const addCheck = () => {
    const v = Number(volts);
    if (!unit.trim() || !v || v <= 0) return;
    setChecks((prev) => [
      ...(prev || []),
      {
        id: `bc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: new Date().toISOString().slice(0, 10),
        unit: unit.trim(),
        volts: v,
        healthy: v >= HEALTHY_VOLTS,
      },
    ]);
    setUnit("");
    setVolts("");
  };

  const latest = useMemo(() => {
    const byUnit = new Map<string, BatteryCheck>();
    for (const c of checks || []) {
      byUnit.set(c.unit, c);
    }
    return [...byUnit.values()];
  }, [checks]);

  const unhealthyCount = latest.filter((c) => !c.healthy).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <BatteryCharging size={16} /> Battery Backup Health
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {latest.length} units under watch • {unhealthyCount} below{" "}
        {HEALTHY_VOLTS} V.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="Unit (e.g. UPS-1)"
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={volts}
          onChange={(e) => setVolts(e.target.value)}
          type="number"
          step="0.1"
          placeholder="Volts"
          className="w-24 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addCheck}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Log check
        </button>
      </div>
      {latest.length === 0 ? (
        <p className="text-sm text-gray-500">No battery checks yet.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {latest.map((c) => (
            <div
              key={c.unit}
              className={`rounded-lg border px-3 py-2 ${c.healthy ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20" : "border-red-300 bg-red-50 dark:bg-red-900/20"}`}
            >
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-900 dark:text-white">
                {c.unit}
              </p>
              <p className="text-xs text-gray-500">
                {c.volts.toFixed(1)} V • {c.date}
              </p>
              <p
                className={`text-xs font-medium ${c.healthy ? "text-emerald-600" : "text-red-600"}`}
              >
                {c.healthy ? "Healthy" : "Replace / recharge"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
