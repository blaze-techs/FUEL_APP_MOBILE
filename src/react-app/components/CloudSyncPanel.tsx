import { useState, useEffect } from "react";
import { FirebaseService } from "@/react-app/services/FirebaseService";
import { useStations } from "@/react-app/context/StationContext";
import {
  Cloud,
  CloudOff,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Settings,
  Lock,
  KeyRound,
} from "lucide-react";

export default function CloudSyncPanel() {
  const { currentStation } = useStations();
  const [enabled, setEnabled] = useState(FirebaseService.isEnabled());
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(
    localStorage.getItem("fuelpro_last_cloud_sync"),
  );
  const [message, setMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [encKey, setEncKey] = useState("");

  const stationId = currentStation?.id || "default";

  useEffect(() => {
    const handler = () => {
      setLastSync(localStorage.getItem("fuelpro_last_cloud_sync"));
      setMessage("Cloud sync completed!");
      setTimeout(() => setMessage(""), 3000);
    };
    window.addEventListener("fuelpro-cloud-sync", handler);
    return () => window.removeEventListener("fuelpro-cloud-sync", handler);
  }, []);

  const toggle = () => {
    FirebaseService.setEnabled(!enabled);
    setEnabled(!enabled);
    if (!enabled) {
      setMessage("Cloud sync enabled. Data will auto-sync every 60 seconds.");
      setTimeout(() => setMessage(""), 4000);
    }
  };

  const doSync = async () => {
    if (!enabled) {
      setMessage("Enable cloud sync first.");
      return;
    }
    setSyncing(true);
    setMessage("");
    const ok = await FirebaseService.syncToCloud(stationId);
    setSyncing(false);
    setMessage(ok ? "Data synced to cloud!" : "Sync failed. Check connection.");
    if (ok) setLastSync(new Date().toISOString());
    setTimeout(() => setMessage(""), 4000);
  };

  const doRestore = async () => {
    if (!enabled) {
      setMessage("Enable cloud sync first.");
      return;
    }
    setSyncing(true);
    setMessage("");
    const ok = await FirebaseService.restoreFromCloud(stationId);
    setSyncing(false);
    setMessage(
      ok ? "Data restored from cloud! Refreshing..." : "No cloud data found.",
    );
    if (ok) {
      setLastSync(new Date().toISOString());
      import("@/react-app/lib/app-reloader").then(({ triggerSoftReload }) =>
        triggerSoftReload(1500),
      );
    }
    setTimeout(() => setMessage(""), 4000);
  };

  const saveKey = () => {
    if (encKey.trim()) {
      FirebaseService.setEncryptionKey(encKey.trim());
      setMessage("Encryption key saved!");
      setTimeout(() => setMessage(""), 3000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div
        className={`flex items-center justify-between p-4 rounded-xl border ${enabled ? "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800" : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"}`}
      >
        <div className="flex items-center gap-3">
          {enabled ? (
            <Cloud size={20} className="text-blue-500" />
          ) : (
            <CloudOff size={20} className="text-gray-400" />
          )}
          <div>
            <p className="text-sm font-semibold dark:text-white">
              {enabled ? "Cloud Sync Active" : "Cloud Sync Disabled"}
            </p>
            <p className="text-[11px] text-gray-500">
              {lastSync
                ? `Last sync: ${new Date(lastSync).toLocaleString()}`
                : "Never synced"}
            </p>
          </div>
        </div>
        <button
          onClick={toggle}
          className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors ${enabled ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/20 dark:text-red-400" : "bg-blue-600 text-white hover:bg-blue-700"}`}
        >
          {enabled ? "Disable" : "Enable"}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg text-xs ${message.includes("failed") || message.includes("first") ? "bg-red-50 text-red-700 dark:bg-red-900/10" : "bg-green-50 text-green-700 dark:bg-green-900/10"}`}
        >
          {message.includes("failed") ? (
            <AlertCircle size={14} />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {message}
        </div>
      )}

      {/* Actions */}
      {enabled && (
        <div className="flex gap-3">
          <button
            onClick={doSync}
            disabled={syncing}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Upload size={14} className={syncing ? "animate-bounce" : ""} />{" "}
            Sync to Cloud
          </button>
          <button
            onClick={doRestore}
            disabled={syncing}
            className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-xl text-xs font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Download size={14} className={syncing ? "animate-bounce" : ""} />{" "}
            Restore from Cloud
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-gray-600 dark:text-gray-300 transition-colors"
          >
            <Settings size={14} />
          </button>
        </div>
      )}

      {/* Settings */}
      {showSettings && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 space-y-3">
          <h4 className="text-sm font-semibold dark:text-white flex items-center gap-2">
            <KeyRound size={14} /> Encryption Key
          </h4>
          <div className="flex gap-2">
            <input
              type="password"
              value={encKey}
              onChange={(e) => setEncKey(e.target.value)}
              placeholder="Enter custom encryption key..."
              className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <button
              onClick={saveKey}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium"
            >
              Save
            </button>
          </div>
          <p className="text-[10px] text-gray-500">
            This key encrypts your data before sending to the cloud. Use the
            same key on all your devices.
          </p>
        </div>
      )}
    </div>
  );
}
