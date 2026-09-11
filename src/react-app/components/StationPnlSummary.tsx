/* StationPnlSummary — station-level P&L snapshot (Codelab finance style):
 * revenue (POS transaction totals) minus expenses (the station's
 * expenses_data cloud KV) = net; with a YTD/30D toggle so owners see where
 * money goes. Pure computed view — no new write surface.
 */
import { Calculator } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { formatDate, formatNumber } from "@/react-app/utils/formatUtils";

interface PosTxnLike {
  total?: number;
  date?: string;
  createdAt?: string;
  items?: {
    total?: number;
    amount?: number;
    quantity?: number;
    qty?: number;
  }[];
}

interface ExpenseLike {
  date?: string;
  amount?: number;
  category?: string;
  description?: string;
}

export default function StationPnlSummary() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();
  const [range, setRange] = useState<"30d" | "ytd">("30d");

  const { data: txns } = useCloudKV<PosTxnLike[]>(
    "pos_transactions",
    stationId,
    [],
  );
  const { data: expenses } = useCloudKV<ExpenseLike[]>(
    "expenses_data",
    stationId,
    [],
  );

  const withinRange = useMemo(() => {
    if (range === "30d") return Date.now() - 30 * 86400000;
    return new Date(new Date().getFullYear(), 0, 1).getTime();
  }, [range]);

  const summary = useMemo(() => {
    const inTime = (d?: string) => {
      if (!d) return false;
      return new Date(d).getTime() >= withinRange;
    };
    const revenue = (txns || []).reduce((s, t) => {
      const date = t.date || t.createdAt;
      return inTime(date) ? s + (t.total || 0) : s;
    }, 0);
    const expTotal = (expenses || []).reduce((s, e) => {
      return inTime(e.date) ? s + (e.amount || 0) : s;
    }, 0);
    const expByCat = new Map<string, number>();
    for (const e of expenses || []) {
      if (!inTime(e.date)) continue;
      const cat = e.category || "Other";
      expByCat.set(cat, (expByCat.get(cat) || 0) + (e.amount || 0));
    }
    return {
      revenue,
      expenses: expTotal,
      net: revenue - expTotal,
      expByCat: [...expByCat.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [txns, expenses, withinRange]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
          <Calculator size={16} /> Station P&L
        </h3>
        <div className="flex gap-1">
          {(["30d", "ytd"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2 py-0.5 text-xs font-medium ${range === r ? "bg-amber-500 text-gray-900" : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
            >
              {r === "30d" ? "Last 30 days" : "YTD"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 text-center">
          <p className="text-xs text-gray-500">Revenue</p>
          <p className="text-xl font-bold text-emerald-600">
            {currency}
            {formatNumber(summary.revenue)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 text-center">
          <p className="text-xs text-gray-500">Expenses</p>
          <p className="text-xl font-bold text-red-500">
            {currency}
            {formatNumber(summary.expenses)}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 text-center">
          <p className="text-xs text-gray-500">Net</p>
          <p
            className={`text-xl font-bold ${summary.net >= 0 ? "text-emerald-600" : "text-red-600"}`}
          >
            {currency}
            {formatNumber(summary.net)}
          </p>
        </div>
      </div>
      {summary.expByCat.length > 0 && (
        <p className="text-xs font-bold uppercase text-gray-500 mb-2">
          Expenses by category
        </p>
      )}
      <div className="space-y-1">
        {summary.expByCat.slice(0, 8).map(([cat, amt]) => (
          <div key={cat} className="flex justify-between text-sm">
            <span>{cat}</span>
            <span className="font-medium text-red-500">
              {currency}
              {formatNumber(amt)}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">
        Revenue from POS transactions • expenses from Expense Tracker •{" "}
        {formatDate(new Date(withinRange))} → today
      </p>
    </div>
  );
}
