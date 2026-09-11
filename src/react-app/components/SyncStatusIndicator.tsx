import { useAutoSync } from "@/react-app/hooks/useAutoSync";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useState } from "react";

interface SyncStatusIndicatorProps {
  countryCode: string;
  compact?: boolean;
}

export default function SyncStatusIndicator({
  countryCode,
  compact = false,
}: SyncStatusIndicatorProps) {
  const {
    isSyncing,
    lastSync,
    error,
    syncNow,
    unreadCount,
    highPriorityCount,
  } = useAutoSync(countryCode);
  const [showDetails, setShowDetails] = useState(false);

  const getLastSyncText = () => {
    if (!lastSync) return "Never synced";
    const diff = Date.now() - new Date(lastSync).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={syncNow}
          disabled={isSyncing}
          className="relative flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:bg-white/10 transition-colors text-[10px] text-gray-500 dark:text-gray-400"
          title={`Last sync: ${getLastSyncText()}`}
        >
          {isSyncing ? (
            <RefreshCw size={10} className="animate-spin text-blue-400" />
          ) : error ? (
            <WifiOff size={10} className="text-red-400" />
          ) : (
            <Wifi size={10} className="text-green-400" />
          )}
          <span>{getLastSyncText()}</span>
          {highPriorityCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full text-[7px] text-gray-900 dark:text-white flex items-center justify-center">
              {highPriorityCount}
            </span>
          )}
          {unreadCount > 0 && highPriorityCount === 0 && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full text-[7px] text-gray-900 dark:text-white flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:bg-white/10 transition-colors"
      >
        {isSyncing ? (
          <RefreshCw size={14} className="animate-spin text-blue-400" />
        ) : error ? (
          <WifiOff size={14} className="text-red-400" />
        ) : (
          <Wifi size={14} className="text-green-400" />
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {isSyncing ? "Syncing..." : error ? "Sync error" : getLastSyncText()}
        </span>
        {unreadCount > 0 && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full ${highPriorityCount > 0 ? "bg-red-500 text-gray-900 dark:text-white" : "bg-amber-500 text-gray-900 dark:text-white"}`}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {showDetails && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
            <RefreshCw
              size={14}
              className={
                isSyncing ? "animate-spin text-blue-400" : "text-green-400"
              }
            />
            Auto-Sync Status
          </h4>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Status:</span>
              <span
                className={
                  isSyncing
                    ? "text-blue-400"
                    : error
                      ? "text-red-400"
                      : "text-green-400"
                }
              >
                {isSyncing ? "Syncing..." : error ? "Error" : "Up to date"}
              </span>
            </div>
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Last sync:</span>
              <span className="text-gray-300">{getLastSyncText()}</span>
            </div>
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Alerts:</span>
              <span
                className={unreadCount > 0 ? "text-amber-400" : "text-gray-500"}
              >
                {unreadCount} unread
              </span>
            </div>
            {error && (
              <div className="flex items-start gap-2 text-red-400 bg-red-900/20 rounded p-2">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              syncNow();
            }}
            disabled={isSyncing}
            className="w-full mt-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-gray-900 dark:text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      )}
    </div>
  );
}
