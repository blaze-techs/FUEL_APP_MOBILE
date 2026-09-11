/* TamperAlarmLog — reverse-engineered Crone-Tech Smart Fuel "alarm triggered
 * when sensor is tampered with": a tamper/security log per forecourt device
 * (dispenser, ATG probe, cover switch) with severity and resolution. Distinct
 * from theft-anomaly (volume math): tamper events come from the FORECOURT
 * DEVICE itself. Cloud KV `tamper_alarms` (station-scoped).
 */
import { AlarmClock, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "tamper_alarms";

interface TamperAlarm {
  id: string;
  device: string;
  sensorType: string;
  severity: "critical" | "warning" | "info";
  date: string;
  resolved: boolean;
  note: string;
}

function id() {
  return `ta_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const SENSOR_TYPES = [
  "Dispenser cover switch",
  "ATG probe tamper",
  "Telemetry unit disconnect",
  "Calibration seal break",
];

export default function TamperAlarmLog() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: alarms, setData: setAlarms } = useCloudKV<TamperAlarm[]>(
    KEY,
    stationId,
    [],
  );

  const [form, setForm] = useState({
    device: "",
    sensorType: SENSOR_TYPES[0],
    severity: "critical" as TamperAlarm["severity"],
    note: "",
  });

  const unresolved = useMemo(
    () => (alarms || []).filter((a) => !a.resolved),
    [alarms],
  );

  const addAlarm = () => {
    if (!form.device.trim()) return toastError("Device/pump is required.");
    setAlarms([
      {
        id: id(),
        device: form.device.trim(),
        sensorType: form.sensorType,
        severity: form.severity,
        date: new Date().toISOString().split("T")[0],
        resolved: false,
        note: form.note.trim(),
      },
      ...(alarms || []),
    ]);
    setForm((f) => ({ ...f, device: "", note: "" }));
    toastSuccess("Tamper alarm logged.");
  };

  const toggleResolved = (alarm: TamperAlarm) => {
    setAlarms(
      (alarms || []).map((a) =>
        a.id === alarm.id ? { ...a, resolved: !a.resolved } : a,
      ),
    );
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-red-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Tamper Alarm Log
            {unresolved.length > 0 && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                {unresolved.length} open
              </span>
            )}
          </h4>
          <p className="text-xs text-gray-500">
            Sensor tamper/security events at forecourt devices (Crone trigger
            alarms).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Device</p>
          <input
            value={form.device}
            onChange={(e) => setForm((f) => ({ ...f, device: e.target.value }))}
            placeholder="Pump 2 / Tank ATG"
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0 col-span-2 sm:col-span-1">
          <p className="text-xs text-gray-500">Sensor</p>
          <select
            value={form.sensorType}
            onChange={(e) =>
              setForm((f) => ({ ...f, sensorType: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            {SENSOR_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Severity</p>
          <select
            value={form.severity}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                severity: e.target.value as TamperAlarm["severity"],
              }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Note</p>
          <input
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addAlarm} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> Log
        </button>
      </div>

      <div className="max-h-56 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {(alarms || []).length === 0 ? (
          <p className="p-3 text-xs text-gray-500">No tamper alarms logged.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Device</th>
                <th className="text-left px-2 py-1.5">Sensor</th>
                <th className="text-left px-2 py-1.5">Severity</th>
                <th className="text-left px-2 py-1.5">Note</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {(alarms || []).map((a) => (
                <tr
                  key={a.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5">{a.date}</td>
                  <td className="px-2 py-1.5 font-medium">{a.device}</td>
                  <td className="px-2 py-1.5">{a.sensorType}</td>
                  <td className="px-2 py-1.5 capitalize">{a.severity}</td>
                  <td className="px-2 py-1.5 max-w-[160px] truncate">
                    {a.note || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={() => toggleResolved(a)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        a.resolved
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {a.resolved ? "Resolved" : "Open"}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() =>
                        setAlarms((alarms || []).filter((x) => x.id !== a.id))
                      }
                      className="text-red-500"
                      aria-label="Delete alarm"
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

      {unresolved.length > 0 && (
        <p className="text-xs flex items-center gap-1 text-amber-600">
          <AlarmClock className="w-3 h-3" /> {unresolved.length} unresolved
          tamper alarm(s) — check the devices before next shift.
        </p>
      )}
    </div>
  );
}
