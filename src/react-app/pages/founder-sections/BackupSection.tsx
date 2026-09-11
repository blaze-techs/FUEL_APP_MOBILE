import { useState } from "react";
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  HardDrive,
  Calendar,
  Globe,
  Archive,
  Trash2,
  Filter,
} from "lucide-react";

// ============================================
// REGIONAL CONFIGURATION
// ============================================

export const REGIONAL_STORAGE = {
  KE: { name: "Kenya", flag: "🇰🇪" },
  UG: { name: "Uganda", flag: "🇺🇬" },
  TZ: { name: "Tanzania", flag: "🇹🇿" },
  NG: { name: "Nigeria", flag: "🇳🇬" },
  ZA: { name: "South Africa", flag: "🇿🇦" },
  GH: { name: "Ghana", flag: "🇬🇭" },
} as const;

type RegionCode = keyof typeof REGIONAL_STORAGE;

interface BackupMetadata {
  region: RegionCode | "ALL";
  timestamp: string;
  size: number;
  keyCount: number;
}

interface BackupSectionProps {
  logAudit: (
    event: string,
    detail: string,
    severity: "success" | "warning" | "danger" | "info",
  ) => void;
}

export default function BackupSection({ logAudit }: BackupSectionProps) {
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<RegionCode | "ALL">(
    "ALL",
  );
  const [lastBackup, setLastBackup] = useState<string | null>(() =>
    localStorage.getItem("fuelpro_last_backup"),
  );
  const [backupSize, setBackupSize] = useState("0 KB");
  const [includeFiles, setIncludeFiles] = useState(true);
  const [regionalBackups, setRegionalBackups] = useState<BackupMetadata[]>(
    () => {
      try {
        const stored = localStorage.getItem("fuelpro_regional_backups");
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    },
  );

  // Get keys for a specific region
  const getRegionalKeys = (region: RegionCode) => {
    const prefix = `fuelpro_${region.toLowerCase()}_`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith(prefix) || key.includes(`_${region.toLowerCase()}_`))
      ) {
        keys.push(key);
      }
    }
    return keys;
  };

  // Get storage size for a region
  const getRegionalStorageSize = (region: RegionCode) => {
    const keys = getRegionalKeys(region);
    let totalSize = 0;
    keys.forEach((key) => {
      const value = localStorage.getItem(key) || "";
      totalSize += key.length + value.length;
    });
    return totalSize;
  };

  // Total storage
  const getTotalStorageSize = () => {
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key) || "";
        totalSize += key.length + value.length;
      }
    }
    return totalSize;
  };

  const clearRegionData = (region: RegionCode) => {
    const regionName = REGIONAL_STORAGE[region].name;
    if (!confirm(`Clear all data for ${regionName}? This cannot be undone.`)) {
      return;
    }

    const prefix = `fuelpro_${region.toLowerCase()}_`;
    let clearedCount = 0;

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith(prefix) || key.includes(`_${region.toLowerCase()}_`))
      ) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    }

    logAudit(
      "Region Data Cleared",
      `Cleared ${clearedCount} keys for ${regionName}`,
      "warning",
    );
  };

  const handleBackup = () => {
    setBackingUp(true);
    logAudit("Backup Started", "Manual backup initiated", "info");
    setTimeout(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) data[key] = localStorage.getItem(key) || "";
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      setBackupSize(`${(blob.size / 1024).toFixed(1)} KB`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fuelpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      const now = new Date().toISOString();
      localStorage.setItem("fuelpro_last_backup", now);
      setLastBackup(now);
      setBackingUp(false);
      logAudit(
        "Backup Completed",
        `Backup exported: ${(blob.size / 1024).toFixed(1)} KB`,
        "success",
      );
    }, 1200);
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    logAudit("Restore Started", `Restoring from ${file.name}`, "info");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        if (
          !confirm(
            `Restore ${Object.keys(data).length} keys? This will overwrite current data.`,
          )
        ) {
          setRestoring(false);
          return;
        }
        Object.entries(data).forEach(([key, value]) => {
          localStorage.setItem(key, value as string);
        });
        logAudit(
          "Restore Completed",
          `Restored ${Object.keys(data).length} keys`,
          "success",
        );
        import("@/react-app/lib/app-reloader").then(({ triggerSoftReload }) =>
          triggerSoftReload(500),
        );
      } catch {
        logAudit("Restore Failed", "Invalid backup file", "danger");
      }
      setRestoring(false);
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Header with Region Filter */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Database size={18} className="text-blue-400" /> Backup & Restore
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Export and import all FuelPro data by region
          </p>
        </div>

        {/* Region Filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-500" />
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setSelectedRegion("ALL")}
              className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                selectedRegion === "ALL"
                  ? "bg-blue-500/30 border-blue-500/50 text-blue-300"
                  : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
              }`}
            >
              ALL
            </button>
            {Object.entries(REGIONAL_STORAGE).map(([code, config]) => (
              <button
                key={code}
                onClick={() => setSelectedRegion(code as RegionCode)}
                className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                  selectedRegion === code
                    ? "bg-blue-500/30 border-blue-500/50 text-blue-300"
                    : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10"
                }`}
              >
                {config.flag} {code}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Regional Storage Buckets */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <Archive size={14} className="text-purple-400" /> Regional Storage
          Buckets
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(REGIONAL_STORAGE).map(([code, config]) => {
            const size = getRegionalStorageSize(code as RegionCode);
            const keys = getRegionalKeys(code as RegionCode);
            const hasData = keys.length > 0;

            return (
              <div
                key={code}
                className={`p-3 rounded-lg border ${
                  hasData
                    ? "bg-white/[0.05] border-white/10"
                    : "bg-white/[0.02] border-white/5"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{config.flag}</span>
                  <span className="text-xs font-medium text-white">
                    {config.name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">
                    {keys.length} keys
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {(size / 1024).toFixed(1)} KB
                  </span>
                </div>
                {hasData && (
                  <button
                    onClick={() => clearRegionData(code as RegionCode)}
                    className="mt-2 text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1"
                  >
                    <Trash2 size={10} /> Clear
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-xs border-t border-white/10 pt-3 mt-3">
          <span className="text-gray-400">Total Storage Used</span>
          <span className="text-white font-medium">
            {(getTotalStorageSize() / 1024 / 1024).toFixed(2)} MB
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Backup Card */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center mb-3">
            <Download size={18} className="text-blue-400" />
          </div>
          <h3 className="text-sm font-medium text-white mb-1">
            Export Backup
            {selectedRegion !== "ALL" && (
              <span className="ml-2 text-[10px] text-blue-400">
                ({REGIONAL_STORAGE[selectedRegion].flag}{" "}
                {REGIONAL_STORAGE[selectedRegion].name})
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            Download{" "}
            {selectedRegion === "ALL"
              ? "all"
              : REGIONAL_STORAGE[selectedRegion].name}{" "}
            localStorage data as JSON
          </p>
          {lastBackup && (
            <div className="flex items-center gap-2 mb-3 text-[10px] text-gray-500">
              <Clock size={10} /> Last: {new Date(lastBackup).toLocaleString()}{" "}
              ({backupSize})
            </div>
          )}
          <button
            onClick={handleBackup}
            disabled={backingUp}
            className="w-full py-2.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-xs rounded-lg border border-blue-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 fp-icon-only"
            title="Refresh"
            aria-label="Refresh"
          >
            {backingUp ? (
              <>
                <RefreshCw size={13} className="animate-spin" /> Creating...
              </>
            ) : (
              <>
                <Download size={13} /> Create Backup
              </>
            )}
          </button>
        </div>

        {/* Restore Card */}
        <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
          <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center mb-3">
            <Upload size={18} className="text-amber-400" />
          </div>
          <h3 className="text-sm font-medium text-white mb-1">Import Backup</h3>
          <p className="text-xs text-gray-500 mb-4">
            Restore from a previous backup file
          </p>
          <div className="mb-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeFiles}
              onChange={() => setIncludeFiles(!includeFiles)}
              className="rounded accent-amber-500"
            />
            <span className="text-[10px] text-gray-500">
              Include uploaded files
            </span>
          </div>
          <label className="w-full py-2.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs rounded-lg border border-amber-500/20 transition-colors flex items-center justify-center gap-2 cursor-pointer">
            <Upload size={13} />{" "}
            {restoring ? "Restoring..." : "Select Backup File"}
            <input
              type="file"
              accept=".json"
              onChange={handleRestore}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Storage Stats */}
      <div className="bg-[#161618] border border-white/[0.06] rounded-xl p-5">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <HardDrive size={14} className="text-purple-400" /> Storage Breakdown
        </h3>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {Array.from({ length: localStorage.length }, (_, i) =>
            localStorage.key(i),
          )
            .filter(Boolean)
            .sort()
            .map((key) => {
              const val = localStorage.getItem(key!) || "";
              return (
                <div
                  key={key}
                  className="flex items-center justify-between text-xs py-1"
                >
                  <span className="text-gray-400 font-mono truncate max-w-[60%]">
                    {key}
                  </span>
                  <span className="text-gray-600">
                    {(val.length / 1024).toFixed(2)} KB
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
