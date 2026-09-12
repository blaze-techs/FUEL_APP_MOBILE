import { useState, useEffect, useCallback } from "react";
import { RefreshCw, CheckCircle2, Trash2, Inbox, Loader2 } from "lucide-react";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";

interface MemberSuggestion {
  ts: string;
  tab: string;
  by: string;
  payload: {
    note?: string;
    section?: string;
    member?: string;
    [k: string]: unknown;
  };
}

/**
 * MemberSuggestionsPanel — shows the "member edits inbox" that access-code
 * and QR-grant members write to via the member_apply RPC (migration 028).
 * The OWNER reviews each entry here and decides what to apply; entries are
 * read-only until the owner marks them resolved (deletes them from the
 * inbox). This keeps member edits out of the canonical keys until the owner
 * explicitly approves them.
 */
export default function MemberSuggestionsPanel() {
  const { user } = useAuth();
  const { currentStation } = useStations();
  const ownerId = user?.id || "";
  const stationId = currentStation?.id || "";
  const [items, setItems] = useState<MemberSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!ownerId || !stationId) return;
    setLoading(true);
    setMessage("");
    try {
      const rows = await cloudStorageService.getAll();
      const prefix = `member_edits_`;
      const out: Array<{ suggestion: MemberSuggestion; key: string }> = [];
      for (const [key, value] of Object.entries(rows)) {
        if (!key.startsWith(prefix)) continue;
        const arr = Array.isArray(value)
          ? value
          : Array.isArray((value as { data?: unknown })?.data)
            ? (value as { data: unknown[] }).data
            : [];
        arr.forEach((s) =>
          out.push({ suggestion: s as MemberSuggestion, key }),
        );
      }
      out.sort((a, b) =>
        (b.suggestion?.ts || "").localeCompare(a.suggestion?.ts || ""),
      );
      setItems(out.map((o) => o.suggestion));
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not load suggestions.",
      );
    } finally {
      setLoading(false);
    }
  }, [ownerId, stationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeEntry = async (s: MemberSuggestion) => {
    if (!ownerId || !stationId) return;
    // Re-read the inbox row, drop the matching entry, write it back.
    try {
      const rowKey = `member_edits_${s.tab}__${ownerId}__${stationId}`;
      const existing =
        (await cloudStorageService.get<unknown[]>(rowKey, stationId)) ?? [];
      const nextArr = Array.isArray(existing) ? existing : [];
      const filtered = nextArr.filter(
        (e) => !(e && (e as MemberSuggestion).ts === s.ts),
      );
      if (filtered.length > 0) {
        await cloudStorageService.set(rowKey, filtered, stationId);
      } else {
        await cloudStorageService.delete(rowKey, stationId);
      }
      setMessage("Suggestion resolved ✓");
      void load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not remove entry.");
    }
  };

  const clearAll = async () => {
    if (!ownerId || !stationId) return;
    for (const s of items) {
      if (!s?.tab) continue;
      const rowKey = `member_edits_${s.tab}__${ownerId}__${stationId}`;
      try {
        await cloudStorageService.delete(rowKey, stationId);
      } catch {
        /* best-effort clear */
      }
    }
    setItems([]);
    setMessage("All suggestions cleared ✓");
  };

  return (
    <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2 dark:text-white">
          <Inbox size={16} className="text-amber-500" />
          Member suggestions
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
            {items.length}
          </span>
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void load()}
            title="Refresh"
            aria-label="Refresh suggestions"
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
          >
            <RefreshCw size={14} className="text-gray-500" />
          </button>
          {items.length > 0 && (
            <button
              onClick={clearAll}
              title="Clear all suggestions"
              aria-label="Clear all suggestions"
              className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg"
            >
              <Trash2 size={14} className="text-red-500" />
            </button>
          )}
        </div>
      </div>

      {loading && items.length === 0 && (
        <p className="text-xs text-gray-400 flex items-center gap-1.5 py-3">
          <Loader2 size={13} className="animate-spin" /> Loading…
        </p>
      )}
      {message && <p className="text-[11px] text-gray-500 mb-2">{message}</p>}
      {!loading && items.length === 0 && (
        <p className="text-xs text-gray-400 py-3">
          No member suggestions yet. When an access-code or QR-grant member with
          Edit/Normal access sends a change request, it appears here.
        </p>
      )}
      <div className="space-y-2">
        {items.map((s, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold dark:text-white">
                  {s.payload?.member || s.by || "Guest"}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-600 dark:text-gray-300">
                  {s.tab}
                </span>
                <span className="text-[10px] text-gray-400">
                  {s.ts ? new Date(s.ts).toLocaleString() : ""}
                </span>
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-200 mt-1 break-words">
                {s.payload?.note || JSON.stringify(s.payload)}
              </p>
            </div>
            <button
              onClick={() => void removeEntry(s)}
              title="Mark resolved"
              aria-label={`Resolve suggestion from ${s.payload?.member || s.by}`}
              className="p-1.5 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg shrink-0"
            >
              <CheckCircle2 size={15} className="text-green-600" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
