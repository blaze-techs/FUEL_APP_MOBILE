/* CustomerComplaintsLog — Veira CRM-style complaints register: captures
 * customer complaints with severity and resolution status, kept in a
 * station-scoped cloud KV so every device sees open complaints instantly.
 */
import { MessageSquareWarning, Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { emitFeatureEvent } from "@/react-app/lib/feature-events";

interface Complaint {
  id: string;
  date: string;
  customer: string;
  subject: string;
  severity: "low" | "medium" | "high";
  resolved: boolean;
}

export default function CustomerComplaintsLog() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: items, setData: setItems } = useCloudKV<Complaint[]>(
    "customer_complaints",
    stationId,
    [],
  );
  const [customer, setCustomer] = useState("");
  const [subject, setSubject] = useState("");
  const [severity, setSeverity] = useState<Complaint["severity"]>("medium");
  const [showResolved, setShowResolved] = useState(false);

  const addItem = () => {
    if (!customer.trim() || !subject.trim()) return;
    setItems((prev) => [
      ...(prev || []),
      {
        id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: new Date().toISOString().slice(0, 10),
        customer: customer.trim(),
        subject: subject.trim(),
        severity,
        resolved: false,
      },
    ]);
    setCustomer("");
    setSubject("");
  };

  const toggleResolve = (id: string) => {
    const found = (items || []).find((c) => c.id === id);
    setItems((prev) =>
      (prev || []).map((c) =>
        c.id === id ? { ...c, resolved: !c.resolved } : c,
      ),
    );
    if (found) {
      emitFeatureEvent({
        type: !found.resolved ? "complaint.resolved" : "complaint.opened",
        payload: {
          complaintId: id,
          customer: found.customer,
          severity: found.severity,
        },
      });
    }
  };

  const visible = useMemo(
    () =>
      [...(items || [])]
        .filter((c) => (showResolved ? true : !c.resolved))
        .reverse(),
    [items, showResolved],
  );

  const openCount = (items || []).filter((c) => !c.resolved).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <MessageSquareWarning size={16} /> Customer Complaints
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {openCount} open complaints. Track resolution so nothing slips.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder="Customer"
          className="w-40 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Complaint (e.g. short delivery)"
          className="flex-1 min-w-[180px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Complaint["severity"])}
          className="rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button
          onClick={addItem}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Log
        </button>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-500 mb-2">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(e) => setShowResolved(e.target.checked)}
        />
        Show resolved
      </label>
      <div className="space-y-1.5">
        {visible.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">
            No complaints — keep the forecourt running smoothly.
          </p>
        ) : (
          visible.slice(0, 30).map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
            >
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${c.severity === "high" ? "bg-red-100 text-red-700" : c.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}
              >
                {c.severity}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white ${c.resolved ? "line-through opacity-60" : ""}`}
                >
                  {c.customer}: {c.subject}
                </p>
                <p className="text-[11px] text-gray-500">{c.date}</p>
              </div>
              <button
                onClick={() => toggleResolve(c.id)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${c.resolved ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
              >
                <Check size={12} /> {c.resolved ? "Resolved" : "Resolve"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
