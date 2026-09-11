/* FarmFuelEquipment — agricultural equipment fuel registry.
 * Reverse-engineered from fama.co.ke farm fuel management: tractors /
 * harvesters / pumps, seasonal (planting/harvest) fuel usage, so owners can
 * plan and audit farm consumption. Cloud KV `farm_equipment`.
 */
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Plus,
  Tractor,
  Trash2,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { downloadCsv } from "@/react-app/lib/forecourt-features";
import { toastError, toastSuccess } from "@/react-app/lib/toast";

interface FarmEquipment {
  id: string;
  name: string;
  type: "tractor" | "harvester" | "sprayer" | "pump" | "other";
  season: "planting" | "harvest" | "year-round";
  fuelLitresUsed: number;
  notes?: string;
}

const TYPE_ORDER = [
  "tractor",
  "harvester",
  "sprayer",
  "pump",
  "other",
] as const;
const KEY = "farm_equipment";

export default function FarmFuelEquipment() {
  const { currentStation } = useStations();
  const { data: items, setData: setItems } = useCloudKV<FarmEquipment[]>(
    KEY,
    currentStation?.id,
    [],
  );
  const [open, setOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "tractor" as FarmEquipment["type"],
    season: "year-round" as FarmEquipment["season"],
    fuelLitresUsed: "",
    notes: "",
  });

  const totals = useMemo(
    () => ({
      count: items.length,
      litres: items.reduce((s, i) => s + (i.fuelLitresUsed || 0), 0),
    }),
    [items],
  );

  const handleSave = () => {
    if (!form.name.trim()) {
      toastError("Equipment name required.");
      return;
    }
    const e: FarmEquipment = {
      id: `fe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: form.name.trim(),
      type: form.type,
      season: form.season,
      fuelLitresUsed: parseFloat(form.fuelLitresUsed) || 0,
      notes: form.notes.trim() || undefined,
    };
    setItems((p) => [e, ...p]);
    setForm({
      name: "",
      type: "tractor",
      season: "year-round",
      fuelLitresUsed: "",
      notes: "",
    });
    setShowForm(false);
    toastSuccess("Farm equipment added.");
  };

  const handleDelete = (id: string) => {
    setItems((p) => p.filter((i) => i.id !== id));
    toastSuccess("Equipment removed.");
  };
  const bump = (id: string, litres: number) => {
    setItems((p) =>
      p.map((i) =>
        i.id === id
          ? { ...i, fuelLitresUsed: Math.max(0, i.fuelLitresUsed + litres) }
          : i,
      ),
    );
  };
  const exportCsv = () =>
    downloadCsv("farm-equipment.csv", [
      ["Equipment", "Type", "Season", "Fuel used (L)", "Notes"],
      ...items.map((i) => [
        i.name,
        i.type,
        i.season,
        i.fuelLitresUsed,
        i.notes ?? "",
      ]),
    ]);

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tractor className="w-5 h-5 text-green-600" />
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Farm Equipment Fuel (agri)
            </h3>
            <p className="text-xs text-gray-500">
              Tractors / harvesters / sprayers fuel usage by season (fama.co.ke
              reverse-engineer). Cloud KV `farm_equipment`.
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
          <div className="grid grid-cols-2 gap-3 rounded border p-3">
            <div>
              <p className="text-[10px] uppercase text-gray-500">Items</p>
              <p className="font-bold">{totals.count}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">
                Total fuel used (L)
              </p>
              <p className="font-bold text-green-600">
                {totals.litres.toFixed(0)}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => setShowForm((v) => !v)}
            >
              <Plus className="w-4 h-4" /> Add equipment
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
              <div className="grid sm:grid-cols-3 gap-2">
                <input
                  className="input"
                  placeholder="Equipment name *"
                  value={form.name}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, name: e.target.value }))
                  }
                />
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      type: e.target.value as FarmEquipment["type"],
                    }))
                  }
                >
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={form.season}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      season: e.target.value as FarmEquipment["season"],
                    }))
                  }
                >
                  <option value="planting">planting</option>
                  <option value="harvest">harvest</option>
                  <option value="year-round">year-round</option>
                </select>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  className="input"
                  placeholder="Fuel used (L)"
                  value={form.fuelLitresUsed}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, fuelLitresUsed: e.target.value }))
                  }
                />
                <input
                  className="input"
                  placeholder="Notes"
                  value={form.notes}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, notes: e.target.value }))
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
          {items.length > 0 ? (
            <ul className="space-y-1.5">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="rounded border p-2 text-sm flex flex-wrap items-center gap-2"
                >
                  <span className="font-medium">{i.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 capitalize">
                    {i.type}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 capitalize">
                    {i.season}
                  </span>
                  <span className="text-xs text-gray-500">
                    {i.fuelLitresUsed.toFixed(1)} L
                  </span>
                  {i.notes && (
                    <span className="text-xs text-gray-400">{i.notes}</span>
                  )}
                  <div className="ml-auto flex gap-1">
                    <button
                      className="text-xs text-green-700 hover:underline"
                      onClick={() => bump(i.id, 10)}
                    >
                      +10L
                    </button>
                    <button
                      className="text-rose-500"
                      onClick={() => handleDelete(i.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded border border-dashed p-3 text-center text-xs text-gray-500">
              No farm equipment registered.
            </p>
          )}
        </>
      )}
    </div>
  );
}
