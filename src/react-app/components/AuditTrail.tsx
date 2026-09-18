import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/supabase/client";
import { toastError } from "@/react-app/lib/toast";

interface AuditEntry {
  id: string;
  station_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export default function AuditTrail({ stationId }: { stationId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!stationId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("immutable_audit_log")
        .select("id,station_id,user_id,action,entity_type,entity_id,old_values,new_values,created_at")
        .eq("station_id", stationId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setEntries((data || []) as AuditEntry[]);
    } catch (e) {
      toastError("Could not load the immutable audit log: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!stationId) return;
    const channel = supabase
      .channel("fuelpro-immutable-audit-" + stationId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "immutable_audit_log",
          filter: "station_id=eq." + stationId,
        },
        (payload) => {
          setEntries((prev) => [payload.new as AuditEntry, ...prev].slice(0, 500));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [stationId]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => set.add(e.entity_type || "system"));
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (category !== "all" && (e.entity_type || "system") !== category) return false;
      if (!q) return true;
      return [e.action, e.entity_type, e.entity_id, e.user_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [entries, search, category]);

  function exportCsv() {
    const rows = [
      ["Timestamp", "Action", "Entity", "Entity ID", "User ID"],
      ...filtered.map((e) => [e.created_at, e.action, e.entity_type, e.entity_id || "", e.user_id || ""]),
    ];
    const csv = rows.map((r) => r.map((v) => {
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? '"' + s + '"' : s;
    }).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fuelpro-immutable-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px] relative">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search action, entity, user…" className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm" />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
          {categories.map((c) => <option key={c} value={c}>{c === "all" ? "All entities" : c}</option>)}
        </select>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm">
          <Download size={14} /> CSV
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <ShieldCheck size={14} /> Immutable audit records · {filtered.length} shown
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50 dark:bg-gray-900">
            <th className="p-3">Time</th><th className="p-3">Action</th><th className="p-3">Entity</th><th className="p-3">Entity ID</th><th className="p-3">User</th>
          </tr></thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 dark:border-gray-800">
                <td className="p-3 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                <td className="p-3 font-medium">{e.action}</td>
                <td className="p-3">{e.entity_type}</td>
                <td className="p-3 font-mono text-xs">{e.entity_id || "—"}</td>
                <td className="p-3 font-mono text-xs">{e.user_id || "system"}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={5} className="p-8 text-center text-gray-500">No audit events found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
