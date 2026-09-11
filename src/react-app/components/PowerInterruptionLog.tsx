/* PowerInterruptionLog — pergamongroup/power-style grid outage register:
 * logs grid interruptions (start → end), computes downtime and whether the
 * backup generator picked up the load. Cloud KV `power_outages`.
 */
import { Zap, ZapOff, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface Outage {
  id: string;
  date: string;
  startTime: string;
  durationMin: number;
  generatorRan: boolean;
}

export default function PowerInterruptionLog() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: outages, setData: setOutages } = useCloudKV<Outage[]>(
    "power_outages",
    stationId,
    [],
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const [generatorRan, setGeneratorRan] = useState(true);

  const addOutage = () => {
    const d = Number(duration);
    if (!startTime.trim() || !d || d <= 0) return;
    setOutages((prev) => [
      ...(prev || []),
      {
        id: `po_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date,
        startTime: startTime.trim(),
        durationMin: d,
        generatorRan,
      },
    ]);
    setStartTime("");
    setDuration("");
  };

  const stats = useMemo(() => {
    const list = outages || [];
    const totalMin = list.reduce((s, o) => s + o.durationMin, 0);
    const genRuns = list.filter((o) => o.generatorRan).length;
    return {
      count: list.length,
      avgMin: list.length ? Math.round(totalMin / list.length) : 0,
      genCoverage: list.length ? Math.round((genRuns / list.length) * 100) : 0,
    };
  }, [outages]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <ZapOff size={16} /> Power Interruptions
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {stats.count} outages logged • avg {stats.avgMin} min • generator
        coverage {stats.genCoverage}%.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          type="date"
          className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          type="time"
          className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          type="number"
          placeholder="Duration (min)"
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={generatorRan}
            onChange={(e) => setGeneratorRan(e.target.checked)}
          />
          Generator ran
        </label>
        <button
          onClick={addOutage}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Log outage
        </button>
      </div>
      <div className="space-y-1.5">
        {(outages || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-2">
            No outages logged — great connectivity.
          </p>
        ) : (
          [...(outages || [])]
            .reverse()
            .slice(0, 20)
            .map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              >
                {o.generatorRan ? (
                  <Zap size={14} className="text-amber-500" />
                ) : (
                  <ZapOff size={14} className="text-red-500" />
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  {o.date} at {o.startTime}
                </span>
                <span className="text-sm text-gray-500">
                  {o.durationMin} min
                </span>
                <span
                  className={`ml-auto text-xs font-medium ${o.generatorRan ? "text-emerald-600" : "text-red-600"}`}
                >
                  {o.generatorRan ? "Generator OK" : "No backup"}
                </span>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
