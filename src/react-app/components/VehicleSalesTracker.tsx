/* VehicleSalesTracker — reverse-engineered Codelab FMS "Vehicle wise Sales":
 * fuel sales grouped by vehicle registration plate with litres, amount,
 * and visit count. Fleet customers refuel many times — this view ranks
 * vehicles by spend so the owner can spot the best fleet accounts.
 * Cloud KV `vehicle_sales` (station-scoped).
 */
import { CarFront, Download, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "vehicle_sales";

interface VehicleSale {
  id: string;
  plate: string;
  driver: string;
  fuelType: string;
  date: string;
  litres: number;
  amount: number;
}

function id() {
  return `vs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function VehicleSalesTracker() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: sales, setData: setSales } = useCloudKV<VehicleSale[]>(
    KEY,
    stationId,
    [],
  );

  const [form, setForm] = useState({
    plate: "",
    driver: "",
    fuelType: "",
    litres: "",
    amount: "",
  });

  const byVehicle = useMemo(() => {
    const map = new Map<
      string,
      {
        plate: string;
        driver: string;
        litres: number;
        amount: number;
        visits: number;
      }
    >();
    for (const s of sales || []) {
      const row = map.get(s.plate) ?? {
        plate: s.plate,
        driver: s.driver,
        litres: 0,
        amount: 0,
        visits: 0,
      };
      row.litres += s.litres;
      row.amount += s.amount;
      row.visits += 1;
      if (s.driver) row.driver = s.driver;
      map.set(s.plate, row);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [sales]);

  const addSale = () => {
    const plate = form.plate.trim().toUpperCase();
    const litres = parseFloat(form.litres);
    const amount = parseFloat(form.amount);
    if (!plate) return toastError("Vehicle plate is required.");
    if (!Number.isFinite(litres) || litres <= 0)
      return toastError("Litres must be greater than 0.");
    if (!Number.isFinite(amount) || amount <= 0)
      return toastError("Amount must be greater than 0.");
    setSales([
      {
        id: id(),
        plate,
        driver: form.driver.trim(),
        fuelType: form.fuelType.trim(),
        date: new Date().toISOString().split("T")[0],
        litres,
        amount,
      },
      ...(sales || []),
    ]);
    setForm({ plate: "", driver: "", fuelType: "", litres: "", amount: "" });
    toastSuccess(`Sale recorded for ${plate}.`);
  };

  const exportCsv = () => {
    const csv = [
      "Plate,Driver,Litres,Amount,Visits",
      ...byVehicle.map((v) =>
        [v.plate, v.driver, v.litres, v.amount, v.visits].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vehicle-sales-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Vehicle sales exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CarFront className="w-5 h-5 text-amber-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Vehicle-wise Sales
            </h4>
            <p className="text-xs text-gray-500">
              Fuel sales grouped by vehicle plate (Codelab vehicle-wise sales
              report). Ranks fleet vehicles by spend.
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={byVehicle.length === 0}
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
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
          <p className="text-xs text-gray-500">Fuel</p>
          <input
            value={form.fuelType}
            onChange={(e) =>
              setForm((f) => ({ ...f, fuelType: e.target.value }))
            }
            placeholder="Super Petrol"
            className="px-2 py-1 rounded text-xs"
          />
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
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Amount</p>
          <input
            type="number"
            min={0}
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addSale} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Record
        </button>
      </div>

      <div className="max-h-72 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {byVehicle.length === 0 ? (
          <p className="p-3 text-xs text-gray-500">
            No vehicle sales recorded yet.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Plate</th>
                <th className="text-left px-2 py-1.5">Driver</th>
                <th className="text-right px-2 py-1.5">Litres</th>
                <th className="text-right px-2 py-1.5">Amount</th>
                <th className="text-right px-2 py-1.5">Visits</th>
              </tr>
            </thead>
            <tbody>
              {byVehicle.map((v) => (
                <tr
                  key={v.plate}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5 font-medium">{v.plate}</td>
                  <td className="px-2 py-1.5">{v.driver || "—"}</td>
                  <td className="px-2 py-1.5 text-right">
                    {v.litres.toLocaleString()} L
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {currency}
                    {v.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-2 py-1.5 text-right">{v.visits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(sales || []).length > 0 && (
        <button
          onClick={() => {
            if (window.confirm("Clear all vehicle sales history?"))
              setSales([]);
          }}
          className="text-xs text-red-500 flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" /> Clear history
        </button>
      )}
    </div>
  );
}
