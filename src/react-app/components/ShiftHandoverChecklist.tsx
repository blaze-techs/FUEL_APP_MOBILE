/* ShiftHandoverChecklist — Pesapal/retail-ops style handover form: outgoing
 * shift lists pending items (till variance, open issues, pending deliveries)
 * and hands to the incoming attendant. Reduced today-yesterday risk of
 * information loss. Cloud KV `shift_handovers`.
 */
import { ClipboardList, Plus } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { emitFeatureEvent } from "@/react-app/lib/feature-events";

interface HandoverItem {
  id: string;
  note: string;
  fromShift: string;
  toShift: string;
  acknowledged: boolean;
}

export default function ShiftHandoverChecklist() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: items, setData: setItems } = useCloudKV<HandoverItem[]>(
    "shift_handovers",
    stationId,
    [],
  );
  const [note, setNote] = useState("");
  const [fromShift, setFromShift] = useState("");
  const [toShift, setToShift] = useState("");

  const addItem = () => {
    if (!note.trim()) return;
    setItems((prev) => [
      ...(prev || []),
      {
        id: `ho_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        note: note.trim(),
        fromShift: fromShift.trim(),
        toShift: toShift.trim(),
        acknowledged: false,
      },
    ]);
    setNote("");
    setFromShift("");
    setToShift("");
  };

  const toggleAck = (id: string) => {
    const found = (items || []).find((i) => i.id === id);
    setItems((prev) =>
      (prev || []).map((i) =>
        i.id === id ? { ...i, acknowledged: !i.acknowledged } : i,
      ),
    );
    if (found) {
      emitFeatureEvent({
        type: !found.acknowledged ? "handover.acknowledged" : "handover.added",
        payload: {
          handoverId: id,
          fromShift: found.fromShift,
          toShift: found.toShift,
          note: found.note,
        },
      });
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <ClipboardList size={16} /> Shift Handover
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Outgoing shift notes to the incoming team. Tick when acknowledged.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Handover note"
          className="flex-1 min-w-[200px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={fromShift}
          onChange={(e) => setFromShift(e.target.value)}
          placeholder="From shift"
          className="w-28 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={toShift}
          onChange={(e) => setToShift(e.target.value)}
          placeholder="To shift"
          className="w-28 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addItem}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {(items || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-2">No handover notes.</p>
        ) : (
          [...(items || [])]
            .reverse()
            .slice(0, 30)
            .map((i) => (
              <div
                key={i.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={i.acknowledged}
                  onChange={() => toggleAck(i.id)}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white ${i.acknowledged ? "line-through opacity-60" : ""}`}
                  >
                    {i.note}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {i.fromShift} → {i.toShift}
                  </p>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
}
