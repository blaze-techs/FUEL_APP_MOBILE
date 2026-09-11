/* MeterProvingLog — dispenser proving/calibration verification register
 * (Livetrac/metrology-style): attendants prove a nozzle against a proving
 * container (e.g. 20 L), record actual vs expected dispensed, and the log
 * computes drift % — pass if within ±0.5%.
 */
import { FlaskConical, Plus } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { emitFeatureEvent } from "@/react-app/lib/feature-events";

interface ProvingEntry {
  id: string;
  date: string;
  nozzle: string;
  targetLitres: number;
  actualLitres: number;
  driftPct: number;
  passed: boolean;
}

export default function MeterProvingLog() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: entries, setData: setEntries } = useCloudKV<ProvingEntry[]>(
    "meter_proving_log",
    stationId,
    [],
  );
  const [nozzle, setNozzle] = useState("");
  const [target, setTarget] = useState("20");
  const [actual, setActual] = useState("");

  const addEntry = () => {
    const t = Number(target);
    const a = Number(actual);
    if (!nozzle.trim() || !t || !a || t <= 0) return;
    const driftPct = ((a - t) / t) * 100;
    const passed = Math.abs(driftPct) <= 0.5;
    const entry: ProvingEntry = {
      id: `mp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      date: new Date().toISOString().slice(0, 10),
      nozzle: nozzle.trim(),
      targetLitres: t,
      actualLitres: a,
      driftPct,
      passed,
    };
    setEntries((prev) => [...(prev || []), entry]);
    emitFeatureEvent({
      type: passed ? "meter-proving.pass" : "meter-proving.fail",
      payload: { nozzle: entry.nozzle, driftPct },
    });
    setNozzle("");
    setActual("");
  };

  const passCount = (entries || []).filter((e) => e.passed).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <FlaskConical size={16} /> Meter Proving Log
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Dispenser proving checks vs a proving container. Pass = within ±0.5%
        drift. {entries?.length || 0} checks, {passCount} passed.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={nozzle}
          onChange={(e) => setNozzle(e.target.value)}
          placeholder="Nozzle ID (e.g. PMS-2)"
          className="w-40 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          type="number"
          placeholder="Target L"
          className="w-24 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          type="number"
          placeholder="Actual L"
          className="w-24 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addEntry}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Log check
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b dark:border-gray-700">
              <th className="py-2">Date</th>
              <th>Nozzle</th>
              <th className="text-right">Target</th>
              <th className="text-right">Actual</th>
              <th className="text-right">Drift</th>
              <th className="text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {(entries || []).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-3 text-center text-gray-500">
                  No proving checks logged yet.
                </td>
              </tr>
            ) : (
              [...(entries || [])]
                .reverse()
                .slice(0, 40)
                .map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-gray-100 dark:border-gray-700/60"
                  >
                    <td className="py-1.5">{e.date}</td>
                    <td className="font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                      {e.nozzle}
                    </td>
                    <td className="text-right">{e.targetLitres} L</td>
                    <td className="text-right">{e.actualLitres} L</td>
                    <td
                      className={`text-right font-medium ${e.passed ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {e.driftPct > 0 ? "+" : ""}
                      {e.driftPct.toFixed(2)}%
                    </td>
                    <td className="text-right">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${e.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
                      >
                        {e.passed ? "PASS" : "FAIL"}
                      </span>
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
