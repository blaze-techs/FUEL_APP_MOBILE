/* HardwareFirmwareTracker — device firmware + calibration certificates.
 * Reverse-engineered from gilbarco/dover/meps/doms/oropak/veeder/invenco/
 * scheidt-bachmann/hectronic — every forecourt device has firmware +
 * calibration certificates (legal metrology). Reads the same `forecourt_devices`
 * cloud list as ForecourtHardware and attaches firmware/cert rows.
 */
import { useMemo, useState } from "react";
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Download,
  Trash2,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { downloadCsv } from "@/react-app/lib/forecourt-features";
import { toastError, toastSuccess } from "@/react-app/lib/toast";

interface FirmwareRecord {
  id: string;
  deviceName: string;
  firmwareVersion: string;
  certificateNo: string;
  validUntil: string;
}

const KEY = "forecourt_firmware";

export default function HardwareFirmwareTracker() {
  const { currentStation } = useStations();
  const { data: records, setData: setRecords } = useCloudKV<FirmwareRecord[]>(
    KEY,
    currentStation?.id,
    [],
  );
  const [open, setOpen] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    deviceName: "",
    firmwareVersion: "",
    certificateNo: "",
    validUntil: "",
  });

  const expired = useMemo(
    () =>
      records.filter(
        (r) => r.validUntil && new Date(r.validUntil) < new Date(),
      ),
    [records],
  );

  const handleSave = () => {
    if (!form.deviceName.trim() || !form.firmwareVersion.trim()) {
      toastError("Device name + firmware version required.");
      return;
    }
    const r: FirmwareRecord = {
      id: `fw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      deviceName: form.deviceName.trim(),
      firmwareVersion: form.firmwareVersion.trim(),
      certificateNo: form.certificateNo.trim(),
      validUntil: form.validUntil,
    };
    setRecords((p) => [r, ...p]);
    setShowForm(false);
    setForm({
      deviceName: "",
      firmwareVersion: "",
      certificateNo: "",
      validUntil: "",
    });
    toastSuccess("Firmware/cert record saved.");
  };

  const handleDelete = (id: string) => {
    setRecords((p) => p.filter((r) => r.id !== id));
    toastSuccess("Record removed.");
  };

  const exportCsv = () =>
    downloadCsv("firmware-certificates.csv", [
      ["Device", "Firmware", "Certificate #", "Valid until"],
      ...records.map((r) => [
        r.deviceName,
        r.firmwareVersion,
        r.certificateNo,
        r.validUntil,
      ]),
    ]);

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BadgeCheck className="w-5 h-5 text-blue-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              Firmware + Calibration Certificates
            </h4>
            <p className="text-xs text-gray-500">
              Firmware versions & legal-metrology certificates for registered
              forecourt devices (gilbarco/dover/meps/doms/etc. vector).
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="p-1 rounded hover:bg-gray-100"
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
          {expired.length > 0 && (
            <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-900/20 p-2 text-xs text-rose-700 dark:text-rose-300">
              {expired.length} certificate(s) expired — renew to pass metrology
              inspection.
            </div>
          )}
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={() => setShowForm((v) => !v)}
            >
              + Add firmware record
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
                  placeholder="Device name *"
                  value={form.deviceName}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, deviceName: e.target.value }))
                  }
                />
                <input
                  className="input"
                  placeholder="Firmware version *"
                  value={form.firmwareVersion}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, firmwareVersion: e.target.value }))
                  }
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  className="input"
                  placeholder="Certificate no."
                  value={form.certificateNo}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, certificateNo: e.target.value }))
                  }
                />
                <input
                  className="input"
                  type="date"
                  value={form.validUntil}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, validUntil: e.target.value }))
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
          {records.length > 0 ? (
            <ul className="space-y-1.5">
              {records.map((r) => {
                const overdue =
                  r.validUntil && new Date(r.validUntil) < new Date();
                return (
                  <li
                    key={r.id}
                    className="rounded border p-2 text-sm flex flex-wrap items-center gap-2"
                  >
                    <span className="font-medium">{r.deviceName}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                      fw {r.firmwareVersion}
                    </span>
                    {r.certificateNo && (
                      <span className="text-xs text-gray-500">
                        cert #{r.certificateNo}
                      </span>
                    )}
                    <span
                      className={`text-xs ${
                        overdue ? "text-rose-600" : "text-gray-500"
                      }`}
                    >
                      {r.validUntil || "no expiry"}
                      {overdue ? " (expired)" : ""}
                    </span>
                    <button
                      className="ml-auto text-rose-500"
                      onClick={() => handleDelete(r.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded border border-dashed p-3 text-center text-xs text-gray-500">
              No firmware/certificate records yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
