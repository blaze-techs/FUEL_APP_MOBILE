/* DiscountApprovalQueue — Pesapal/POS discount discipline: tenders log the
 * discount they granted; supervisor reviews pending approvals in a queue.
 * Cloud KV `discount_approvals` — stops uncontrolled markdowns.
 */
import { Percent, Check, X, Plus } from "lucide-react";
import { useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { emitFeatureEvent } from "@/react-app/lib/feature-events";

interface Request {
  id: string;
  date: string;
  cash: string;
  amount: number;
  reason: string;
  approved: boolean | null;
}

export default function DiscountApprovalQueue() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: requests, setData: setRequests } = useCloudKV<Request[]>(
    "discount_approvals",
    stationId,
    [],
  );
  const [cash, setCash] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const addRequest = () => {
    const a = Number(amount);
    if (!a || a <= 0) return;
    setRequests((prev) => [
      ...(prev || []),
      {
        id: `da_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        date: new Date().toISOString().slice(0, 10),
        cash: cash.trim(),
        amount: a,
        reason: reason.trim(),
        approved: null,
      },
    ]);
    setCash("");
    setAmount("");
    setReason("");
  };

  const decide = (id: string, decision: boolean) => {
    const found = (requests || []).find((r) => r.id === id);
    setRequests((prev) =>
      (prev || []).map((r) => (r.id === id ? { ...r, approved: decision } : r)),
    );
    if (found) {
      emitFeatureEvent({
        type: decision ? "discount.approved" : "discount.rejected",
        payload: {
          discountId: id,
          amount: found.amount,
          cash: found.cash,
        },
      });
    }
  };

  const pending = (requests || []).filter((r) => r.approved === null);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <Percent size={16} /> Discount Approval Queue
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {pending.length} pending approval.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={cash}
          onChange={(e) => setCash(e.target.value)}
          placeholder="Cashier"
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          placeholder={`Amount (${currency})`}
          className="w-32 rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason"
          className="flex-1 min-w-[180px] rounded border px-2 py-1.5 text-sm dark:bg-gray-700 dark:border-gray-600"
        />
        <button
          onClick={addRequest}
          className="flex items-center gap-1 bg-amber-500 text-gray-900 rounded px-3 py-1.5 text-sm font-medium"
        >
          <Plus size={14} /> Request
        </button>
      </div>
      <div className="space-y-1.5">
        {(requests || []).length === 0 ? (
          <p className="text-sm text-gray-500 py-2">No discount requests.</p>
        ) : (
          [...(requests || [])]
            .reverse()
            .slice(0, 30)
            .map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                    {currency}
                    {r.amount.toLocaleString()} {r.cash ? `by ${r.cash}` : ""}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {r.reason || "no reason"} • {r.date}
                  </p>
                </div>
                {r.approved === null ? (
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => decide(r.id, true)}
                      className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700"
                    >
                      <Check size={12} /> Approve
                    </button>
                    <button
                      onClick={() => decide(r.id, false)}
                      className="flex items-center gap-1 rounded bg-red-100 px-2 py-1 text-xs font-medium text-red-700"
                    >
                      <X size={12} /> Reject
                    </button>
                  </div>
                ) : (
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${r.approved ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
                  >
                    {r.approved ? "Approved" : "Rejected"}
                  </span>
                )}
              </div>
            ))
        )}
      </div>
    </div>
  );
}
