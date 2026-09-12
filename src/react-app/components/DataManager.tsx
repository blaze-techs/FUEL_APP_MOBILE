import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Database,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  Save,
  Settings,
  HardDrive,
  Cloud,
  CheckCircle,
  Fuel,
  Wifi,
  Gauge,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { usePermissions } from "@/react-app/context/PermissionContext";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { getFuelLabel } from "@/react-app/config/pricing";
import { toastSuccess, toastError, toastInfo } from "@/react-app/lib/toast";
import DataRecovery from "@/react-app/components/DataRecovery";

import SyncDashboard from "@/react-app/components/SyncDashboard";
import StorageEgressPanel from "@/react-app/components/StorageEgressPanel";
import ErpExport from "@/react-app/components/ErpExport";
import CloudDiagnosticsPanel from "@/react-app/components/CloudDiagnosticsPanel";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export default function DataManager() {
  const {
    state,
    dispatch,
    saveToCloud,
    loadFromCloud,
    isCloudSaving,
    lastCloudSave,
  } = useFuel();
  const { hasPermission, isOwner } = usePermissions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [cloudUser, setCloudUser] = useState<string | null>(null);
  const [cloudRealtime, setCloudRealtime] = useState(false);
  const [cloudKeys, setCloudKeys] = useState(0);

  const refreshCloudStatus = useCallback(async () => {
    setCloudUser(cloudStorageService.currentUserIdSync());
    setCloudRealtime(cloudStorageService.isRealtimeEnabled());
    try {
      const all = await cloudStorageService.getAll();
      setCloudKeys(Object.keys(all).length);
    } catch {
      setCloudKeys(0);
    }
  }, []);

  useEffect(() => {
    refreshCloudStatus();
  }, [refreshCloudStatus]);

  const getDataSize = () => {
    const dataStr = JSON.stringify(state);
    return (dataStr.length / 1024).toFixed(1);
  };

  const getDataSummary = () => {
    // Count pumps across ALL fuel types (not just PMS/AGO) so the summary
    // reflects the station's real configuration.
    const extraPumpCount = state.fuelPumpsByType
      ? Object.entries(state.fuelPumpsByType)
          .filter(([k]) => k !== "petrol" && k !== "diesel")
          .reduce((sum, [, pumps]) => sum + (pumps?.length || 0), 0)
      : 0;
    return {
      deliveries: state.deliveryData.rows.length,
      clients: Object.keys(state.clients).length,
      invoices: Object.keys(state.invoices).length,
      salesRecords: Object.keys(state.salesHistory).length,
      debtRecords: Object.keys(state.debtHistory).length,
      pmsPumps: state.pmsPumps.length,
      agoPumps: state.agoPumps.length,
      extraPumps: extraPumpCount,
      totalPumps:
        state.pmsPumps.length + state.agoPumps.length + extraPumpCount,
      expenses: state.expenses.length,
      employees: state.employees.length,
      offloadingRecords: state.offloadingRecords.length,
    };
  };

  const exportData = (format: "json" | "csv") => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      if (format === "json") {
        const exportData = {
          version: "2.0",
          exported: new Date().toISOString(),
          appData: state,
        };

        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `FuelPro_Backup_${timestamp}.json`;
        a.click();

        URL.revokeObjectURL(url);
        import("@/react-app/lib/toast").then(({ toastSuccess }) =>
          toastSuccess("Data exported successfully!"),
        );
      }

      if (format === "csv") {
        // Export delivery data as CSV
        const headers = state.deliveryData.columns
          .map((col) => col.label)
          .join(",");
        const rows = state.deliveryData.rows
          .map((row) =>
            state.deliveryData.columns.map((col) => row[col.key]).join(","),
          )
          .join("\n");

        const csvContent = `${headers}\n${rows}`;
        const blob = new Blob([csvContent], { type: "text/csv" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `FuelPro_Deliveries_${timestamp}.csv`;
        a.click();

        URL.revokeObjectURL(url);
        import("@/react-app/lib/toast").then(({ toastSuccess }) =>
          toastSuccess("Delivery data exported as CSV!"),
        );
      }
    } catch (error) {
      console.error("Export error:", error);
      import("@/react-app/lib/toast").then(({ toastError }) =>
        toastError("Export failed. Please try again."),
      );
    }
  };

  // Export EVERYTHING the user has in cloud (app_kv) — every per-component
  // dataset (shifts, payroll, credit, suppliers, expenses, etc.) plus the
  // compact FuelContext blob. This is the true full backup: the in-memory
  // `state` export above only covers FuelContext, but most station data lives
  // in per-component cloud keys that the in-memory state never holds.
  const [exportingCloud, setExportingCloud] = useState(false);
  const exportAllCloudData = async () => {
    setExportingCloud(true);
    try {
      const allData = await cloudStorageService.getAll();
      const keysCount = Object.keys(allData).length;
      if (keysCount === 0) {
        import("@/react-app/lib/toast").then(({ toastInfo }) =>
          toastInfo("No cloud data found to export."),
        );
        return;
      }
      const payload = {
        version: "fuelpro-cloud-backup-1.0",
        exportedAt: new Date().toISOString(),
        keyCount: keysCount,
        data: allData,
      };
      const dataStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FuelPro_CloudBackup_${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      import("@/react-app/lib/toast").then(({ toastSuccess }) =>
        toastSuccess(`Exported ${keysCount} cloud data sets!`),
      );
    } catch (error) {
      console.error("Cloud export error:", error);
      import("@/react-app/lib/toast").then(({ toastError }) =>
        toastError("Cloud export failed. Please try again."),
      );
    } finally {
      setExportingCloud(false);
    }
  };

  const importData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".json")) {
      setImportStatus("Please select a valid JSON backup file.");
      return;
    }

    setImportStatus("Reading backup file...");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const backupData = JSON.parse(content);

        if (!backupData.appData && !backupData.data) {
          throw new Error("Invalid backup file format");
        }

        setImportStatus("Restoring data...");

        // Support both new format (appData) and old format (data)
        const dataToImport = backupData.appData || backupData.data;

        dispatch({ type: "LOAD_FROM_STORAGE", payload: dataToImport });

        setImportStatus("Data imported successfully!");
        setTimeout(() => {
          setImportStatus("");
        }, 3000);
      } catch (error) {
        console.error("Import error:", error);
        setImportStatus("Failed to import data. Invalid backup file.");
        setTimeout(() => {
          setImportStatus("");
        }, 3000);
      }
    };

    reader.readAsText(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const FUELPRO_PREFIX = "fuelpro_";
  const clearData = () => {
    const confirmed = confirm(
      "Are you sure you want to clear ALL FuelPro data? This will remove local data AND your cross-device cloud data for this account. This action cannot be undone!",
    );
    if (confirmed) {
      const confirmedCloud = confirm(
        "This will permanently delete your data from the cloud so it does NOT reappear on other devices. Continue?",
      );
      // Only remove FuelPro keys — never clear all localStorage (destructive to other apps)
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith(FUELPRO_PREFIX) ||
            key === "fuelData" ||
            key === "clients" ||
            key === "invoices" ||
            key === "salesHistory")
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));

      // Also wipe cross-device cloud data so it doesn't re-hydrate on reload/other devices
      if (confirmedCloud) {
        cloudStorageService
          .getAll()
          .then((all) => {
            Object.keys(all || {}).forEach((k) => {
              cloudStorageService.delete(k).catch(() => {});
            });
          })
          .catch(() => {});
      }
      import("@/react-app/lib/app-reloader").then(({ broadcastReload }) =>
        broadcastReload(),
      );
    }
  };

  const downloadStandaloneVersion = () => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

      // Create a complete standalone HTML file
      const standaloneHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FuelPro - Standalone Version</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
            background: linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 100%);
            color: var(--blend-border);
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            background: linear-gradient(135deg, var(--blend-blue) 0%, var(--blend-blue) 100%);
            padding: 30px;
            border-radius: 16px;
            margin-bottom: 30px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.3);
        }
        .header h1 { color: var(--blend-amber); font-size: 2.5rem; margin-bottom: 10px; }
        .header p { color: var(--blend-text-primary); opacity: 0.9; }
        .notice {
            background: var(--blend-blue);
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 20px;
            border-left: 4px solid var(--blend-amber);
        }
        .notice h3 { color: var(--blend-amber); margin-bottom: 10px; }
        .notice ul { padding-left: 20px; line-height: 1.8; }
        .card {
            background: rgba(44, 44, 44, 0.8);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.2);
            border: 1px solid rgba(240, 215, 138, 0.2);
        }
        .card h2 { color: var(--blend-amber); margin-bottom: 15px; font-size: 1.5rem; }
        .btn {
            background: linear-gradient(135deg, var(--blend-amber) 0%, var(--blend-amber) 100%);
            color: #1a1a1a;
            border: none;
            padding: 12px 24px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            transition: all 0.3s ease;
            display: inline-block;
            margin: 5px;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(240, 215, 138, 0.4);
        }
        .data-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }
        .data-item {
            background: var(--blend-amber-bg);
            padding: 15px;
            border-radius: 12px;
            border: 1px solid rgba(240, 215, 138, 0.3);
        }
        .data-item strong { color: var(--blend-amber); display: block; margin-bottom: 5px; }
        .data-item span { color: var(--blend-border); font-size: 1.2rem; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        th {
            background: rgba(240, 215, 138, 0.2);
            color: var(--blend-amber);
            font-weight: 600;
        }
        tr:hover { background: rgba(240, 215, 138, 0.05); }
        .export-section {
            background: rgba(41, 128, 185, 0.2);
            padding: 20px;
            border-radius: 12px;
            margin-top: 20px;
            border: 1px solid rgba(41, 128, 185, 0.4);
        }
        .status { 
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
        }
        .status.success { background: var(--blend-green); color: white; }
        .status.warning { background: var(--blend-amber); color: white; }
        .status.error { background: var(--blend-red); color: white; }
        @media print {
            .btn, .export-section { display: none; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${state.companyData.name || "FuelPro"}</h1>
            <p>Standalone Business Management System - Exported ${new Date().toLocaleDateString()}</p>
        </div>

        <div class="notice">
            <h3>Standalone Version Information</h3>
            <ul>
                <li><strong>Status:</strong> This is a fully functional offline version</li>
                <li><strong>Data Storage:</strong> All data is stored locally in your browser</li>
                <li><strong>Limitations:</strong> M-PESA payments, AI Assistant, and cloud sync are disabled</li>
                <li><strong>Compatibility:</strong> Works on any modern web browser</li>
                <li><strong>Export Date:</strong> ${new Date().toLocaleString()}</li>
            </ul>
        </div>

        <div class="card">
            <h2>Business Summary</h2>
            <div class="data-grid">
                <div class="data-item">
                    <strong>Deliveries</strong>
                    <span>${summary.deliveries}</span>
                </div>
                <div class="data-item">
                    <strong>Clients</strong>
                    <span>${summary.clients}</span>
                </div>
                <div class="data-item">
                    <strong>Invoices</strong>
                    <span>${summary.invoices}</span>
                </div>
                <div class="data-item">
                    <strong>Sales Records</strong>
                    <span>${summary.salesRecords}</span>
                </div>
                <div class="data-item">
                    <strong>${getFuelLabel("PMS")} Pumps</strong>
                    <span>${summary.pmsPumps}</span>
                </div>
                <div class="data-item">
                    <strong>${getFuelLabel("AGO")} Pumps</strong>
                    <span>${summary.agoPumps}</span>
                </div>
                ${summary.extraPumps > 0 ? `<div class="data-item"><strong>Other Fuel Pumps</strong><span>${summary.extraPumps}</span></div>` : ""}
                <div class="data-item">
                    <strong>Total Pumps</strong>
                    <span>${summary.totalPumps}</span>
                </div>
                <div class="data-item">
                    <strong>Employees</strong>
                    <span>${summary.employees}</span>
                </div>
                <div class="data-item">
                    <strong>Expenses</strong>
                    <span>${summary.expenses}</span>
                </div>
            </div>
        </div>

        <div class="card">
            <h2>Delivery Data</h2>
            ${
              state.deliveryData.rows.length > 0
                ? `
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            ${state.deliveryData.columns.map((col) => `<th>${col.label}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${state.deliveryData.rows
                          .slice(0, 50)
                          .map(
                            (row) => `
                            <tr>
                                ${state.deliveryData.columns.map((col) => `<td>${row[col.key] || "-"}</td>`).join("")}
                            </tr>
                        `,
                          )
                          .join("")}
                    </tbody>
                </table>
                ${state.deliveryData.rows.length > 50 ? `<p style="margin-top: 10px; color: var(--blend-amber);">Showing 50 of ${state.deliveryData.rows.length} deliveries</p>` : ""}
            </div>
            `
                : '<p style="color: var(--blend-text-muted);">No delivery data available</p>'
            }
        </div>

        <div class="card">
            <h2>Client Database</h2>
            ${
              Object.keys(state.clients).length > 0
                ? `
            <div class="data-grid">
                ${Object.entries(state.clients)
                  .slice(0, 20)
                  .map(
                    ([_id, client]: [string, any]) => `
                    <div class="data-item">
                        <strong>${client.name}</strong>
                        <span style="font-size: 0.9rem; color: var(--blend-text-muted);">${client.contact || "No contact"}</span>
                    </div>
                `,
                  )
                  .join("")}
            </div>
            ${Object.keys(state.clients).length > 20 ? `<p style="margin-top: 10px; color: var(--blend-amber);">Showing 20 of ${Object.keys(state.clients).length} clients</p>` : ""}
            `
                : '<p style="color: var(--blend-text-muted);">No clients registered</p>'
            }
        </div>

        <div class="export-section">
            <h3 style="color: var(--blend-blue); margin-bottom: 15px;">Export Your Data</h3>
            <button class="btn" onclick="exportAsJSON()">Download JSON</button>
            <button class="btn" onclick="exportAsCSV()">Download CSV</button>
            <button class="btn" onclick="window.print()">Print Report</button>
        </div>

        <div class="card" style="margin-top: 30px; background: var(--blend-amber-bg);">
            <h2>Technical Details</h2>
            <div class="data-grid">
                <div class="data-item">
                    <strong>Version</strong>
                    <span>2.0 Standalone</span>
                </div>
                <div class="data-item">
                    <strong>Data Size</strong>
                    <span>${getDataSize()} KB</span>
                </div>
                <div class="data-item">
                    <strong>Export Date</strong>
                    <span>${new Date().toLocaleDateString()}</span>
                </div>
                <div class="data-item">
                    <strong>Theme</strong>
                    <span>${state.theme || "Dark"}</span>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Embedded app data
        const appData = ${JSON.stringify(state, null, 2)};
        
        // Store data in localStorage for persistence
        localStorage.setItem('fuelpro_standalone_data', JSON.stringify(appData));
        
        function exportAsJSON() {
            const dataStr = JSON.stringify(appData, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'FuelPro_Data_${timestamp}.json';
            a.click();
            URL.revokeObjectURL(url);
        }
        
        function exportAsCSV() {
            if (!appData.deliveryData || !appData.deliveryData.rows.length) {
                toastError('No delivery data to export');
                return;
            }
            
            const headers = appData.deliveryData.columns.map(col => col.label).join(',');
            const rows = appData.deliveryData.rows.map(row => 
                appData.deliveryData.columns.map(col => {
                    const value = row[col.key] || '';
                    return typeof value === 'string' && value.includes(',') ? '"' + value + '"' : value;
                }).join(',')
            ).join('\\n');
            
            const csvContent = headers + '\\n' + rows;
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'FuelPro_Deliveries_${timestamp}.csv';
            a.click();
            URL.revokeObjectURL(url);
        }
        
        console.log('FuelPro Standalone Version Loaded');
        console.log('Data Records:', {
            deliveries: appData.deliveryData?.rows?.length || 0,
            clients: Object.keys(appData.clients || {}).length,
            invoices: Object.keys(appData.invoices || {}).length
        });
    </script>
</body>
</html>`;

      // Create and download the file
      const blob = new Blob([standaloneHTML], {
        type: "text/html;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `FuelPro_Standalone_${timestamp}.html`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();

      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      toastSuccess(
        "Standalone version downloaded successfully! Open the HTML file in any browser to use your app offline.",
      );
    } catch (error) {
      console.error("Download error:", error);
      toastError("Failed to create standalone version. Please try again.");
    }
  };

  const syncWithCloud = async () => {
    if (isCloudSaving) return;

    try {
      await saveToCloud();
      toastSuccess("Data synced to cloud successfully!");
    } catch (error) {
      toastError("Cloud sync failed. Please try again.");
    }
  };

  const summary = getDataSummary();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-white dark:bg-gray-900 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-lg">
                <Database
                  className="text-blue-600 dark:text-blue-400"
                  size={28}
                />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-900 dark:text-white">
                  Data Management Center
                </h1>
                <p className="text-gray-600 dark:text-gray-300">
                  Backup, restore, and manage your business data
                </p>
              </div>
            </div>
            {/* Founder Console Access - hidden but accessible */}
            <button
              onClick={() => (window.location.hash = "#/founder")}
              className="text-[10px] text-gray-300 hover:text-amber-400 transition-colors flex items-center gap-1 opacity-30 hover:opacity-100"
              title="Founder Only"
            >
              Founder Console
            </button>
          </div>

          {/* Tab Navigation - Permission-aware */}
          <div className="flex space-x-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1 overflow-x-auto">
            {[
              { id: "overview", label: "Overview", icon: HardDrive },
              { id: "storage", label: "Storage & Egress", icon: Gauge },
              { id: "diagnostics", label: "Cloud Diagnostics", icon: Cloud },
              hasPermission("canManageCloud")
                ? { id: "recovery", label: "Recovery", icon: RefreshCw }
                : null,
              hasPermission("canManageCloud")
                ? { id: "backup", label: "Backup", icon: Save }
                : null,
              hasPermission("canManageCloud")
                ? { id: "cloud", label: "Cloud Sync", icon: Cloud }
                : null,
              { id: "sync", label: "Cross-Device", icon: Wifi },
            ]
              .filter(Boolean)
              .map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all ${
                      activeTab === tab.id
                        ? "bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-900 dark:text-white"
                    }`}
                  >
                    <Icon size={16} />
                    {tab.label}
                  </button>
                );
              })}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Data Summary */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-900 dark:text-white mb-4">
                Data Summary
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  {
                    label: "Deliveries",
                    value: summary.deliveries,
                    color: "blue",
                  },
                  { label: "Clients", value: summary.clients, color: "green" },
                  {
                    label: "Invoices",
                    value: summary.invoices,
                    color: "yellow",
                  },
                  {
                    label: "Sales Records",
                    value: summary.salesRecords,
                    color: "purple",
                  },
                  {
                    label: `${getFuelLabel("PMS")} Pumps`,
                    value: summary.pmsPumps,
                    color: "red",
                  },
                  {
                    label: `${getFuelLabel("AGO")} Pumps`,
                    value: summary.agoPumps,
                    color: "indigo",
                  },
                  ...(summary.extraPumps > 0
                    ? [
                        {
                          label: "Other Pumps",
                          value: summary.extraPumps,
                          color: "blue",
                        },
                      ]
                    : []),
                  {
                    label: "Employees",
                    value: summary.employees,
                    color: "pink",
                  },
                  {
                    label: "Offloading Records",
                    value: summary.offloadingRecords,
                    color: "gray",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`bg-${item.color}-50 dark:bg-${item.color}-900/20 p-4 rounded-lg border border-${item.color}-200 dark:border-${item.color}-700`}
                  >
                    <div
                      className={`text-2xl font-bold text-${item.color}-600 dark:text-${item.color}-400`}
                    >
                      {formatNumber(item.value, 0)}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    Total Data Size:
                  </span>
                  <span className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white">
                    {getDataSize()} KB
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    Company:
                  </span>
                  <span className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white">
                    {state.companyData.name || "Not Set"}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    Theme:
                  </span>
                  <span className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white capitalize">
                    {state.theme}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-900 dark:text-white mb-4">
                Quick Actions
              </h2>

              <div className="space-y-4">
                <button
                  onClick={downloadStandaloneVersion}
                  className="w-full btn bg-gradient-to-r from-purple-600 to-blue-600 text-gray-900 dark:text-white hover:from-purple-700 hover:to-blue-700 flex items-center gap-3"
                >
                  <Download size={16} />
                  Download Standalone Website
                </button>

                <button
                  onClick={() => exportData("json")}
                  className="w-full btn btn-primary flex items-center gap-3"
                >
                  <Download size={16} />
                  Export Complete Backup
                </button>

                <button
                  onClick={exportAllCloudData}
                  disabled={exportingCloud}
                  className="w-full btn bg-gradient-to-r from-emerald-600 to-teal-600 text-gray-900 dark:text-white hover:from-emerald-700 hover:to-teal-700 flex items-center gap-3 disabled:opacity-60 disabled:cursor-wait"
                >
                  <Cloud size={16} />
                  {exportingCloud
                    ? "Exporting cloud data..."
                    : "Export ALL Cloud Data (Full Backup)"}
                </button>

                <button
                  onClick={() => exportData("csv")}
                  className="w-full btn btn-secondary flex items-center gap-3"
                >
                  <Download size={16} />
                  Export Delivery Data (CSV)
                </button>

                <label className="w-full btn btn-outline flex items-center gap-3 cursor-pointer">
                  <Upload size={16} />
                  Import Data
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={importData}
                    className="hidden"
                  />
                </label>

                {importStatus && (
                  <div
                    className={`p-3 rounded-lg text-sm ${
                      importStatus.includes("✅")
                        ? "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                        : importStatus.includes("❌")
                          ? "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200"
                          : "bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200"
                    }`}
                  >
                    {importStatus}
                  </div>
                )}

                <button
                  onClick={syncWithCloud}
                  disabled={isCloudSaving}
                  className="w-full btn btn-secondary flex items-center gap-3"
                >
                  <Cloud
                    className={isCloudSaving ? "animate-pulse" : ""}
                    size={16}
                  />
                  {isCloudSaving ? "Syncing..." : "Sync to Cloud"}
                </button>
              </div>

              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
                <h3 className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white mb-2">
                  Danger Zone
                </h3>
                <button
                  onClick={clearData}
                  className="w-full btn btn-outline text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-3"
                >
                  <Trash2 size={16} />
                  Clear All Data
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "recovery" && <DataRecovery />}

        {activeTab === "backup" && (
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-900 dark:text-white mb-4">
              Backup Management
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white">
                  Local Backups
                </h3>
                <p className="text-gray-600 dark:text-gray-500 dark:text-gray-400 text-sm">
                  Create and manage local backup files that you can store on
                  your device or cloud storage.
                </p>

                <div className="space-y-3">
                  <button
                    onClick={() => exportData("json")}
                    className="w-full btn btn-primary flex items-center gap-3"
                  >
                    <Download size={16} />
                    Create Full Backup
                  </button>

                  <button
                    onClick={() => {
                      const timestamp = new Date()
                        .toISOString()
                        .replace(/[:.]/g, "-");
                      const backupData = {
                        version: "2.0",
                        type: "settings_only",
                        exported: new Date().toISOString(),
                        data: {
                          theme: state.theme,
                          themeSettings: state.themeSettings,
                          userPreferences: state.userPreferences,
                          companyData: state.companyData,
                          tabConfigurations: state.tabConfigurations,
                        },
                      };

                      const dataStr = JSON.stringify(backupData, null, 2);
                      const blob = new Blob([dataStr], {
                        type: "application/json",
                      });
                      const url = URL.createObjectURL(blob);

                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `FuelPro_Settings_${timestamp}.json`;
                      a.click();

                      URL.revokeObjectURL(url);
                      toastSuccess("Settings backup created!");
                    }}
                    className="w-full btn btn-secondary flex items-center gap-3"
                  >
                    <Settings size={16} />
                    Backup Settings Only
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white">
                  Restore Options
                </h3>
                <p className="text-gray-600 dark:text-gray-500 dark:text-gray-400 text-sm">
                  Import data from backup files to restore your application
                  state.
                </p>

                <label className="w-full btn btn-outline flex items-center gap-3 cursor-pointer">
                  <Upload size={16} />
                  Restore from File
                  <input
                    type="file"
                    accept=".json"
                    onChange={importData}
                    className="hidden"
                  />
                </label>

                {importStatus && (
                  <div
                    className={`p-3 rounded-lg text-sm ${
                      importStatus.includes("✅")
                        ? "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                        : importStatus.includes("❌")
                          ? "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200"
                          : "bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200"
                    }`}
                  >
                    {importStatus}
                  </div>
                )}
              </div>
            </div>

            {/* ERP integration export (Crone-style) */}
            <ErpExport />
          </div>
        )}

        {activeTab === "cloud" && (
          <div className="space-y-6">
            {/* Real Supabase cloud sync status (replaces the legacy Firebase
                panel which read dead localStorage keys + a stale Firestore
                connection that the app no longer uses). */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
              <div className="flex items-center gap-3 mb-4">
                <Cloud className="text-blue-500" size={22} />
                <div>
                  <h2 className="text-lg font-bold text-gray-800 dark:text-white">
                    Cloud Sync Status
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Supabase app_kv store — the source of truth for every
                    cloud-synced component.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Account
                  </div>
                  <div className="mt-1 font-semibold text-gray-800 dark:text-white break-all">
                    {cloudUser ? cloudUser.slice(0, 8) + "…" : "Signed out"}
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Stored data sets
                  </div>
                  <div className="mt-1 font-semibold text-gray-800 dark:text-white">
                    {cloudKeys}
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Live sync
                  </div>
                  <div className="mt-1 font-semibold text-gray-800 dark:text-white">
                    {cloudRealtime ? (
                      <span className="text-green-600 dark:text-green-400">
                        Realtime ON
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        Realtime OFF (low-bandwidth)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={refreshCloudStatus}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <RefreshCw size={16} />
                  Refresh status
                </button>
                <button
                  onClick={syncWithCloud}
                  disabled={isCloudSaving}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Cloud
                    className={isCloudSaving ? "animate-pulse" : ""}
                    size={16}
                  />
                  {isCloudSaving ? "Syncing..." : "Force Sync Now"}
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-900 dark:text-white mb-4">
                Local Cloud Sync
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white">
                    Sync Status
                  </h3>

                  <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Cloud
                        className={
                          isCloudSaving
                            ? "animate-pulse text-blue-500"
                            : "text-green-500"
                        }
                        size={20}
                      />
                      <span className="font-medium text-gray-800 dark:text-gray-900 dark:text-white">
                        {isCloudSaving ? "Syncing..." : "Connected"}
                      </span>
                    </div>

                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-500 dark:text-gray-400">
                      <div className="flex justify-between">
                        <span>Last Sync:</span>
                        <span>
                          {lastCloudSave
                            ? lastCloudSave.toLocaleString()
                            : "Never"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Auto Sync:</span>
                        <span className="text-green-600 dark:text-green-400">
                          Enabled
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Data Size:</span>
                        <span>{getDataSize()} KB</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-900 dark:text-white">
                    Manual Actions
                  </h3>

                  <div className="space-y-3">
                    <button
                      onClick={syncWithCloud}
                      disabled={isCloudSaving}
                      className="w-full btn btn-primary flex items-center gap-3"
                    >
                      <Cloud
                        className={isCloudSaving ? "animate-pulse" : ""}
                        size={16}
                      />
                      {isCloudSaving ? "Syncing..." : "Force Sync Now"}
                    </button>

                    <button
                      onClick={async () => {
                        try {
                          await loadFromCloud();
                          toastSuccess("Data loaded from cloud successfully!");
                        } catch (error) {
                          toastError(
                            "Failed to load from cloud. Using local data.",
                          );
                        }
                      }}
                      className="w-full btn btn-secondary flex items-center gap-3"
                    >
                      <RefreshCw size={16} />
                      Load from Cloud
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                  <CheckCircle size={16} />
                  Cloud Sync Features
                </h4>
                <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                  <li>• Automatic backup every 30 seconds when data changes</li>
                  <li>• Real-time sync across all your devices</li>
                  <li>• Secure encrypted storage in the cloud</li>
                  <li>• Automatic conflict resolution</li>
                  <li>• Data recovery from cloud backups</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === "sync" && <SyncDashboard />}
        {activeTab === "storage" && <StorageEgressPanel />}
        {activeTab === "diagnostics" && <CloudDiagnosticsPanel />}
      </div>
    </div>
  );
}
