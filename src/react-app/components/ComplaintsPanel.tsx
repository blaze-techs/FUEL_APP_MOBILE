/* ComplaintsPanel (read-only) — Communication complains sub-view. Renders
 * open complaints from the CustomerLoyalty complaints KV (owner:
 * CustomerComplaintsLog) so the comms team sees what to act on WITHOUT
 * duplicating the complaint form (single-writer boundary retained). The
 * resolution toggle stays in the CustomerLoyalty complaints view.
 */
import { MessageSquareWarning, Send } from "lucide-react";
import { navigateToTab } from "@/react-app/lib/mpesa-integration-service";

interface ComplaintEntry {
  id: string;
  date: string;
  customer: string;
  subject: string;
  severity: "low" | "medium" | "high";
  resolved: boolean;
}

export default function ComplaintsPanel({
  complaints,
  stationId: _stationId,
}: {
  complaints: ComplaintEntry[];
  stationId?: string;
}) {
  const open = complaints.filter((c) => !c.resolved);
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <MessageSquareWarning size={16} /> Open Complaints ({open.length})
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        Logged in Customers → Complaints; resolved there. This list is read-only
        for the comms team.
      </p>
      {open.length === 0 ? (
        <p className="text-sm text-gray-500">No open complaints — great.</p>
      ) : (
        <div className="space-y-1.5">
          {open.slice(0, 30).map((c) => (
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
                <p className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  {c.customer}: {c.subject}
                </p>
                <p className="text-[11px] text-gray-500">{c.date}</p>
              </div>
              <button
                onClick={() =>
                  navigateToTab("communication", {
                    prefill: { customer: c.customer },
                  })
                }
                className="flex items-center gap-1 rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700"
              >
                <Send size={12} /> Message
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
