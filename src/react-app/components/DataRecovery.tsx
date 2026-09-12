import { useState } from "react";
import {
  Download,
  Upload,
  AlertCircle,
  CheckCircle,
  Cloud,
  Loader2,
} from "lucide-react";
import EnhancedCard from "./EnhancedCard";
import EnhancedButton from "./EnhancedButton";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

interface DataRecoveryProps {
  onRestore?: (data: any) => void;
}

/**
 * Splits a logical key returned by `cloudStorageService.getAll()` back into
 * `{ key, stationId }`. getAll() strips the owner suffix, leaving either the
 * bare key (`credit_accounts`) or the station-scoped form
 * (`credit_accounts__<stationId>`). Reconstructing the station scope lets an
 * import re-create the EXACT same app_kv rows (RLS + realtime unaffected).
 */
function splitLogicalKey(logicalKey: string): {
  key: string;
  stationId?: string;
} {
  const idx = logicalKey.lastIndexOf("__");
  if (idx > 0) {
    const stationId = logicalKey.slice(idx + 2);
    if (stationId && !stationId.includes("__")) {
      return { key: logicalKey.slice(0, idx), stationId };
    }
  }
  return { key: logicalKey, stationId: undefined };
}

export default function DataRecovery({ onRestore }: DataRecoveryProps) {
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  const exportAll = async (filename: string, label: string) => {
    setExporting(true);
    try {
      // The source of truth is the cloud app_kv store (all per-component keys
      // + the FuelContext compact blob). Exporting it makes the local backup
      // identical to the cloud one — no dead legacy localStorage keys.
      const allData = await cloudStorageService.getAll();
      const data = {
        timestamp: new Date().toISOString(),
        source: "cloud",
        cloudData: allData,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      setStatus("success");
      setMessage(`${label} (${Object.keys(allData).length} records)`);
      setTimeout(() => setStatus("idle"), 3000);
    } catch {
      setStatus("error");
      setMessage("Failed to export backup");
      setTimeout(() => setStatus("idle"), 3000);
    } finally {
      setExporting(false);
    }
  };

  const handleExport = () =>
    exportAll(
      `fuelpro-backup-${new Date().toISOString().split("T")[0]}.json`,
      "Backup exported",
    );

  const handleCloudExport = () =>
    exportAll(
      `fuelpro-cloud-backup-${new Date().toISOString().split("T")[0]}.json`,
      "Cloud backup exported",
    );

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      setImporting(true);
      try {
        const data = JSON.parse(e.target?.result as string);

        // Accept both the current cloud backup shape ({ cloudData: {... }})
        // and the legacy flat shape (keys at the top level).
        const records: Record<string, unknown> =
          data && typeof data.cloudData === "object" && data.cloudData
            ? data.cloudData
            : data;

        let restored = 0;
        for (const [logicalKey, value] of Object.entries(records)) {
          if (
            !value ||
            typeof value !== "object" ||
            logicalKey === "timestamp" ||
            logicalKey === "source"
          ) {
            continue;
          }
          const { key, stationId } = splitLogicalKey(logicalKey);
          await cloudStorageService.set(key, value, stationId);
          restored++;
        }

        if (onRestore) onRestore(data);

        setStatus("success");
        setMessage(`Backup restored (${restored} records). Reloading...`);
        import("@/react-app/lib/app-reloader").then(({ triggerSoftReload }) =>
          triggerSoftReload(1500),
        );
      } catch {
        setStatus("error");
        setMessage("Invalid backup file format");
        setTimeout(() => setStatus("idle"), 3000);
      } finally {
        setImporting(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <EnhancedCard title="Data Backup & Recovery" icon={<Download size={20} />}>
      <div className="space-y-4">
        <p className="text-gray-600 dark:text-gray-400">
          Export your data for backup or import a previous backup to restore
          your data.
        </p>

        {status !== "idle" && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg ${
              status === "success"
                ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400"
            }`}
          >
            {status === "success" ? (
              <CheckCircle size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
            <span>{message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EnhancedButton
            onClick={handleExport}
            icon={
              exporting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Download size={20} />
              )
            }
            variant="primary"
            fullWidth
            disabled={exporting}
          >
            {exporting ? "Exporting..." : "Export Backup"}
          </EnhancedButton>

          <label className="w-full">
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
            <EnhancedButton
              icon={
                importing ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Upload size={20} />
                )
              }
              variant="secondary"
              fullWidth
              disabled={importing}
            >
              {importing ? "Importing..." : "Import Backup"}
            </EnhancedButton>
          </label>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <Cloud size={20} className="text-indigo-500" />
            <h4 className="font-semibold text-gray-900 dark:text-white">
              Cloud Backup (Cross-Device)
            </h4>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Export ALL your cloud-synced data (POS transactions, credit
            accounts, expenses, suppliers, payroll, inventory, loyalty
            customers, etc.) into a single portable JSON file.
          </p>
          <EnhancedButton
            onClick={handleCloudExport}
            icon={
              exporting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Cloud size={20} />
              )
            }
            variant="primary"
            fullWidth
            disabled={exporting}
          >
            {exporting ? "Exporting..." : "Export All Cloud Data"}
          </EnhancedButton>
        </div>
      </div>
    </EnhancedCard>
  );
}
