import React, { useState, useEffect } from "react";
import {
  HardDrive,
  Cloud,
  Gauge,
  Activity,
  Zap,
  AlertTriangle,
  RefreshCw,
  TrendingDown,
} from "lucide-react";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { isCompressedPayload } from "@/react-app/lib/compression";
import { useAuth } from "@/react-app/context/AuthContext";

/**
 * Storage & Egress panel — surfaces the compression + Realtime kill-switch
 * that protect the Supabase Free-plan quotas (egress 5 GB/mo, Realtime
 * messages 2M/mo). Live-computes a compression-ratio estimate from the
 * user's localStorage read-through cache (a representative sample of the
 * cloud rows) and shows the current Realtime state + a one-click toggle.
 */
export default function StorageEgressPanel() {
  const { user } = useAuth();
  const [realtimeEnabled, setRealtimeEnabled] = useState(
    cloudStorageService.isRealtimeEnabled(),
  );
  const [stats, setStats] = useState<{
    rows: number;
    compressed: number;
    rawBytes: number;
    storedBytes: number;
  }>({ rows: 0, compressed: 0, rawBytes: 0, storedBytes: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  // Scan the localStorage read-through cache to estimate compression savings.
  // This is a client-side sample (the actual compressed rows live in the
  // Supabase app_kv table), but it reflects the same data the cloud stores.
  useEffect(() => {
    const next = { rows: 0, compressed: 0, rawBytes: 0, storedBytes: 0 };
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("fuelpro_cloud_")) continue;
      const v = localStorage.getItem(k) ?? "";
      next.rows++;
      // The cache stores DECOMPRESSED values (read-through), so the cloud
      // row would be ~compressed-size. Estimate the original JSON size from
      // the cached string, and the compressed size via a re-compress probe.
      next.rawBytes += v.length;
      try {
        const parsed = JSON.parse(v);
        // If the cached value is itself an envelope (rare — happens when a
        // legacy row was read but not yet healed), count it as compressed.
        if (isCompressedPayload(parsed)) {
          next.compressed++;
          next.storedBytes += JSON.stringify(parsed).length;
        } else {
          // Re-compress to estimate the cloud wire size.
          // We can't import compress synchronously here without a cycle, so
          // approximate: gzip ratio for JSON text is ~0.25-0.35; use 0.3.
          next.storedBytes += Math.round(v.length * 0.3);
        }
      } catch {
        // Non-JSON cache entry (e.g. a raw string) — count as-is.
        next.storedBytes += v.length;
      }
    }
    setStats(next);
  }, [refreshKey, user?.id]);

  const savingsPct =
    stats.rawBytes > 0
      ? Math.max(0, (1 - stats.storedBytes / stats.rawBytes) * 100)
      : 0;
  const savedKb = Math.max(0, (stats.rawBytes - stats.storedBytes) / 1024);

  const toggleRealtime = () => {
    const next = !realtimeEnabled;
    cloudStorageService.setRealtimeEnabled(next);
    setRealtimeEnabled(next);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
        <div className="flex items-center gap-3 mb-2">
          <HardDrive className="text-blue-600 dark:text-blue-400" size={24} />
          <h2 className="text-xl font-bold text-gray-800 dark:text-white">
            Storage &amp; Egress
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Your Supabase organization is on the Free plan. These controls keep
          cloud data compressed and let you cut Realtime traffic to stay within
          quota (egress 5 GB/mo, Realtime 2M messages/mo).
        </p>

        {/* Quota warning if Realtime is enabled (still consuming messages) */}
        {!realtimeEnabled ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 text-green-800 dark:text-green-300 text-sm">
            <Zap size={16} className="mt-0.5 shrink-0" />
            <span>
              <strong>Low-bandwidth mode ON.</strong> Realtime subscriptions are
              paused — cross-device changes sync via the read-through cache on
              next load instead of live push. Realtime message usage is now ~0.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-300 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              <strong>Realtime is ON.</strong> ~30 channels push live updates on
              every cross-device write. If you approach the 2M/month Realtime
              cap, toggle Low-bandwidth mode below.
            </span>
          </div>
        )}

        {/* Realtime toggle */}
        <div className="mt-4 flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
          <div className="flex items-center gap-3">
            <Activity
              className={
                realtimeEnabled
                  ? "text-green-600 dark:text-green-400"
                  : "text-gray-400"
              }
              size={20}
            />
            <div>
              <div className="font-semibold text-gray-800 dark:text-white">
                Low-bandwidth mode (pause Realtime)
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Cuts Realtime message quota to ~0. Cross-device edits appear on
                next reload instead of instantly.
              </div>
            </div>
          </div>
          <button
            onClick={toggleRealtime}
            role="switch"
            aria-checked={!realtimeEnabled}
            aria-label="Toggle low-bandwidth realtime mode"
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              !realtimeEnabled ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                !realtimeEnabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Compression stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={<Cloud size={20} />}
          label="Cached cloud rows"
          value={stats.rows.toString()}
          sub="app_kv keys in local cache"
        />
        <StatCard
          icon={<TrendingDown size={20} />}
          label="Estimated compression"
          value={savingsPct > 0 ? `${savingsPct.toFixed(0)}%` : "—"}
          sub={
            savedKb > 0
              ? `~${savedKb.toFixed(1)} KB saved vs raw`
              : "no large rows yet"
          }
          accent="green"
        />
        <StatCard
          icon={<Gauge size={20} />}
          label="Wire size (est.)"
          value={
            stats.storedBytes > 0
              ? `${(stats.storedBytes / 1024).toFixed(1)} KB`
              : "—"
          }
          sub={`vs ${(stats.rawBytes / 1024).toFixed(1)} KB raw`}
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-600">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800 dark:text-white">
            How compression works
          </h3>
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            <RefreshCw size={14} /> Refresh stats
          </button>
        </div>
        <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-2 list-disc pl-5">
          <li>
            Every value written to the cloud (<code>app_kv</code>) is
            gzip-compressed (level 6) before the network round-trip and
            decompressed transparently on read — no data loss, full round-trip
            fidelity.
          </li>
          <li>
            Existing uncompressed rows are auto-healed to the compressed
            envelope on first read (one-shot migration runs on sign-in).
          </li>
          <li>
            Legacy envelopes from prior builds are decoded seamlessly and
            re-persisted in the canonical shape.
          </li>
          <li>
            The read-through localStorage cache + 5-minute memory cache
            eliminate redundant GETs (each GET is billable egress).
          </li>
          <li>
            In-flight GET deduplication coalesces simultaneous reads of the same
            key into a single round-trip.
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent?: "green";
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow border border-gray-200 dark:border-gray-600">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 mb-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div
        className={`text-2xl font-bold ${
          accent === "green"
            ? "text-green-600 dark:text-green-400"
            : "text-gray-800 dark:text-white"
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{sub}</div>
    </div>
  );
}
