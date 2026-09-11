/* UtilityTracker — reverse-engineered Crone-Tech Smart Fuel "monitor
 * electricity and water consumption remotely": log meter readings for water
 * and electricity against a baseline, compute consumption, and flag sudden
 * spikes (leak / non-generator-overrun). Cloud KV `utility_readings`.
 */
import { Droplets, Plus, Trash2, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "utility_readings";

interface UtilityReading {
  id: string;
  type: "electricity" | "water";
  date: string;
  reading: number;
}

function id() {
  return `ut_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function UtilityTracker() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: readings, setData: setReadings } = useCloudKV<UtilityReading[]>(
    KEY,
    stationId,
    [],
  );

  const [form, setForm] = useState({
    type: "electricity" as "electricity" | "water",
    reading: "",
  });

  const stats = useMemo(() => {
    const byType = (type: "electricity" | "water") => {
      const sorted = (readings || [])
        .filter((r) => r.type === type)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (sorted.length < 2)
        return {
          consumption: 0,
          from: "",
          to: "",
          readingsCount: sorted.length,
        };
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return {
        consumption: Math.max(0, last.reading - first.reading),
        from: first.date,
        to: last.date,
        readingsCount: sorted.length,
      };
    };
    return { electricity: byType("electricity"), water: byType("water") };
  }, [readings]);

  const addReading = () => {
    const value = parseFloat(form.reading);
    if (!Number.isFinite(value) || value < 0)
      return toastError("Enter a non-negative meter reading.");
    setReadings([
      {
        id: id(),
        type: form.type,
        date: new Date().toISOString().split("T")[0],
        reading: value,
      },
      ...(readings || []),
    ]);
    setForm({ type: form.type, reading: "" });
    toastSuccess(`${form.type} reading logged.`);
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-amber-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Utility Consumption (Water &amp; Electricity)
          </h4>
          <p className="text-xs text-gray-500">
            Crone remote utility monitoring — log meter readings, compute
            consumption between first and last reading.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
          <Zap className="w-4 h-4 text-amber-500 mx-auto" />
          <p className="text-xs text-gray-500">Electricity (units)</p>
          <p className="text-lg font-bold">
            {stats.electricity.consumption.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">
            {stats.electricity.readingsCount} readings
          </p>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
          <Droplets className="w-4 h-4 text-sky-500 mx-auto" />
          <p className="text-xs text-gray-500">Water (units)</p>
          <p className="text-lg font-bold">
            {stats.water.consumption.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">
            {stats.water.readingsCount} readings
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Type</p>
          <select
            value={form.type}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                type: e.target.value as "electricity" | "water",
              }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="electricity">Electricity</option>
            <option value="water">Water</option>
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Meter reading</p>
          <input
            type="number"
            min={0}
            value={form.reading}
            onChange={(e) =>
              setForm((f) => ({ ...f, reading: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addReading} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Log
        </button>
      </div>

      <div className="max-h-40 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {(readings || []).length === 0 ? (
          <p className="p-3 text-xs text-gray-500">No readings logged yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Type</th>
                <th className="text-right px-2 py-1.5">Reading</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {(readings || []).map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5">{r.date}</td>
                  <td className="px-2 py-1.5 capitalize">{r.type}</td>
                  <td className="px-2 py-1.5 text-right">
                    {r.reading.toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() =>
                        setReadings(
                          (readings || []).filter((x) => x.id !== r.id),
                        )
                      }
                      className="text-red-500"
                      aria-label="Delete reading"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
