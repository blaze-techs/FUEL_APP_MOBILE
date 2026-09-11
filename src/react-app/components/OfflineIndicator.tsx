// Offline Indicator Component - Shows connection status and pending sync count
// HARDENED (update-5): a broken status service can no longer crash the app.
import { useState, useEffect } from "react";
import { WifiOff, RefreshCw, CloudOff, CheckCircle } from "lucide-react";
import { silentPrintService } from "@/react-app/lib/silent-print-service";
import { indexedStorage } from "@/react-app/lib/indexed-storage";

type Unsubscribe = () => void;

/**
 * Subscribe only if the service actually implements subscribe().
 * Returns a no-op unsubscribe otherwise, so the app keeps running.
 */
function safeSubscribe(
  service: unknown,
  handler: (status: any) => void,
): Unsubscribe {
  try {
    const svc = service as {
      subscribe?: (cb: (s: any) => void) => Unsubscribe;
    };
    if (svc && typeof svc.subscribe === "function") {
      const unsub = svc.subscribe(handler);
      return typeof unsub === "function" ? unsub : () => {};
    }
    console.warn(
      "[OfflineIndicator] service has no subscribe(), skipping:",
      svc,
    );
  } catch (e) {
    console.warn("[OfflineIndicator] subscribe threw:", e);
  }
  return () => {};
}

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [pendingPrints, setPendingPrints] = useState(0);
  const [pendingSyncs, setPendingSyncs] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const unsubscribePrint = safeSubscribe(silentPrintService, (status) => {
      try {
        const queue = Array.isArray(status?.queue) ? status.queue : [];
        setPendingPrints(
          queue.filter(
            (j: any) => j?.status === "pending" || j?.status === "failed",
          ).length,
        );
      } catch {
        setPendingPrints(0);
      }
    });

    const unsubscribeStorage = safeSubscribe(indexedStorage, (status) => {
      try {
        setPendingSyncs(
          typeof status?.pendingChanges === "number"
            ? status.pendingChanges
            : 0,
        );
      } catch {
        setPendingSyncs(0);
      }
    });

    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      try {
        unsubscribePrint();
      } catch {
        /* noop */
      }
      try {
        unsubscribeStorage();
      } catch {
        /* noop */
      }
    };
  }, []);

  if (isOnline && pendingPrints === 0 && pendingSyncs === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="relative">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className={`
            flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all
            ${
              !isOnline
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-amber-500 hover:bg-amber-600 text-white"
            }
          `}
        >
          {!isOnline ? (
            <>
              <WifiOff size={20} />
              <span className="font-medium">Offline</span>
            </>
          ) : (
            <>
              <RefreshCw size={20} className="animate-spin-slow" />
              <span className="font-medium">Syncing...</span>
            </>
          )}
          {(pendingPrints > 0 || pendingSyncs > 0) && (
            <span className="bg-white text-gray-900 rounded-full px-2 py-0.5 text-xs font-bold">
              {pendingPrints + pendingSyncs}
            </span>
          )}
        </button>

        {showDetails && (
          <div className="absolute bottom-full right-0 mb-2 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                {!isOnline ? (
                  <>
                    <WifiOff size={18} className="text-red-500" />
                    Working Offline
                  </>
                ) : (
                  <>
                    <RefreshCw
                      size={18}
                      className="text-amber-500 animate-spin"
                    />
                    Syncing Data
                  </>
                )}
              </h3>
              <div className="space-y-2 text-sm">
                {!isOnline && (
                  <div className="flex items-start gap-2 text-gray-600 dark:text-gray-300">
                    <CloudOff
                      size={16}
                      className="mt-0.5 flex-shrink-0 text-red-400"
                    />
                    <span>
                      You're working offline. Your data is being saved locally
                      and will sync automatically when connected.
                    </span>
                  </div>
                )}
                {pendingPrints > 0 && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                    <RefreshCw size={16} className="text-amber-500" />
                    <span>{pendingPrints} print job(s) pending</span>
                  </div>
                )}
                {pendingSyncs > 0 && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                    <RefreshCw size={16} className="text-amber-500" />
                    <span>{pendingSyncs} change(s) pending sync</span>
                  </div>
                )}
                {isOnline && pendingPrints === 0 && pendingSyncs === 0 && (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <CheckCircle size={16} />
                    <span>All data synced!</span>
                  </div>
                )}
              </div>
              {pendingPrints > 0 && (
                <button
                  onClick={() => {
                    try {
                      (silentPrintService as any)?.retryFailed?.();
                    } catch (e) {
                      console.warn("[OfflineIndicator] retryFailed failed:", e);
                    }
                  }}
                  className="w-full mt-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Retry Failed Prints
                </button>
              )}
            </div>
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400">
              Tap to {showDetails ? "hide" : "show"} details
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
