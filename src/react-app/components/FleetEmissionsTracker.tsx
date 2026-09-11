/* FleetEmissionsTracker — reverse-engineered Shell Fleet Solutions
 * "Decarbonise your fleet": estimates CO₂ emissions per fleet vehicle from
 * recorded fuel consumption (litres × DEFRA/IPCC emission factors), shows
 * the fleet total, and tracks a reduction target. Factors: petrol 2.31,
 * diesel 2.68, kerosene 2.53 kg CO₂e per litre (standard IPCC defaults).
 * Cloud KV `fleet_emissions_log` (station-scoped fuel-use entries) +
 * `fleet_emissions_target_pct` (reduction target %).
 */
import { Download, Leaf, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const LOG_KEY = "fleet_emissions_log";
const TARGET_KEY = "fleet_emissions_target_pct";

const FACTORS: Record<string, number> = {
  petrol: 2.31,
  diesel: 2.68,
  kerosene: 2.53,
  lpg: 1.51,
  cng: 2.75, // per kg — noted inline
};

interface EmissionEntry {
  id: string;
  vehicle: string;
  fuel: string;
  litres: number;
  date: string;
  co2Kg: number;
}

function id() {
  return `em_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function FleetEmissionsTracker() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const { data: entries, setData: setEntries } = useCloudKV<EmissionEntry[]>(
    LOG_KEY,
    stationId,
    [],
  );
  const { data: targetPct, setData: setTargetPct } = useCloudKV<number>(
    TARGET_KEY,
    stationId,
    10,
  );

  const [form, setForm] = useState({ vehicle: "", fuel: "diesel", litres: "" });
  const [targetInput, setTargetInput] = useState("");

  const totals = useMemo(() => {
    const byVehicle = new Map<string, number>();
    let total = 0;
    for (const e of entries || []) {
      byVehicle.set(e.vehicle, (byVehicle.get(e.vehicle) ?? 0) + e.co2Kg);
      total += e.co2Kg;
    }
    return {
      total,
      byVehicle: Array.from(byVehicle.entries())
        .map(([vehicle, co2Kg]) => ({ vehicle, co2Kg }))
        .sort((a, b) => b.co2Kg - a.co2Kg),
    };
  }, [entries]);

  const target = targetPct ?? 10;
  const targetKg = totals.total * (1 - target / 100);
  const maxBar = Math.max(1, ...totals.byVehicle.map((v) => v.co2Kg));

  const addEntry = () => {
    const vehicle = form.vehicle.trim().toUpperCase();
    const litres = parseFloat(form.litres);
    if (!vehicle) return toastError("Vehicle is required.");
    if (!Number.isFinite(litres) || litres <= 0)
      return toastError("Litres must be greater than 0.");
    const factor = FACTORS[form.fuel] ?? FACTORS.diesel;
    setEntries([
      {
        id: id(),
        vehicle,
        fuel: form.fuel,
        litres,
        date: new Date().toISOString().split("T")[0],
        co2Kg: Math.round(litres * factor * 100) / 100,
      },
      ...(entries || []),
    ]);
    setForm({ vehicle: "", fuel: form.fuel, litres: "" });
    toastSuccess("Fuel use logged — emissions updated.");
  };

  const applyTarget = () => {
    const n = parseFloat(targetInput);
    if (Number.isFinite(n) && n > 0 && n <= 90) {
      setTargetPct(n);
      setTargetInput("");
      toastSuccess(`Reduction target set to ${n}%.`);
    } else {
      toastError("Enter a target between 1 and 90%.");
    }
  };

  const exportCsv = () => {
    const csv = [
      "Date,Vehicle,Fuel,Litres,CO2 (kg)",
      ...(entries || []).map((e) =>
        [e.date, e.vehicle, e.fuel, e.litres, e.co2Kg].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `fleet-emissions-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Emissions log exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Leaf className="w-5 h-5 text-emerald-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Fleet CO₂ Emissions
            </h4>
            <p className="text-xs text-gray-500">
              Estimated emissions from recorded fuel use (Shell fleet
              decarbonisation). Total:{" "}
              <span className="font-semibold">
                {(totals.total / 1000).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                t CO₂e
              </span>{" "}
              · target −{target}% →{" "}
              <span className="font-semibold text-emerald-600">
                {(targetKg / 1000).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                t
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={(entries || []).length === 0}
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Vehicle</p>
          <input
            value={form.vehicle}
            onChange={(e) =>
              setForm((f) => ({ ...f, vehicle: e.target.value }))
            }
            placeholder="KDA 123A"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Fuel</p>
          <select
            value={form.fuel}
            onChange={(e) => setForm((f) => ({ ...f, fuel: e.target.value }))}
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="diesel">Diesel</option>
            <option value="petrol">Petrol</option>
            <option value="kerosene">Kerosene</option>
            <option value="lpg">LPG</option>
            <option value="cng">CNG (per kg)</option>
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Litres</p>
          <input
            type="number"
            min={0}
            value={form.litres}
            onChange={(e) => setForm((f) => ({ ...f, litres: e.target.value }))}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addEntry} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Log Use
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">Reduction target:</span>
        <input
          type="number"
          min={1}
          max={90}
          value={targetInput}
          onChange={(e) => setTargetInput(e.target.value)}
          placeholder={`${target}%`}
          className="w-16 px-2 py-1 rounded text-xs"
        />
        <button
          onClick={applyTarget}
          className="btn btn-secondary !p-1.5 !text-xs"
        >
          Apply
        </button>
      </div>

      {totals.byVehicle.length > 0 && (
        <div className="space-y-1.5">
          {totals.byVehicle.map((v) => (
            <div key={v.vehicle} className="flex items-center gap-2 text-xs">
              <span className="w-24 truncate font-medium">{v.vehicle}</span>
              <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${(v.co2Kg / maxBar) * 100}%` }}
                />
              </div>
              <span className="w-24 text-right">
                {v.co2Kg.toLocaleString(undefined, {
                  maximumFractionDigits: 1,
                })}{" "}
                kg
              </span>
            </div>
          ))}
        </div>
      )}

      {(entries || []).length > 0 && (
        <button
          onClick={() => {
            if (window.confirm("Clear the emissions log?")) setEntries([]);
          }}
          className="text-xs text-red-500 flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" /> Clear log
        </button>
      )}
    </div>
  );
}
