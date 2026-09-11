import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

/**
 * UpdateAvailableBanner — shows a non-blocking "A new version is available"
 * banner when the app's service worker detects a new deployed build (via the
 * `updatefound` lifecycle). Tapping "Reload" applies the update immediately;
 * the banner can also be dismissed for the session.
 *
 * This removes the "I can't see the update live" problem: instead of silently
 * auto-reloading (which could interrupt in-progress work) OR leaving the user
 * stuck on a stale cached bundle, the user gets an explicit, one-tap update
 * path.
 *
 * Implementation: index.html's SW registration dispatches a
 * `fuelpro-sw-update` CustomEvent on `window` when a new service worker has
 * installed (state === "installed" with an existing controller). This banner
 * listens for that event and renders until dismissed/reloaded.
 */
export default function UpdateAvailableBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onUpdate() {
      setVisible(true);
    }
    window.addEventListener("fuelpro-sw-update", onUpdate);
    return () => window.removeEventListener("fuelpro-sw-update", onUpdate);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[calc(100%-2rem)] max-w-md"
    >
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border border-amber-500/30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
          <RefreshCw size={16} className="text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            New version available
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Reload to get the latest features and fixes.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shrink-0 transition-colors"
        >
          Reload
        </button>
        <button
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
