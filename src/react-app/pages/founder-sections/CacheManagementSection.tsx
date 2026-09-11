/**
 * CacheManagementSection — view + clear browser/cloud caches from the Founder
 * Console. Lists localStorage keys + estimated sizes, allows clearing
 * individual keys, all caches, or specific categories. Also clears the
 * cloudStorageService in-memory cache.
 */

import { useEffect, useState } from "react";
import {
  Database,
  Trash2,
  RefreshCw,
  Search,
  HardDrive,
  AlertTriangle,
} from "lucide-react";
import { SectionHeader, IconBtn } from "./WebhooksManagerSection";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

interface Props {
  logAudit: (
    event: string,
    detail: string,
    severity?: "success" | "warning" | "danger" | "info",
  ) => void;
}

interface CacheEntry {
  key: string;
  size: number;
  category: string;
}

const CATEGORY_PREFIXES: Record<string, string> = {
  fuelpro_: "FuelPro",
  founder_console_: "Founder Console",
  fuelpro_cloud_: "Cloud Cache",
  fuelpro_user_coords: "User Prefs",
  fuel_price_locator_cache: "Fuel Prices",
};

function categorize(key: string): string {
  for (const [prefix, label] of Object.entries(CATEGORY_PREFIXES)) {
    if (key.startsWith(prefix)) return label;
  }
  return "Other";
}

function byteSize(str: string): number {
  return new Blob([str]).size;
}

export default function CacheManagementSection({ logAudit }: Props) {
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const result: CacheEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key) ?? "";
      result.push({ key, size: byteSize(value), category: categorize(key) });
    }
    result.sort((a, b) => b.size - a.size);
    setEntries(result);
  }, [refreshKey]);

  const totalSize = entries.reduce((s, e) => s + e.size, 0);
  const filtered = entries.filter((e) =>
    e.key.toLowerCase().includes(search.toLowerCase()),
  );
  const categories = Array.from(new Set(entries.map((e) => e.category)));

  const clearKey = (key: string) => {
    localStorage.removeItem(key);
    logAudit("Cache Cleared", key, "warning");
    setRefreshKey((k) => k + 1);
  };

  const clearCategory = (cat: string) => {
    if (!confirm(`Clear all "${cat}" cache entries?`)) return;
    entries
      .filter((e) => e.category === cat)
      .forEach((e) => localStorage.removeItem(e.key));
    logAudit("Cache Category Cleared", cat, "warning");
    setRefreshKey((k) => k + 1);
  };

  const clearAll = () => {
    if (
      !confirm(
        "Clear ALL localStorage cache entries? This will log you out and reset local state.",
      )
    )
      return;
    localStorage.clear();
    logAudit("All Cache Cleared", `${entries.length} entries`, "danger");
    setRefreshKey((k) => k + 1);
  };

  const clearCloudCache = () => {
    cloudStorageService.invalidate();
    logAudit("Cloud Memory Cache Invalidated", "All keys", "info");
  };

  const formatBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={Database}
        title="Cache Management"
        subtitle="Inspect and clear local + cloud caches"
        count={entries.length}
        right={
          <div className="flex gap-2">
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
            >
              <RefreshCw size={16} /> Refresh
            </button>
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm"
            >
              <Trash2 size={16} /> Clear All
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
            <HardDrive size={14} /> Total Size
          </div>
          <p className="text-lg text-white font-medium">
            {formatBytes(totalSize)}
          </p>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
            <Database size={14} /> Entries
          </div>
          <p className="text-lg text-white font-medium">{entries.length}</p>
        </div>
        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
            <AlertTriangle size={14} /> Categories
          </div>
          <p className="text-lg text-white font-medium">{categories.length}</p>
        </div>
      </div>

      <div className="rounded-xl bg-white/5 border border-white/10 p-3">
        <button
          onClick={clearCloudCache}
          className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300"
        >
          <RefreshCw size={14} /> Invalidate cloud in-memory cache (forces fresh
          reads from Supabase)
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => clearCategory(cat)}
            className="px-2.5 py-1 rounded-full text-xs bg-white/5 text-gray-300 hover:bg-red-500/20 hover:text-red-400"
          >
            {cat} · clear
          </button>
        ))}
      </div>

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cache keys..."
          className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500"
        />
      </div>

      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {filtered.map((e) => (
          <div
            key={e.key}
            className="rounded-lg bg-white/5 border border-white/10 p-2.5 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <code className="text-xs text-white font-mono truncate block">
                {e.key}
              </code>
              <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5">
                <span className="px-1.5 py-0.5 rounded bg-white/5">
                  {e.category}
                </span>
                <span>{formatBytes(e.size)}</span>
              </div>
            </div>
            <IconBtn title="Clear" onClick={() => clearKey(e.key)}>
              <Trash2 size={14} className="text-red-400" />
            </IconBtn>
          </div>
        ))}
      </div>
    </div>
  );
}
