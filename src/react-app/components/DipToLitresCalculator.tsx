/* DipToLitresCalculator — forecourt dip-chart helper (Gilbarco/ATG-style):
 * keeps a per-station calibration chart (mm → litres) in a station-scoped
 * cloud KV so attendants can convert a dipstick reading to litres instantly.
 * Distinct from TankCalibration (which manages the uploadable chart tables);
 * this is the quick attendant-facing lookup tool.
 */
import { Droplet, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";

interface ChartPoint {
  mm: number;
  litres: number;
}

export default function DipToLitresCalculator() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: points, setData: setPoints } = useCloudKV<ChartPoint[]>(
    "dip_chart_points",
    stationId,
    [],
  );
  const [mm, setMm] = useState("");
  const [litres, setLitres] = useState("");
  const [query, setQuery] = useState("");

  const sorted = useMemo(
    () => [...(points || [])].sort((a, b) => a.mm - b.mm),
    [points],
  );

  const addPoint = () => {
    const pMm = Number(mm);
    const pL = Number(litres);
    if (!pMm || !pL || pMm <= 0 || pL <= 0) return;
    setPoints((prev) => [...(prev || []), { mm: pMm, litres: pL }]);
    setMm("");
    setLitres("");
  };

  const removePoint = (idx: number) =>
    setPoints((prev) => (prev || []).filter((_, i) => i !== idx));

  const lookup = useMemo(() => {
    const q = Number(query);
    if (!q || sorted.length < 2) return null;
    if (q <= sorted[0].mm) return sorted[0].litres;
    if (q >= sorted[sorted.length - 1].mm)
      return sorted[sorted.length - 1].litres;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (q >= a.mm && q <= b.mm) {
        const t = (q - a.mm) / (b.mm - a.mm);
        return a.litres + t * (b.litres - a.litres);
      }
    }
    return null;
  }, [query, sorted]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Droplet size={16} /> Dip-to-Litres Calculator
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Maintain the tank dip chart; enter a dipstick reading to get litres
        instantly (linear interpolation between chart points).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Chart points (mm → litres)
          </h4>
          <div className="flex gap-2 mb-2">
            <input
              value={mm}
              onChange={(e) => setMm(e.target.value)}
              type="number"
              placeholder="mm"
              className="w-24 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
            />
            <input
              value={litres}
              onChange={(e) => setLitres(e.target.value)}
              type="number"
              placeholder="litres"
              className="w-28 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
            />
            <button
              onClick={addPoint}
              className="bg-amber-500 text-gray-900 rounded px-2 py-1.5 text-sm font-medium fp-icon-only"
              title="Add"
              aria-label="Add"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {sorted.length === 0 ? (
              <p className="text-xs text-gray-500">
                No chart points yet — add at least two (e.g. 0 mm = 0 L, 1000 mm
                = 10,000 L).
              </p>
            ) : (
              sorted.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-700/60 rounded px-2 py-1"
                >
                  <span>
                    {p.mm} mm → {p.litres.toLocaleString()} L
                  </span>
                  <button
                    onClick={() => removePoint(i)}
                    className="text-red-500 hover:text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Quick dip lookup
          </h4>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="number"
            placeholder="Dip reading (mm)"
            className="w-full rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-4 text-center">
            {lookup === null ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {sorted.length < 2
                  ? "Add at least two chart points to enable lookups"
                  : "Enter a dip reading to compute litres"}
              </p>
            ) : (
              <>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-300">
                  {lookup.toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}{" "}
                  L
                </p>
                <p className="text-xs text-gray-500">
                  from {Number(query).toLocaleString()} mm dip
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
