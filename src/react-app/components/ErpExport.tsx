/* ErpExport — reverse-engineered Crone-Tech Smart Fuel "Integrate data to
 * ERP systems": a single panel that bundles every station data module
 * (POS transactions, expenses, credit accounts, invoices, products,
 * fleet cards, tank readings…) into one ERP-ready JSON export, or a
 * per-module CSV export. Solves the "Excel merging" problem Crone
 * advertises away. Reads all cloud keys via cloudStorageService.getAll.
 */
import { Download, FileJson } from "lucide-react";
import { useState } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { useStations } from "@/react-app/context/StationContext";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const MODULES = [
  "pos_transactions",
  "expenses_data",
  "credit_accounts",
  "credit_transactions",
  "fleet_cards",
  "tank_readings",
  "daybook_entries",
  "suppliers_data",
  "comm_contacts",
  "payroll_employees",
  "maintenance_records",
  "loyalty_customers",
];

export default function ErpExport() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const [busy, setBusy] = useState(false);

  const exportJson = async () => {
    setBusy(true);
    try {
      const all = await cloudStorageService.getAll(stationId);
      const payload = {
        station: currentStation?.name,
        stationId,
        exportedAt: new Date().toISOString(),
        data: all,
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `erp-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toastSuccess("ERP JSON export downloaded.");
    } catch {
      toastError("ERP export failed — check cloud connection.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsvModule = async (key: string) => {
    try {
      const data = await cloudStorageService.get<unknown>(key, stationId);
      if (data == null) {
        return toastError(`Module "${key}" is empty.`);
      }
      const rows = Array.isArray(data) ? data : [data];
      const headers = Array.from(
        new Set(
          (rows as Record<string, unknown>[]).flatMap((r) => Object.keys(r)),
        ),
      );
      const csv = [
        headers.join(","),
        ...(rows as Record<string, unknown>[]).map((r) =>
          headers
            .map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`)
            .join(","),
        ),
      ].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${key}-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toastSuccess(`"${key}" exported.`);
    } catch {
      toastError("Module export failed.");
    }
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <FileJson className="w-5 h-5 text-indigo-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            ERP Data Export
          </h4>
          <p className="text-xs text-gray-500">
            Crone ERP integration — one bundle of every module, or per-module
            CSV for your accounting/ERP system.
          </p>
        </div>
      </div>

      <button
        onClick={exportJson}
        disabled={busy}
        className="btn btn-primary !p-2 !text-xs fp-icon-only"
        title="Download"
        aria-label="Download"
      >
        <Download className="w-3 h-3" />{" "}
        {busy ? "Exporting…" : "Export All Modules (JSON)"}
      </button>

      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Per-module CSV:
        </p>
        <div className="flex flex-wrap gap-2">
          {MODULES.map((key) => (
            <button
              key={key}
              onClick={() => exportCsvModule(key)}
              className="btn btn-secondary !p-1.5 !text-xs"
            >
              <Download className="w-3 h-3" /> {key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
