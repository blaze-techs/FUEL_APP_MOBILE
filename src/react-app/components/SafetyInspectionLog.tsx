/* SafetyInspectionLog — Maratech/HSSE safety-walk register: logs safety
 * inspections (fire equipment, spills, signage) with pass/needs-action
 * status, keeping the station audit trail cloud-synced.
 */
import { ShieldCheck, ShieldAlert, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface Inspection {
  id: string;
  date: string;
  area: string;
  finding: string;
  needsAction: boolean;
  resolved: boolean;
}

export default function SafetyInspectionLog() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: items, setData: setItems } = useCloudKV<Inspection[]>(
    "safety_inspections",
    stationId,
    [],
  );
  const [area, setArea] = useState("");
  const [finding, setFinding] = useState("");
  const [needsAction, setNeedsAction] = useState(false);

  const addItem = () => {
    if (!area.trim() || !finding.trim()) return;
    setItems((prev) => [
      ...(prev || []),
      {
        id: `si_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: new Date().toISOString().slice(0, 10),
        area: area.trim(),
        finding: finding.trim(),
        needsAction,
        resolved: false,
      },
    ]);
    setArea("");
    setFinding("");
    setNeedsAction(false);
  };

  const toggleResolve = (id: string) =>
    setItems((prev) =>
      (prev || []).map((i) =>
        i.id === id ? { ...i, resolved: !i.resolved } : i,
      ),
    );

  const openActions = useMemo(
    () => (items || []).filter((i) => i.needsAction && !i.resolved),
    [items],
  );

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <ShieldCheck size={16} /> Safety Inspection Log
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {openActions.length} open safety actions.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="Area (e.g. Forecourt)"
          className="w-36 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={finding}
          onChange={(e) => setFinding(e.target.value)}
          placeholder="Finding"
          className="flex-1 min-w-[180px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={needsAction}
            onChange={(e) => setNeedsAction(e.target.checked)}
          />
          Needs action
        </label>
        <button
          onClick={addItem}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Log
        </button>
      </div>
      <div className="space-y-1.5">
        {(items || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-2">No inspections logged.</p>
        ) : (
          [...(items || [])]
            .reverse()
            .slice(0, 20)
            .map((i) => (
              <div
                key={i.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              >
                {i.needsAction && !i.resolved ? (
                  <ShieldAlert size={14} className="text-amber-500" />
                ) : (
                  <ShieldCheck size={14} className="text-emerald-500" />
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white ${i.resolved ? "line-through opacity-60" : ""}`}
                  >
                    {i.area}: {i.finding}
                  </p>
                  <p className="text-[11px] text-gray-500">{i.date}</p>
                </div>
                <button
                  onClick={() => toggleResolve(i.id)}
                  className={`rounded px-2 py-1 text-xs font-medium ${i.resolved ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
                >
                  {i.resolved ? "Done" : "Resolve"}
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
