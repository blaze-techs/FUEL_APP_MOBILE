import { useMemo, useState } from "react";
import {
  Cpu,
  Plus,
  Trash2,
  Download,
  Fuel,
  Gauge,
  Printer,
  Search,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  CLOUD_KEYS,
  HARDWARE_CATALOG,
  downloadCsv,
  type ForecourtDevice,
  type HardwareCategory,
} from "@/react-app/lib/forecourt-features";

const CATEGORY_META: Record<
  HardwareCategory,
  { label: string; icon: typeof Fuel }
> = {
  dispenser: { label: "Dispensers / Pumps", icon: Fuel },
  atg: { label: "Tank Gauges (ATG)", icon: Gauge },
  peripheral: { label: "Peripherals", icon: Printer },
};

/**
 * ForecourtHardware — registry of forecourt integration hardware
 * (Advatech AdvaForecourt, Livetrac PTS controller, Pesapal Wayne Fusion).
 * The catalog lists the real-world protocol families (IFSF, Wayne TQM,
 * Tokheim, Bennett, Tatsuno, ATG systems, peripherals); each station
 * registers its actual devices with connection parameters so the POS /
 * Integration Hub has an honest inventory of what is wired in.
 */
export default function ForecourtHardware() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const { data: devices, setData: setDevices } = useCloudKV<ForecourtDevice[]>(
    CLOUD_KEYS.forecourtHardware,
    stationId,
    [],
  );

  const [form, setForm] = useState({
    category: "dispenser" as HardwareCategory,
    brandModel: "",
    protocol: "",
    connection: "",
    mappedTo: "",
  });
  const [categoryFilter, setCategoryFilter] = useState<
    HardwareCategory | "all"
  >("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      devices.filter(
        (d) =>
          (categoryFilter === "all" || d.category === categoryFilter) &&
          (query.trim() === "" ||
            d.brandModel.toLowerCase().includes(query.toLowerCase()) ||
            d.protocol.toLowerCase().includes(query.toLowerCase()) ||
            d.mappedTo.toLowerCase().includes(query.toLowerCase())),
      ),
    [devices, categoryFilter, query],
  );

  const suggestion = useMemo(() => {
    const cat = HARDWARE_CATALOG.filter((h) => h.category === form.category);
    return cat.find((h) => h.brandModel === form.brandModel);
  }, [form.category, form.brandModel]);

  const handleAdd = () => {
    if (!form.brandModel.trim()) {
      toastError("Pick a hardware model from the catalog.");
      return;
    }
    const device: ForecourtDevice = {
      id: `hw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      category: form.category,
      brandModel: form.brandModel,
      protocol: form.protocol || suggestion?.protocol || "Unknown",
      connection: form.connection.trim(),
      mappedTo: form.mappedTo.trim(),
      status: form.connection.trim() ? "configured" : "not-configured",
      lastEvent: new Date().toISOString(),
    };
    setDevices((prev) => [device, ...prev]);
    setForm({
      category: form.category,
      brandModel: "",
      protocol: "",
      connection: "",
      mappedTo: "",
    });
    toastSuccess(`${device.brandModel} registered.`);
  };

  const handleDelete = (id: string) => {
    setDevices((prev) => prev.filter((d) => d.id !== id));
    toastSuccess("Device removed.");
  };

  const exportCsv = () => {
    downloadCsv(
      `forecourt-hardware-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        [
          "Category",
          "Brand / Model",
          "Protocol",
          "Connection",
          "Mapped To",
          "Status",
        ],
        ...devices.map((d) => [
          CATEGORY_META[d.category].label,
          d.brandModel,
          d.protocol,
          d.connection,
          d.mappedTo,
          d.status,
        ]),
      ],
    );
  };

  const counts = useMemo(() => {
    const m = new Map<HardwareCategory, number>();
    for (const d of devices) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  }, [devices]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
          Forecourt Hardware
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search devices"
              className="pl-8 pr-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button
            onClick={exportCsv}
            disabled={devices.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
        </div>
      </div>

      {/* Category counts */}
      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(CATEGORY_META) as HardwareCategory[]).map((cat) => {
          const Icon = CATEGORY_META[cat].icon;
          return (
            <button
              key={cat}
              onClick={() =>
                setCategoryFilter((f) => (f === cat ? "all" : cat))
              }
              className={`rounded-xl border p-3 text-left transition-all ${
                categoryFilter === cat
                  ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-amber-400"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Icon className="w-4 h-4 text-amber-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {CATEGORY_META[cat].label}
                </span>
              </div>
              <div className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                {counts.get(cat) ?? 0}
              </div>
            </button>
          );
        })}
      </div>

      {/* Register form */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          Register Device
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <select
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                category: e.target.value as HardwareCategory,
                brandModel: "",
              }))
            }
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            aria-label="Category"
          >
            {(Object.keys(CATEGORY_META) as HardwareCategory[]).map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_META[cat].label}
              </option>
            ))}
          </select>
          <select
            value={form.brandModel}
            onChange={(e) =>
              setForm((f) => ({ ...f, brandModel: e.target.value }))
            }
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            aria-label="Brand / model"
          >
            <option value="">Brand / model *</option>
            {HARDWARE_CATALOG.filter((h) => h.category === form.category).map(
              (h) => (
                <option key={h.brandModel} value={h.brandModel}>
                  {h.brandModel}
                </option>
              ),
            )}
          </select>
          <input
            value={form.protocol}
            onChange={(e) =>
              setForm((f) => ({ ...f, protocol: e.target.value }))
            }
            placeholder={suggestion?.protocol ?? "Protocol (optional)"}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <input
            value={form.connection}
            onChange={(e) =>
              setForm((f) => ({ ...f, connection: e.target.value }))
            }
            placeholder="Connection (COM3 / 192.168…)"
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <input
            value={form.mappedTo}
            onChange={(e) =>
              setForm((f) => ({ ...f, mappedTo: e.target.value }))
            }
            placeholder="Mapped to (Pump 1 / Tank A)"
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>
        <button
          onClick={handleAdd}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-gray-900 text-sm font-semibold hover:bg-amber-400"
        >
          <Plus className="w-4 h-4" /> Register Device
        </button>
      </div>

      {/* Devices table */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {filtered.length === 0 ? (
          <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
            No forecourt hardware registered yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-2">Category</th>
                  <th className="px-4 py-2">Brand / Model</th>
                  <th className="px-4 py-2">Protocol</th>
                  <th className="px-4 py-2">Connection</th>
                  <th className="px-4 py-2">Mapped To</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const Icon = CATEGORY_META[d.category].icon;
                  return (
                    <tr
                      key={d.id}
                      className="border-b border-gray-100 dark:border-gray-700/50"
                    >
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
                          <Icon className="w-3.5 h-3.5 text-amber-500" />
                          {CATEGORY_META[d.category].label}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">
                        {d.brandModel}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {d.protocol}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-300">
                        {d.connection || "—"}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {d.mappedTo || "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            d.status === "configured"
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          }`}
                        >
                          {d.status === "configured"
                            ? "Configured"
                            : "Not Configured"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => handleDelete(d.id)}
                          className="text-gray-400 hover:text-red-500"
                          aria-label="Delete device"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Honest inventory only — registering a device here records what is
        physically wired at the forecourt. Live dispenser/ATG data requires the
        corresponding controller integration via the Payment Setup tab.
      </p>
    </div>
  );
}
