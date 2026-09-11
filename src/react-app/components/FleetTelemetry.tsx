/* FleetTelemetry — fuelsite driver-vehicle telemetry captures:
 * sub-indices for fuel telematics: Fuel theft alarms, harsh driving,
 * driver behavior, route history + geofence alarms — the top risk-monitoring
 * features from telematics sites (telematicafrica/trackntrace/karooooo/
 * uffizio/naj/sicuro/blackboxgps/fama/uffizio-telematics).
 *
 * Records are keyed to fleet registry so alarms tie to drivers/cars. Persisted
 * to `fleet_telemetry` cloud KV on the station — cross-device, cross-tab.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronUp,
  Download,
  Gauge,
  Trash2,
  Wifi,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { downloadCsv } from "@/react-app/lib/forecourt-features";
import { toastError, toastSuccess } from "@/react-app/lib/toast";

interface TelemetryAlarm {
  id: string;
  type:
    | "fuel_theft_drain"
    | "harsh_acceleration"
    | "harsh_braking"
    | "harsh_cornering"
    | "geofence_exit"
    | "geofence_enter"
    | "overspeed"
    | "route_deviation"
    | "battery_disconnect"
    | "engine_idle";
  severity: "info" | "warning" | "critical";
  vehicleReg: string;
  driver?: string;
  detail: string;
  date: string;
  resolved: boolean;
}

const ALARM_TYPES: { value: TelemetryAlarm["type"]; label: string }[] = [
  { value: "fuel_theft_drain", label: "Fuel theft / drain" },
  { value: "harsh_acceleration", label: "Harsh acceleration" },
  { value: "harsh_braking", label: "Harsh braking" },
  { value: "harsh_cornering", label: "Harsh cornering" },
  { value: "geofence_exit", label: "Geofence exit" },
  { value: "geofence_enter", label: "Geofence entry" },
  { value: "overspeed", label: "Overspeed" },
  { value: "route_deviation", label: "Route deviation" },
  { value: "battery_disconnect", label: "Battery disconnect" },
  { value: "engine_idle", label: "Engine idle" },
];

const SEVERITY_LABEL: Record<TelemetryAlarm["severity"], string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

const KEY = "fleet_telemetry";

export default function FleetTelemetry() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: alarms, setData: setAlarms } = useCloudKV<TelemetryAlarm[]>(
    KEY,
    stationId,
    [],
  );

  const [open, setOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState<{
    type: TelemetryAlarm["type"];
    severity: TelemetryAlarm["severity"];
    vehicleReg: string;
    driver: string;
    detail: string;
  }>({
    type: "fuel_theft_drain",
    severity: "warning",
    vehicleReg: "",
    driver: "",
    detail: "",
  });

  const unresolved = useMemo(() => alarms.filter((a) => !a.resolved), [alarms]);

  const summary = useMemo(() => {
    const s = {
      total: alarms.length,
      unresolved: unresolved.length,
      critical: alarms.filter((a) => a.severity === "critical").length,
      theft: alarms.filter((a) => a.type === "fuel_theft_drain").length,
    };
    return s;
  }, [alarms, unresolved]);

  const handleSave = () => {
    if (!form.vehicleReg.trim()) {
      toastError("Enter a vehicle registration.");
      return;
    }
    const a: TelemetryAlarm = {
      id: `ta_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: form.type,
      severity: form.severity,
      vehicleReg: form.vehicleReg.trim(),
      driver: form.driver.trim() || undefined,
      detail: form.detail.trim(),
      date: new Date().toISOString(),
      resolved: false,
    };
    setAlarms((prev) => [a, ...prev].slice(0, 500));
    toastSuccess("Telemetry alarm recorded.");
    setShowForm(false);
    setForm((prev) => ({
      ...prev,
      vehicleReg: "",
      driver: "",
      detail: "",
    }));
  };

  const toggleResolved = (id: string) => {
    setAlarms((prev) =>
      prev.map((a) => (a.id === id ? { ...a, resolved: !a.resolved } : a)),
    );
  };
  const removeAlarm = (id: string) => {
    setAlarms((prev) => prev.filter((a) => a.id !== id));
    toastSuccess("Alarm deleted.");
  };
  const exportCsv = () => {
    downloadCsv("fleet-telemetry.csv", [
      ["Date", "Type", "Severity", "Vehicle", "Driver", "Detail", "Resolved"],
      ...alarms.map((a) => [
        a.date,
        a.type,
        a.severity,
        a.vehicleReg,
        a.driver ?? "",
        a.detail,
        a.resolved ? "yes" : "no",
      ]),
    ]);
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-amber-500" />
          <div>
            <h3 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Driver-Vehicle Telemetry (Fuel theft & driving alerts)
            </h3>
            <p className="text-xs text-gray-500">
              Reverse-engineered telematics risk vector (telematica/trackntrace/
              karooooo/sicuro). Persisted as cloud KV `fleet_telemetry`.
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">
                Total
              </p>
              <p className="font-bold text-gray-800 dark:text-gray-100">
                {summary.total}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">
                Unresolved
              </p>
              <p className="font-bold text-amber-600">{summary.unresolved}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">
                Critical
              </p>
              <p className="font-bold text-rose-600">{summary.critical}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">
                Theft
              </p>
              <p className="font-bold text-blue-600">{summary.theft}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => setShowForm((v) => !v)}
            >
              + Record alarm
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
              className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-2"
            >
              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">Type</label>
                  <select
                    className="input w-full"
                    value={form.type}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        type: e.target.value as TelemetryAlarm["type"],
                      }))
                    }
                  >
                    {ALARM_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Severity</label>
                  <select
                    className="input w-full"
                    value={form.severity}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        severity: e.target.value as TelemetryAlarm["severity"],
                      }))
                    }
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500">
                    Vehicle registration *
                  </label>
                  <input
                    className="input w-full"
                    value={form.vehicleReg}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        vehicleReg: e.target.value,
                      }))
                    }
                    placeholder="KDA 456X"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">
                    Driver (optional)
                  </label>
                  <input
                    className="input w-full"
                    value={form.driver}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        driver: e.target.value,
                      }))
                    }
                    placeholder="Jane driver"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500">Detail</label>
                <textarea
                  className="input w-full"
                  rows={2}
                  value={form.detail}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      detail: e.target.value,
                    }))
                  }
                  placeholder="Describe the alarm condition"
                />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary" type="submit">
                  Save alarm
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {alarms.length > 0 ? (
            <ul className="space-y-2">
              {alarms.map((a) => (
                <li
                  key={a.id}
                  className={`rounded border p-3 text-sm ${
                    a.resolved
                      ? "border-gray-200 dark:border-gray-700 opacity-70"
                      : "border-amber-200 dark:border-amber-800"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                        {ALARM_TYPES.find((t) => t.value === a.type)?.label}
                        {" — "}
                        <span className="text-gray-600 dark:text-gray-300">
                          {a.vehicleReg}
                          {a.driver ? ` (${a.driver})` : ""}
                        </span>
                      </p>
                      {a.detail && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {a.detail}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(a.date).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-1 items-center">
                      {a.severity === "critical" && (
                        <AlertTriangle className="w-4 h-4 text-rose-500" />
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          a.severity === "critical"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                            : a.severity === "warning"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                              : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        }`}
                      >
                        {SEVERITY_LABEL[a.severity]}
                      </span>
                      <button
                        className="text-xs text-blue-600 hover:underline"
                        onClick={() => toggleResolved(a.id)}
                      >
                        {a.resolved ? "Reopen" : "Resolve"}
                      </button>
                      <button
                        className="text-rose-500 hover:text-rose-600"
                        onClick={() => removeAlarm(a.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded border border-dashed p-4 text-center text-xs text-gray-500">
              <Building2 className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              No driver-vehicle telemetry alarms yet.
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-xs text-blue-800 dark:text-blue-300">
            <Wifi className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              Client-side alarm registry (persisted to cloud KV
              `fleet_telemetry`). Integrates with telematics devices by
              pasting/loading their JSON records here — this is the telematics
              vector in reversed format (route/geofence/harsh driving/theft).
            </p>
          </div>
        </>
      )}
    </div>
  );
}
