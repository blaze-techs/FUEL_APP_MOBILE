// Connection status indicator — only reports OFFLINE after an actual connectivity loss.
// It deliberately does not use "backend unavailable" as a synonym for "offline":
// an API/provider outage is a degraded-service condition, not proof that the device
// has lost internet access.
//
// Recovery is session-local: FuelContext already checkpoints state to local storage
// continuously, so a short network interruption does not reset the user's current
// work. The indicator also records the disconnect timestamp for diagnostics without
// inventing/reconstructing data.
import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff, RefreshCw, CloudOff, CheckCircle } from "lucide-react";
import { silentPrintService } from "@/react-app/lib/silent-print-service";
import { indexedStorage } from "@/react-app/lib/indexed-storage";

type Unsubscribe = () => void;
type Connectivity = "online" | "offline" | "degraded";

function safeSubscribe(service: unknown, handler: (status: any) => void): Unsubscribe {
  try {
    const svc = service as { subscribe?: (cb: (s: any) => void) => Unsubscribe };
    if (svc && typeof svc.subscribe === "function") {
      const unsub = svc.subscribe(handler);
      return typeof unsub === "function" ? unsub : () => {};
    }
  } catch (e) {
    console.warn("[OfflineIndicator] subscribe failed:", e);
  }
  return () => {};
}

/**
 * navigator.onLine is authoritative for a confirmed local network disconnect,
 * but it can remain true when a captive portal/provider is unavailable.
 * A lightweight same-origin no-store probe catches that case without declaring
 * the device "offline" just because Supabase/API is temporarily unavailable.
 */
async function probeInternet(): Promise<boolean> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  if (typeof window === "undefined") return true;

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `${window.location.origin}/?fuelpro_connectivity=${Date.now()}`,
      {
        method: "HEAD",
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      },
    );
    window.clearTimeout(timer);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

export default function OfflineIndicator() {
  const [connectivity, setConnectivity] = useState<Connectivity>(
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
  );
  const [pendingPrints, setPendingPrints] = useState(0);
  const [pendingSyncs, setPendingSyncs] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const disconnectAtRef = useRef<number | null>(null);
  const lastProbeFailureRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const updateConnectivity = async (eventType?: "online" | "offline") => {
      if (eventType === "offline") {
        disconnectAtRef.current = Date.now();
        setConnectivity("offline");
        return;
      }

      if (eventType === "online") {
        // Browser says the link returned; verify it before declaring ONLINE.
        const reachable = await probeInternet();
        if (disposed) return;
        if (reachable) {
          setConnectivity("online");
          lastProbeFailureRef.current = 0;
          // Keep the recovery timestamp only for the current session.
          // FuelContext's local checkpoint is the actual data recovery source.
          if (disconnectAtRef.current) {
            const duration = Date.now() - disconnectAtRef.current;
            if (duration <= 30_000) {
              try {
                sessionStorage.setItem(
                  "fuelpro_last_network_recovery",
                  JSON.stringify({
                    disconnectedAt: disconnectAtRef.current,
                    reconnectedAt: Date.now(),
                    durationMs: duration,
                  }),
                );
              } catch {
                /* sessionStorage is best-effort diagnostics only */
              }
            }
            disconnectAtRef.current = null;
          }
        } else {
          setConnectivity("degraded");
        }
        return;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        disconnectAtRef.current ??= Date.now();
        setConnectivity("offline");
        return;
      }

      const reachable = await probeInternet();
      if (disposed) return;
      if (reachable) {
        setConnectivity("online");
        lastProbeFailureRef.current = 0;
      } else {
        // Do not label a provider/API failure as OFFLINE immediately.
        // "degraded" means the network link exists but this app origin did not
        // answer the probe. OFFLINE is reserved for navigator.onLine=false.
        lastProbeFailureRef.current = Date.now();
        setConnectivity("degraded");
      }
    };

    const handleOnline = () => void updateConnectivity("online");
    const handleOffline = () => void updateConnectivity("offline");

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void updateConnectivity();

    const probeTimer = window.setInterval(() => {
      void updateConnectivity();
    }, 15_000);

    const unsubscribePrint = safeSubscribe(silentPrintService, (status) => {
      try {
        const queue = Array.isArray(status?.queue) ? status.queue : [];
        setPendingPrints(
          queue.filter((j: any) => j?.status === "pending" || j?.status === "failed").length,
        );
      } catch {
        setPendingPrints(0);
      }
    });

    const unsubscribeStorage = safeSubscribe(indexedStorage, (status) => {
      try {
        setPendingSyncs(
          typeof status?.pendingChanges === "number" ? status.pendingChanges : 0,
        );
      } catch {
        setPendingSyncs(0);
      }
    });

    return () => {
      disposed = true;
      window.clearInterval(probeTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubscribePrint();
      unsubscribeStorage();
    };
  }, []);

  // Nothing needs to be shown during a healthy connection with no queued work.
  if (connectivity === "online" && pendingPrints === 0 && pendingSyncs === 0) {
    return null;
  }

  const offline = connectivity === "offline";
  const degraded = connectivity === "degraded";

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="relative">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className={`flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all ${
            offline
              ? "bg-red-500 hover:bg-red-600 text-white"
              : degraded
                ? "bg-orange-500 hover:bg-orange-600 text-white"
                : "bg-amber-500 hover:bg-amber-600 text-white"
          }`}
          aria-label={offline ? "Internet connection lost" : degraded ? "Connection degraded" : "Synchronizing data"}
        >
          {offline ? (
            <>
              <WifiOff size={20} />
              <span className="font-medium">Offline</span>
            </>
          ) : degraded ? (
            <>
              <Wifi size={20} />
              <span className="font-medium">Connection unstable</span>
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
          <div className="absolute bottom-full right-0 mb-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                {offline ? (
                  <>
                    <WifiOff size={18} className="text-red-500" />
                    Internet connection lost
                  </>
                ) : degraded ? (
                  <>
                    <Wifi size={18} className="text-orange-500" />
                    Connection unstable
                  </>
                ) : (
                  <>
                    <RefreshCw size={18} className="text-amber-500 animate-spin" />
                    Synchronizing data
                  </>
                )}
              </h3>

              <div className="space-y-2 text-sm">
                {offline && (
                  <div className="flex items-start gap-2 text-gray-600 dark:text-gray-300">
                    <CloudOff size={16} className="mt-0.5 flex-shrink-0 text-red-400" />
                    <span>
                      Internet access is currently lost. Your current session data
                      remains locally checkpointed and pending changes will sync
                      automatically after the connection returns.
                    </span>
                  </div>
                )}

                {degraded && (
                  <div className="flex items-start gap-2 text-gray-600 dark:text-gray-300">
                    <Wifi size={16} className="mt-0.5 flex-shrink-0 text-orange-400" />
                    <span>
                      The device still reports a network connection, but the app
                      cannot currently reach its web origin. This is not treated as
                      confirmed offline mode.
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

                {connectivity === "online" && pendingPrints === 0 && pendingSyncs === 0 && (
                  <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <CheckCircle size={16} />
                    <span>Connected and fully synced</span>
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
              {offline
                ? "Offline is shown only after the browser confirms a network loss."
                : "Connection status is verified without fabricating application data."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
