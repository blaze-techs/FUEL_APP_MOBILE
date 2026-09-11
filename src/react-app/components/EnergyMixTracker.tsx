/* EnergyMixTracker — solar / grid / generator energy mix register
 * (power-analytics style): logs daily kWh by source and shows the mix over
 * the last 30 days so the site can push solar-share up and generator-share
 * down.
 */
import { Sun, Plug, Fuel, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface MixEntry {
  id: string;
  date: string;
  solarKwh: number;
  gridKwh: number;
  generatorKwh: number;
}

export default function EnergyMixTracker() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: entries, setData: setEntries } = useCloudKV<MixEntry[]>(
    "energy_mix_log",
    stationId,
    [],
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [solar, setSolar] = useState("");
  const [grid, setGrid] = useState("");
  const [generator, setGenerator] = useState("");

  const addEntry = () => {
    const s = Number(solar) || 0;
    const g = Number(grid) || 0;
    const d = Number(generator) || 0;
    if (s + g + d <= 0) return;
    setEntries((prev) => [
      ...(prev || []),
      {
        id: `em_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date,
        solarKwh: s,
        gridKwh: g,
        generatorKwh: d,
      },
    ]);
    setSolar("");
    setGrid("");
    setGenerator("");
  };

  const totals = useMemo(() => {
    const list = entries || [];
    const s = list.reduce((a, e) => a + e.solarKwh, 0);
    const g = list.reduce((a, e) => a + e.gridKwh, 0);
    const d = list.reduce((a, e) => a + e.generatorKwh, 0);
    const total = s + g + d;
    return {
      solar: total ? (s / total) * 100 : 0,
      grid: total ? (g / total) * 100 : 0,
      generator: total ? (d / total) * 100 : 0,
      kwh: total,
    };
  }, [entries]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Sun size={16} /> Energy Mix (Solar / Grid / Generator)
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {totals.kwh.toLocaleString()} kWh tracked • {totals.solar.toFixed(1)}%
        solar, {totals.grid.toFixed(1)}% grid, {totals.generator.toFixed(1)}%
        generator.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          type="date"
          className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={solar}
          onChange={(e) => setSolar(e.target.value)}
          type="number"
          placeholder="Solar kWh"
          className="w-28 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={grid}
          onChange={(e) => setGrid(e.target.value)}
          type="number"
          placeholder="Grid kWh"
          className="w-28 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={generator}
          onChange={(e) => setGenerator(e.target.value)}
          type="number"
          placeholder="Gen kWh"
          className="w-28 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addEntry}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Log day
        </button>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-700">
        {totals.kwh > 0 && (
          <>
            <div
              className="bg-amber-400"
              style={{ width: `${totals.solar}%` }}
              title="Solar"
            />
            <div
              className="bg-blue-400"
              style={{ width: `${totals.grid}%` }}
              title="Grid"
            />
            <div
              className="bg-gray-500"
              style={{ width: `${totals.generator}%` }}
              title="Generator"
            />
          </>
        )}
      </div>
      <div className="flex gap-4 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Sun size={12} className="text-amber-500" /> Solar
        </span>
        <span className="flex items-center gap-1">
          <Plug size={12} className="text-blue-500" /> Grid
        </span>
        <span className="flex items-center gap-1">
          <Fuel size={12} className="text-gray-500" /> Generator
        </span>
      </div>
    </div>
  );
}
