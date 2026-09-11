/* CustomerPurchaseHistory — reverse-engineered Veira CRM "see every
 * customer's full history": cross-source timeline for one customer showing
 * POS purchases (pos_transactions), credit activity (credit_transactions),
 * and loyalty points — in one chronological feed with total spend. Select
 * the customer (by name); everything below is computed live.
 */
import { History, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";

interface PosTxnLike {
  id?: string;
  date?: string;
  created_at?: string;
  total?: number;
  customer?: string;
  customerName?: string;
  items?: { name?: string; qty?: number }[];
  payment?: string;
}

interface CreditTxnLike {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  description?: string;
  date?: string;
}

interface CreditAccountLike {
  id: string;
  customerName?: string;
  name?: string;
}

interface EventRow {
  date: string;
  source: "POS" | "Credit";
  label: string;
  amount: number;
}

export default function CustomerPurchaseHistory() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: posTxns } = useCloudKV<PosTxnLike[]>(
    "pos_transactions",
    stationId,
    [],
  );
  const { data: creditTxns } = useCloudKV<CreditTxnLike[]>(
    "credit_transactions",
    stationId,
    [],
  );
  const { data: creditAccounts } = useCloudKV<CreditAccountLike[]>(
    "credit_accounts",
    stationId,
    [],
  );

  const [query, setQuery] = useState("");

  const names = useMemo(() => {
    const set = new Set<string>();
    for (const t of posTxns || []) {
      const n = (t.customer || t.customerName || "").trim();
      if (n) set.add(n);
    }
    for (const a of creditAccounts || []) {
      const n = (a.customerName || a.name || "").trim();
      if (n) set.add(n);
    }
    return Array.from(set).sort();
  }, [posTxns, creditAccounts]);

  const events = useMemo<EventRow[]>(() => {
    if (!query) return [];
    const lower = query.toLowerCase();
    const rows: EventRow[] = [];
    for (const t of posTxns || []) {
      const name = (t.customer || t.customerName || "").toLowerCase();
      if (name && name.includes(lower)) {
        rows.push({
          date: t.date || t.created_at || "",
          source: "POS",
          label: `${
            t.items
              ?.map((i) => i?.name)
              .filter(Boolean)
              .join(", ") || "Sale"
          } (${t.payment || "cash"})`,
          amount: Number(t.total) || 0,
        });
      }
    }
    const accountIds = new Set(
      (creditAccounts || [])
        .filter((a) =>
          (a.customerName || a.name || "").toLowerCase().includes(lower),
        )
        .map((a) => a.id),
    );
    for (const t of creditTxns || []) {
      if (accountIds.has(t.accountId)) {
        rows.push({
          date: t.date || "",
          source: "Credit",
          label: `${t.type}${t.description ? `: ${t.description}` : ""}`,
          amount: t.amount,
        });
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [query, posTxns, creditTxns, creditAccounts]);

  const totals = useMemo(() => {
    const posSpend = events
      .filter((e) => e.source === "POS")
      .reduce((s, e) => s + e.amount, 0);
    return { posSpend, events: events.length };
  }, [events]);

  const fmt = (n: number) =>
    `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-violet-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Customer Purchase History
          </h4>
          <p className="text-xs text-gray-500">
            Full cross-source timeline for one customer (Veira full-history
            view): POS purchases + credit activity.
          </p>
        </div>
      </div>

      <div className="form-group !mb-0 max-w-sm">
        <p className="text-xs text-gray-500">Customer</p>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            list="history-customers"
            placeholder="Type a customer name…"
            className="pl-6 px-2 py-1 rounded text-xs w-full"
          />
          <datalist id="history-customers">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      </div>

      {query && (
        <div className="grid grid-cols-2 gap-2 text-center max-w-sm">
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
            <p className="text-xs text-gray-500">POS spend</p>
            <p className="text-lg font-bold">{fmt(totals.posSpend)}</p>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
            <p className="text-xs text-gray-500">Events</p>
            <p className="text-lg font-bold">{totals.events}</p>
          </div>
        </div>
      )}

      <div className="max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {query ? (
          events.length === 0 ? (
            <p className="p-3 text-xs text-gray-500">
              No purchases or credit activity found for "{query}".
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1.5">Date</th>
                  <th className="text-left px-2 py-1.5">Source</th>
                  <th className="text-left px-2 py-1.5">Details</th>
                  <th className="text-right px-2 py-1.5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr
                    key={`${e.date}-${i}`}
                    className="border-t border-gray-100 dark:border-gray-800"
                  >
                    <td className="px-2 py-1.5">{e.date || "—"}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          e.source === "POS"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                        }`}
                      >
                        {e.source}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 max-w-[240px] truncate">
                      {e.label}
                    </td>
                    <td className="px-2 py-1.5 text-right">{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <p className="p-3 text-xs text-gray-500">
            Type a customer name to see their full history.
          </p>
        )}
      </div>
    </div>
  );
}
