import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Download, RefreshCw, Search, Shield } from "lucide-react";
import { getSupabaseClient } from "@/supabase/client";
import { toastError } from "@/react-app/lib/toast";

interface AuditRow {
  id: string; station_id: string | null; user_id: string | null; action: string;
  entity_type: string; entity_id: string | null; old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null; ip_address: string | null;
  user_agent: string | null; created_at: string;
}
interface AuditTrailProps { stationId: string; }

export default function AuditTrail({ stationId }: AuditTrailProps) {
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [search, setSearch] = useState(""); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!stationId) return;
    setLoading(true); setError(null);
    try {
      const { data, error: queryError } = await getSupabaseClient()
        .from("immutable_audit_log")
        .select("id,station_id,user_id,action,entity_type,entity_id,old_values,new_values,ip_address,user_agent,created_at")
        .eq("station_id", stationId).order("created_at", { ascending: false }).limit(500);
      if (queryError) throw queryError;
      setEntries((data ?? []) as AuditRow[]);
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : "Failed to load immutable audit trail");
    } finally { setLoading(false); }
  }, [stationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!stationId) return;
    const supabase = getSupabaseClient();
    const channel = supabase.channel("fuelpro-audit-" + stationId)
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"immutable_audit_log",
        filter:"station_id=eq." + stationId }, (payload) => {
          const row = payload.new as AuditRow;
          setEntries(prev => [row, ...prev.filter(x => x.id !== row.id)].slice(0,500));
        }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [stationId]);

  const filtered = entries.filter(e => [e.action,e.entity_type,e.entity_id ?? "",e.user_id ?? "",
    JSON.stringify(e.old_values ?? {}),JSON.stringify(e.new_values ?? {})].join(" ").toLowerCase()
    .includes(search.toLowerCase()));

  const exportCSV = () => {
    if (!filtered.length) { toastError("No audit events to export."); return; }
    const esc = (v: unknown) => '"' + String(v ?? "").replace(/"/g,'""') + '"';
    const rows = [["Timestamp","Action","Entity","Entity ID","User ID","Old Values","New Values"],
      ...filtered.map(e => [e.created_at,e.action,e.entity_type,e.entity_id,e.user_id,
        JSON.stringify(e.old_values ?? {}),JSON.stringify(e.new_values ?? {})])];
    const blob = new Blob([rows.map(r=>r.map(esc).join(",")).join("\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url;
    a.download="fuelpro-audit-trail-"+new Date().toISOString().slice(0,10)+".csv"; a.click(); URL.revokeObjectURL(url);
  };

  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3"><div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl"><Shield size={24} className="text-indigo-600"/></div>
        <div><h2 className="text-2xl font-bold text-gray-900 dark:text-white">Audit Trail</h2>
          <p className="text-sm text-gray-500">Immutable server audit history • {entries.length} loaded events</p></div></div>
      <div className="flex gap-2"><button onClick={()=>void load()} disabled={loading} className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-sm flex items-center gap-2"><RefreshCw size={15} className={loading?"animate-spin":""}/>Refresh</button>
        <button onClick={exportCSV} disabled={!filtered.length} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm flex items-center gap-2 disabled:opacity-50"><Download size={15}/>Export</button></div>
    </div>
    <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search action, entity, ID or change..." className="w-full pl-9 pr-4 py-2.5 rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700"/></div>
    {error && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}
    <div className="rounded-xl border bg-white dark:bg-gray-800 dark:border-gray-700 overflow-hidden"><div className="overflow-auto max-h-[650px]">
      <table className="w-full text-xs"><thead className="sticky top-0 bg-gray-50 dark:bg-gray-700"><tr>
        <th className="text-left p-3">Time</th><th className="text-left p-3">Action</th><th className="text-left p-3">Entity</th><th className="text-left p-3">User</th><th className="text-left p-3">Changes</th>
      </tr></thead><tbody>{filtered.map(e=><tr key={e.id} className="border-t dark:border-gray-700">
        <td className="p-3 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td><td className="p-3 font-semibold">{e.action}</td>
        <td className="p-3">{e.entity_type}{e.entity_id?" / "+e.entity_id:""}</td><td className="p-3">{e.user_id??"System"}</td>
        <td className="p-3 max-w-md truncate">{JSON.stringify({old:e.old_values,new:e.new_values})}</td></tr>)}</tbody></table></div>
      {!filtered.length&&!loading&&<div className="p-10 text-center text-sm text-gray-500"><ClipboardList className="mx-auto mb-2 opacity-50"/>No audit events found.</div>}
    </div>
  </div>;
}