/* TankerRegistry — reverse-engineered Codelab FMS "Tanker management":
 * register the fleet of delivery tankers (plate, capacity, driver, fuel
 * compartments) with active/maintenance status. Delivery Tracker already
 * logs details per delivery — this registers the vehicles that haul them.
 * Cloud KV `tankers` (station-scoped).
 */
import { Fuel, Plus, Trash2, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "tankers";

interface Tanker {
  id: string;
  plate: string;
  driver: string;
  capacity: number;
  compartments: string;
  status: "active" | "maintenance";
}

function id() {
  return `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function TankerRegistry() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: tankers, setData: setTankers } = useCloudKV<Tanker[]>(
    KEY,
    stationId,
    [],
  );

  const [form, setForm] = useState({
    plate: "",
    driver: "",
    capacity: "",
    compartments: "",
  });

  const [filter, setFilter] = useState<"all" | "active" | "maintenance">("all");

  const visible = useMemo(
    () =>
      (tankers || []).filter((t) => filter === "all" || t.status === filter),
    [tankers, filter],
  );

  const addTanker = () => {
    const plate = form.plate.trim().toUpperCase();
    const capacity = parseFloat(form.capacity);
    if (!plate) return toastError("Tanker plate is required.");
    if (!Number.isFinite(capacity) || capacity <= 0)
      return toastError("Capacity (litres) must be greater than 0.");
    setTankers([
      ...(tankers || []),
      {
        id: id(),
        plate,
        driver: form.driver.trim(),
        capacity,
        compartments: form.compartments.trim(),
        status: "active",
      },
    ]);
    setForm({ plate: "", driver: "", capacity: "", compartments: "" });
    toastSuccess(`Tanker ${plate} registered.`);
  };

  const toggleStatus = (tanker: Tanker) => {
    setTankers(
      (tankers || []).map((t) =>
        t.id === tanker.id
          ? { ...t, status: t.status === "active" ? "maintenance" : "active" }
          : t,
      ),
    );
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <Truck className="w-5 h-5 text-sky-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Tanker Registry
          </h4>
          <p className="text-xs text-gray-500">
            Delivery tankers with plates, capacity and status (Codelab tanker
            management).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Plate</p>
          <input
            value={form.plate}
            onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))}
            placeholder="KDA 123A"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Driver</p>
          <input
            value={form.driver}
            onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value }))}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Capacity (L)</p>
          <input
            type="number"
            min={0}
            value={form.capacity}
            onChange={(e) =>
              setForm((f) => ({ ...f, capacity: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Compartments / fuels</p>
          <input
            value={form.compartments}
            onChange={(e) =>
              setForm((f) => ({ ...f, compartments: e.target.value }))
            }
            placeholder="e.g. PMS + AGO"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addTanker} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Register
        </button>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">Filter:</span>
        {(["all", "active", "maintenance"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-1 rounded border text-xs ${
              filter === f
                ? "border-sky-400 text-sky-600"
                : "border-gray-300 text-gray-500"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="max-h-56 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {visible.length === 0 ? (
          <p className="p-3 text-xs text-gray-500">
            No tankers registered yet.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Plate</th>
                <th className="text-left px-2 py-1.5">Driver</th>
                <th className="text-right px-2 py-1.5">Capacity</th>
                <th className="text-left px-2 py-1.5">Compartments</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5 font-medium flex items-center gap-1">
                    <Fuel className="w-3 h-3 text-sky-500" /> {t.plate}
                  </td>
                  <td className="px-2 py-1.5">{t.driver || "—"}</td>
                  <td className="px-2 py-1.5 text-right">
                    {t.capacity.toLocaleString()} L
                  </td>
                  <td className="px-2 py-1.5">{t.compartments || "—"}</td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => toggleStatus(t)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        t.status === "active"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {t.status}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() =>
                        setTankers((tankers || []).filter((x) => x.id !== t.id))
                      }
                      className="text-red-500"
                      aria-label="Delete tanker"
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
