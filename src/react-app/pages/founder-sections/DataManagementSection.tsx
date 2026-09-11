import { useState } from "react";
import {
  Database,
  Trash2,
  AlertTriangle,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HardDrive,
  Network,
} from "lucide-react";
import SchemaVisualizerSection from "./SchemaVisualizerSection";

interface StorageItem {
  key: string;
  size: number;
  category: string;
}

interface Props {
  logAudit: (
    e: string,
    d: string,
    s: "success" | "warning" | "danger" | "info",
  ) => void;
}

type View = "schema" | "storage";

export default function DataManagementSection({ logAudit }: Props) {
  const [view, setView] = useState<View>("schema");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState(false);

  const items: StorageItem[] = Array.from(
    { length: localStorage.length },
    (_, i) => {
      const key = localStorage.key(i) || "";
      const val = localStorage.getItem(key) || "";
      let category = "Other";
      if (key.includes("fuelpro_")) category = "FuelPro";
      if (key.includes("auth")) category = "Auth";
      if (key.includes("station")) category = "Station";
      if (key.includes("founder")) category = "Founder";
      if (key.includes("config") || key.includes("setting"))
        category = "Config";
      return { key, size: val.length, category };
    },
  ).sort((a, b) => b.size - a.size);

  const filtered = items.filter((i) =>
    i.key.toLowerCase().includes(search.toLowerCase()),
  );
  const totalSize = items.reduce((s, i) => s + i.size, 0);
  const selectedSize = items
    .filter((i) => selected.has(i.key))
    .reduce((s, i) => s + i.size, 0);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === filtered.length
        ? new Set()
        : new Set(filtered.map((i) => i.key)),
    );
  };

  const handleClearSelected = () => {
    if (!confirm(`Delete ${selected.size} items? This cannot be undone.`))
      return;
    setClearing(true);
    selected.forEach((key) => localStorage.removeItem(key));
    logAudit(
      "Data Cleared",
      `Removed ${selected.size} localStorage items`,
      "warning",
    );
    setSelected(new Set());
    setClearing(false);
    import("@/react-app/lib/app-reloader").then(({ broadcastReload }) =>
      broadcastReload(),
    );
  };

  const handleClearCategory = (cat: string) => {
    const catItems = items.filter((i) => i.category === cat);
    if (!confirm(`Delete all ${catItems.length} ${cat} items?`)) return;
    catItems.forEach((i) => localStorage.removeItem(i.key));
    logAudit(
      "Category Cleared",
      `Removed ${catItems.length} ${cat} items`,
      "warning",
    );
    import("@/react-app/lib/app-reloader").then(({ broadcastReload }) =>
      broadcastReload(),
    );
  };

  const categories = [...new Set(items.map((i) => i.category))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Database size={18} className="text-purple-400" /> Database
            Management
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Live Supabase schema &amp; local storage management
          </p>
        </div>
      </div>

      {/* View switcher */}
      <div className="flex items-center gap-1 p-1 bg-[#161618] border border-white/[0.06] rounded-lg w-fit">
        <button
          onClick={() => setView("schema")}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
            view === "schema"
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/20"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Network size={12} /> Schema Visualizer
        </button>
        <button
          onClick={() => setView("storage")}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
            view === "storage"
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/20"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <HardDrive size={12} /> Local Storage
          <span className="text-[9px] text-gray-500">
            {(totalSize / 1024).toFixed(1)}KB
          </span>
        </button>
      </div>

      {view === "schema" ? (
        <SchemaVisualizerSection logAudit={logAudit} />
      ) : (
        <>
          {/* Category Summary */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const catItems = items.filter((i) => i.category === cat);
              const catSize = catItems.reduce((s, i) => s + i.size, 0);
              return (
                <div
                  key={cat}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#161618] border border-white/[0.06] rounded-lg"
                >
                  <span className="text-xs text-white">{cat}</span>
                  <span className="text-[10px] text-gray-500">
                    {catItems.length} keys
                  </span>
                  <span className="text-[10px] text-gray-600">
                    {(catSize / 1024).toFixed(1)} KB
                  </span>
                  <button
                    onClick={() => handleClearCategory(cat)}
                    className="text-gray-500 hover:text-red-400 transition-colors ml-1"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search
                size={12}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search keys..."
                className="w-full pl-8 pr-3 py-2 bg-[#161618] border border-white/[0.06] rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-amber-500/30"
              />
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <span className="text-xs text-amber-400">
                  {selected.size} selected ({(selectedSize / 1024).toFixed(1)}{" "}
                  KB)
                </span>
              )}
              <button
                onClick={toggleAll}
                className="px-2 py-1 bg-white/5 hover:bg-white/10 text-gray-400 text-xs rounded transition-colors"
              >
                {selected.size === filtered.length
                  ? "Deselect All"
                  : "Select All"}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={handleClearSelected}
                  disabled={clearing}
                  className="px-3 py-1 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs rounded border border-red-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                >
                  <Trash2 size={10} />{" "}
                  {clearing ? "Clearing..." : "Delete Selected"}
                </button>
              )}
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-[#161618] border border-white/[0.06] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left text-[10px] text-gray-500 font-medium px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === filtered.length && filtered.length > 0
                      }
                      onChange={toggleAll}
                      className="rounded accent-amber-500"
                    />
                  </th>
                  <th className="text-left text-[10px] text-gray-500 font-medium px-3 py-2">
                    Key
                  </th>
                  <th className="text-left text-[10px] text-gray-500 font-medium px-3 py-2">
                    Category
                  </th>
                  <th className="text-right text-[10px] text-gray-500 font-medium px-3 py-2">
                    Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.key}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.key)}
                        onChange={() => toggleSelect(item.key)}
                        className="rounded accent-amber-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-300 font-mono truncate max-w-[300px]">
                      {item.key}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-gray-400">
                        {item.category}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-gray-500">
                      {(item.size / 1024).toFixed(2)} KB
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
