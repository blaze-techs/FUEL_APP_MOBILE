/* CarWashServices — reverse-engineered Livetrac PTS peripheral support
 * ("car washes") + Pesapal dry-stock/services scope: register the station's
 * non-fuel services (car wash, detailing, tyre pressure, oil change bay…)
 * and log service sales. Revenue feeds the Services sub-tab of Fuel Sales
 * Report so services profit (where the real margin is) is visible apart
 * from regulated fuel margins. Cloud KV `carwash_services` + `carwash_sales`.
 */
import { Download, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const SERVICES_KEY = "carwash_services";
const SALES_KEY = "carwash_sales";

interface Service {
  id: string;
  name: string;
  price: number;
}

interface ServiceSale {
  id: string;
  serviceId: string;
  serviceName: string;
  plate: string;
  date: string;
  amount: number;
}

function id() {
  return `cw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function CarWashServices() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: services, setData: setServices } = useCloudKV<Service[]>(
    SERVICES_KEY,
    stationId,
    [],
  );
  const { data: sales, setData: setSales } = useCloudKV<ServiceSale[]>(
    SALES_KEY,
    stationId,
    [],
  );

  const [serviceForm, setServiceForm] = useState({ name: "", price: "" });
  const [saleForm, setSaleForm] = useState({ serviceId: "", plate: "" });

  const todayRevenue = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return (sales || [])
      .filter((s) => s.date === today)
      .reduce((sum, s) => sum + s.amount, 0);
  }, [sales]);

  const addService = () => {
    const name = serviceForm.name.trim();
    const price = parseFloat(serviceForm.price);
    if (!name) return toastError("Service name is required.");
    if (!Number.isFinite(price) || price <= 0)
      return toastError("Price must be greater than 0.");
    setServices([...(services || []), { id: id(), name, price }]);
    setServiceForm({ name: "", price: "" });
    toastSuccess(`Service "${name}" added.`);
  };

  const recordSale = () => {
    const svc = (services || []).find((s) => s.id === saleForm.serviceId);
    if (!svc) return toastError("Select a service first.");
    setSales([
      {
        id: id(),
        serviceId: svc.id,
        serviceName: svc.name,
        plate: saleForm.plate.trim().toUpperCase(),
        date: new Date().toISOString().split("T")[0],
        amount: svc.price,
      },
      ...(sales || []),
    ]);
    setSaleForm({ serviceId: "", plate: "" });
    toastSuccess(`${svc.name} sold for ${currency}${svc.price}.`);
  };

  const exportCsv = () => {
    const csv = [
      "Date,Service,Plate,Amount",
      ...(sales || []).map((s) =>
        [s.date, s.serviceName, s.plate, s.amount].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `service-sales-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Service sales exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Car Wash &amp; Services
            </h4>
            <p className="text-xs text-gray-500">
              Non-fuel services module (Livetrac car-wash peripheral / Pesapal
              dry stock). Today's services revenue:{" "}
              <span className="font-semibold text-emerald-600">
                {currency}
                {todayRevenue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                })}
              </span>
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={(sales || []).length === 0}
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      {/* Service catalog */}
      <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Services
        </p>
        <div className="flex flex-wrap gap-2">
          {(services || []).map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded text-xs border border-gray-300 dark:border-gray-600"
            >
              {s.name} — {currency}
              {s.price}
              <Trash2
                className="w-3 h-3 text-red-500 cursor-pointer"
                onClick={() =>
                  setServices((services || []).filter((x) => x.id !== s.id))
                }
              />
            </span>
          ))}
          {(services || []).length === 0 && (
            <p className="text-xs text-gray-500">
              No services yet. Add your first (e.g. Full Wash).
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="form-group !mb-0">
            <p className="text-xs text-gray-500">Name</p>
            <input
              value={serviceForm.name}
              onChange={(e) =>
                setServiceForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="e.g. Full Wash"
              className="px-2 py-1 rounded text-xs"
            />
          </div>
          <div className="form-group !mb-0">
            <p className="text-xs text-gray-500">Price</p>
            <input
              type="number"
              min={0}
              value={serviceForm.price}
              onChange={(e) =>
                setServiceForm((f) => ({ ...f, price: e.target.value }))
              }
              className="px-2 py-1 rounded text-xs w-24"
            />
          </div>
          <button
            onClick={addService}
            className="btn btn-secondary !p-2 !text-xs"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {/* Record sale */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Service</p>
          <select
            value={saleForm.serviceId}
            onChange={(e) =>
              setSaleForm((f) => ({ ...f, serviceId: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="">Select…</option>
            {(services || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({currency}
                {s.price})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Vehicle plate (optional)</p>
          <input
            value={saleForm.plate}
            onChange={(e) =>
              setSaleForm((f) => ({ ...f, plate: e.target.value }))
            }
            placeholder="KDA 123A"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={recordSale} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Record Sale
        </button>
      </div>

      {/* Recent sales */}
      <div className="max-h-48 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {(sales || []).length === 0 ? (
          <p className="p-3 text-xs text-gray-500">No service sales yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Service</th>
                <th className="text-left px-2 py-1.5">Plate</th>
                <th className="text-right px-2 py-1.5">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(sales || []).map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5">{s.date}</td>
                  <td className="px-2 py-1.5 font-medium">{s.serviceName}</td>
                  <td className="px-2 py-1.5">{s.plate || "—"}</td>
                  <td className="px-2 py-1.5 text-right">
                    {currency}
                    {s.amount.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                    })}
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
