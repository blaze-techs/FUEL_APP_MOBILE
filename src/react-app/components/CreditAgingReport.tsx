/* CreditAgingReport — classic debt-aging buckets (eVMI/credit-analytics
 * style): reads `credit_accounts` and `credit_transactions` cloud KVs and
 * groups outstanding balances into 0–30 / 31–60 / 61–90 / 90+ day buckets
 * based on the last purchase date, with a risk flag for aged debt.
 */
import { CalendarClock } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";

interface AccountLike {
  id?: string;
  customerName?: string;
  name?: string;
  balance?: number;
}

interface TxnLike {
  accountId?: string;
  type?: string;
  date?: string;
  createdAt?: string;
}

interface AgingRow {
  customer: string;
  balance: number;
  days: number;
  bucket: "0-30" | "31-60" | "61-90" | "90+";
}

export default function CreditAgingReport() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const { data: accounts } = useCloudKV<AccountLike[]>(
    "credit_accounts",
    stationId,
    [],
  );
  const { data: txns } = useCloudKV<TxnLike[]>(
    "credit_transactions",
    stationId,
    [],
  );

  const rows = useMemo<AgingRow[]>(() => {
    const now = Date.now();
    return (accounts || [])
      .filter((a) => (a.balance || 0) > 0)
      .map((a) => {
        const purchases = (txns || []).filter(
          (t) =>
            t.accountId === a.id &&
            (t.type === "purchase" || t.type === "Purchase"),
        );
        const last =
          purchases
            .map((t) => t.date || t.createdAt || "")
            .sort()
            .pop() || "";
        const days = last
          ? Math.max(0, Math.floor((now - new Date(last).getTime()) / 86400000))
          : 0;
        const bucket: AgingRow["bucket"] =
          days <= 30
            ? "0-30"
            : days <= 60
              ? "31-60"
              : days <= 90
                ? "61-90"
                : "90+";
        return {
          customer: a.customerName || a.name || a.id || "Customer",
          balance: a.balance || 0,
          days,
          bucket,
        };
      })
      .sort((a, b) => b.days - a.days);
  }, [accounts, txns]);

  const summaries = useMemo(() => {
    const buckets: Record<string, { count: number; total: number }> = {
      "0-30": { count: 0, total: 0 },
      "31-60": { count: 0, total: 0 },
      "61-90": { count: 0, total: 0 },
      "90+": { count: 0, total: 0 },
    };
    for (const r of rows) {
      buckets[r.bucket].count++;
      buckets[r.bucket].total += r.balance;
    }
    return buckets;
  }, [rows]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
        <CalendarClock size={16} /> Credit Aging Report
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Outstanding credit balances grouped by days since last purchase.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {Object.entries(summaries).map(([bucket, s]) => (
          <div
            key={bucket}
            className={`rounded-lg p-3 text-center border ${bucket === "90+" ? "border-red-300 bg-red-50 dark:bg-red-900/20" : bucket === "61-90" ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20" : "border-gray-200 dark:border-gray-600"}`}
          >
            <p className="text-xs text-gray-500">{bucket} days</p>
            <p className="font-bold text-gray-900 dark:text-gray-900 dark:text-white">
              {currency}
              {s.total.toLocaleString()}
            </p>
            <p className="text-[11px] text-gray-500">{s.count} accounts</p>
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No outstanding credit balances.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b dark:border-gray-700">
              <th className="py-2">Customer</th>
              <th className="text-right">Balance</th>
              <th className="text-right">Days</th>
              <th className="text-right">Bucket</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.customer}
                className="border-b border-gray-100 dark:border-gray-700/60"
              >
                <td className="py-1.5 font-medium text-gray-900 dark:text-gray-900 dark:text-white">
                  {r.customer}
                </td>
                <td className="text-right">
                  {currency}
                  {r.balance.toLocaleString()}
                </td>
                <td className="text-right">{r.days}</td>
                <td className="text-right">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${r.bucket === "90+" ? "bg-red-100 text-red-700" : r.bucket === "61-90" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
                  >
                    {r.bucket}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
