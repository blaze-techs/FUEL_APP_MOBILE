/* HoseReplacementLog — dispenser hose lifecycle register (Livetrac/
 * hardware-maintenance style): each nozzle's hose age/replacement history
 * in a cloud KV so cracked or aged hoses are swapped on schedule.
 */
import { Replace, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface HoseEntry {
  id: string;
  nozzle: string;
  replacedAt: string;
  reason: string;
}

const MAX_AGE_DAYS = 365;

export default function HoseReplacementLog() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: entries, setData: setEntries } = useCloudKV<HoseEntry[]>(
    "hose_log",
    stationId,
    [],
  );
  const [nozzle, setNozzle] = useState("");
  const [reason, setReason] = useState("");

  const addEntry = () => {
    if (!nozzle.trim()) return;
    setEntries((prev) => [
      ...(prev || []),
      {
        id: `hs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        nozzle: nozzle.trim(),
        replacedAt: new Date().toISOString().slice(0, 10),
        reason: reason.trim() || "Scheduled",
      },
    ]);
    setNozzle("");
    setReason("");
  };

  const latestByNozzle = useMemo(() => {
    const byNozzle = new Map<string, HoseEntry>();
    for (const e of entries || []) {
      const cur = byNozzle.get(e.nozzle);
      if (!cur || e.replacedAt > cur.replacedAt) byNozzle.set(e.nozzle, e);
    }
    return [...byNozzle.values()].map((e) => ({
      ...e,
      ageDays: Math.max(
        0,
        Math.floor((Date.now() - new Date(e.replacedAt).getTime()) / 86400000),
      ),
    }));
  }, [entries]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Replace size={16} /> Hose Replacement Log
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {latestByNozzle.length} nozzles tracked. Hoses older than {MAX_AGE_DAYS}{" "}
        days are flagged.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={nozzle}
          onChange={(e) => setNozzle(e.target.value)}
          placeholder="Nozzle ID (e.g. PMS-1)"
          className="w-40 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="flex-1 min-w-[160px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addEntry}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Record swap
        </button>
      </div>
      <div className="space-y-1.5">
        {latestByNozzle.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">
            No hose swaps recorded yet.
          </p>
        ) : (
          latestByNozzle.map((e) => (
            <div
              key={e.id}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${e.ageDays > MAX_AGE_DAYS ? "border-red-300 bg-red-50 dark:bg-red-900/20" : "border-gray-200 dark:border-gray-600"}`}
            >
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  {e.nozzle}
                </p>
                <p className="text-[11px] text-gray-500">
                  swapped {e.replacedAt} • {e.reason}
                </p>
              </div>
              <span
                className={`text-xs font-medium ${e.ageDays > MAX_AGE_DAYS ? "text-red-600" : "text-emerald-600"}`}
              >
                {e.ageDays} days old
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
