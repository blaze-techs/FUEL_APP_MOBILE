/* GeneratorFuelTracker — backup generator/powe equipment registry.
 * Reverse-engineered from pergamongroup.com (power equipment). Tracks
 * generators, their fuel tanks, refills and runtime — fuel consumed by
 * generators must still reconcile. Cloud KV `generator_fuel_tracker`.
 */
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Fuel,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { downloadCsv } from "@/react-app/lib/forecourt-features";
import { getFuelLabel } from "@/react-app/config/pricing";
import { toastError, toastSuccess } from "@/react-app/lib/toast";

interface GeneratorUnit {
  id: string;
  name: string;
  capacityKva?: number;
  fuelType: string;
  tankCapacityL: number;
  currentLevelL: number;
  runtimeHours: number;
  notes?: string;
}

const KEY = "generator_fuel_tracker";

export default function GeneratorFuelTracker() {
  const { currentStation } = useStations();
  const { data: units, setData: setUnits } = useCloudKV<GeneratorUnit[]>(
    KEY,
    currentStation?.id,
    [],
  );
  const [open, setOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    capacityKva: "",
    fuelType: "diesel",
    tankCapacityL: "",
    currentLevelL: "",
  });

  const totals = useMemo(
    () => ({
      count: units.length,
      levelL: units.reduce((s, u) => s + (u.currentLevelL || 0), 0),
      runtime: units.reduce((s, u) => s + (u.runtimeHours || 0), 0),
    }),
    [units],
  );

  const handleSave = () => {
    if (!form.name.trim()) {
      toastError("Generator name required.");
      return;
    }
    const tank = parseFloat(form.tankCapacityL) || 0;
    const level = parseFloat(form.currentLevelL) || 0;
    if (tank <= 0) {
      toastError("Tank capacity > 0 required.");
      return;
    }
    const u: GeneratorUnit = {
      id: `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: form.name.trim(),
      capacityKva: parseFloat(form.capacityKva) || undefined,
      fuelType: form.fuelType,
      tankCapacityL: tank,
      currentLevelL: Math.min(level, tank),
      runtimeHours: 0,
    };
    setUnits((p) => [u, ...p]);
    setShowForm(false);
    setForm({
      name: "",
      capacityKva: "",
      fuelType: "diesel",
      tankCapacityL: "",
      currentLevelL: "",
    });
    toastSuccess("Generator registered.");
  };

  const handleRefill = (id: string) => {
    setUnits((p) =>
      p.map((u) =>
        u.id === id ? { ...u, currentLevelL: u.tankCapacityL } : u,
      ),
    );
    toastSuccess("Generator refilled (full tank logged).");
  };
  const handleDelete = (id: string) => {
    setUnits((p) => p.filter((u) => u.id !== id));
    toastSuccess("Generator deleted.");
  };
  const addRuntime = (id: string, hours: number) => {
    if (!Number.isFinite(hours) || hours <= 0) return;
    setUnits((p) =>
      p.map((u) =>
        u.id === id
          ? {
              ...u,
              runtimeHours: (u.runtimeHours || 0) + hours,
              // burn ~0.8 L/h for small gensets, scale up by tank capacity
              currentLevelL: Math.max(0, (u.currentLevelL || 0) - hours * 0.8),
            }
          : u,
      ),
    );
  };

  const exportCsv = () =>
    downloadCsv("generator-fuel-tracker.csv", [
      ["Generator", "Fuel", "Tank (L)", "Level (L)", "Runtime (h)", "KVA"],
      ...units.map((u) => [
        u.name,
        getFuelLabel(u.fuelType),
        u.tankCapacityL,
        u.currentLevelL.toFixed(1),
        u.runtimeHours.toFixed(1),
        u.capacityKva ?? "",
      ]),
    ]);

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-blue-500" />
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Generator / Power Fuel Tracker
            </h3>
            <p className="text-xs text-gray-500">
              Backup generator unit registry + fuel stock (pergamongroup
              reverse-engineer). Runtime burns ~0.8 L/h.
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {open ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      </div>
      {open && (
        <>
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
            <div>
              <p className="text-[10px] uppercase text-gray-500">Units</p>
              <p className="font-bold">{totals.count}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">
                Fuel on hand (L)
              </p>
              <p className="font-bold text-blue-600">
                {totals.levelL.toFixed(0)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">
                Total runtime (h)
              </p>
              <p className="font-bold text-amber-600">
                {totals.runtime.toFixed(1)}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => setShowForm((v) => !v)}
            >
              <Plus className="w-4 h-4" /> Register generator
            </button>
            <button className="btn btn-secondary" onClick={exportCsv}>
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
          {showForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="rounded border p-3 space-y-2"
            >
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  className="input"
                  placeholder="Generator name *"
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                />
                <input
                  className="input"
                  placeholder="Capacity (KVA)"
                  value={form.capacityKva}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, capacityKva: e.target.value }))
                  }
                />
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                <select
                  className="input"
                  value={form.fuelType}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, fuelType: e.target.value }))
                  }
                >
                  <option value="diesel">Diesel</option>
                  <option value="petrol">Petrol</option>
                </select>
                <input
                  className="input"
                  placeholder="Tank capacity (L) *"
                  value={form.tankCapacityL}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, tankCapacityL: e.target.value }))
                  }
                />
                <input
                  className="input"
                  placeholder="Current level (L)"
                  value={form.currentLevelL}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, currentLevelL: e.target.value }))
                  }
                />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn btn-primary">
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {units.length > 0 ? (
            <ul className="space-y-2">
              {units.map((u) => {
                const pct =
                  u.tankCapacityL > 0
                    ? (u.currentLevelL / u.tankCapacityL) * 100
                    : 0;
                return (
                  <li
                    key={u.id}
                    className="rounded border p-3 text-sm flex flex-wrap items-center gap-2"
                  >
                    <span className="font-medium">{u.name}</span>
                    <span className="text-xs text-gray-500">
                      {getFuelLabel(u.fuelType)}
                      {u.capacityKva ? ` · ${u.capacityKva} KVA` : ""}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        pct > 40
                          ? "bg-green-100 text-green-700"
                          : pct > 15
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {u.currentLevelL.toFixed(1)} / {u.tankCapacityL} L
                    </span>
                    <span className="text-xs text-gray-400">
                      runtime {u.runtimeHours.toFixed(1)}h
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => handleRefill(u.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Refill
                      </button>
                      <button
                        onClick={() => addRuntime(u.id, 1)}
                        className="text-xs text-amber-600 hover:underline"
                      >
                        +1h
                      </button>
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="text-rose-500"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded border border-dashed p-4 text-center text-xs text-gray-500">
              <Fuel className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              No backup generators registered.
            </div>
          )}
        </>
      )}
    </div>
  );
}
