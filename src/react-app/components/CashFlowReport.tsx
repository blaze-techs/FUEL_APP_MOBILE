/* CashFlowReport — reverse-engineered Codelab FMS "Cash Flow" graphical
 * report: month-wise cash in vs cash out with net position per month.
 * Reads real POS transactions (cash/M-Pesa/card in) + expenses (out) from
 * the shared cloud stores — no manual entry. Pure computed view.
 */
import { Download, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess } from "@/react-app/lib/toast";

interface PosTransactionLike {
  id?: string;
  date?: string;
  created_at?: string;
  total?: number;
  payment?: string;
  paymentMethod?: string;
}

interface ExpenseLike {
  id?: string;
  date?: string;
  amount?: number;
  category?: string;
  description?: string;
}

function monthKey(iso?: string) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function CashFlowReport() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: posTransactions } = useCloudKV<PosTransactionLike[]>(
    "pos_transactions",
    stationId,
    [],
  );
  const { data: expenses } = useCloudKV<ExpenseLike[]>(
    "expenses_data",
    stationId,
    [],
  );

  const months = useMemo(() => {
    const map = new Map<string, { in: number; out: number }>();
    for (const t of posTransactions || []) {
      const k = monthKey(t.date || t.created_at);
      if (!k) continue;
      const row = map.get(k) ?? { in: 0, out: 0 };
      row.in += Number(t.total) || 0;
      map.set(k, row);
    }
    for (const e of expenses || []) {
      const k = monthKey(e.date);
      if (!k) continue;
      const row = map.get(k) ?? { in: 0, out: 0 };
      row.out += Number(e.amount) || 0;
      map.set(k, row);
    }
    return Array.from(map.entries())
      .map(([month, v]) => ({ month, ...v, net: v.in - v.out }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [posTransactions, expenses]);

  const fmt = (n: number) =>
    `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const maxAbs = Math.max(1, ...months.map((m) => Math.max(m.in, m.out)));

  const exportCsv = () => {
    const csv = [
      "Month,Cash In,Cash Out,Net",
      ...months.map((m) => [m.month, m.in, m.out, m.net].join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cash-flow-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Cash flow exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-sky-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Cash Flow (Month-wise)
            </h4>
            <p className="text-xs text-gray-500">
              Cash in (POS takings) vs cash out (expenses) per month (Codelab
              cash-flow report). Computed from real transactions.
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={months.length === 0}
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      {months.length === 0 ? (
        <p className="text-xs text-gray-500">
          No POS transactions or expenses yet — cash flow appears once you
          record sales or expenses.
        </p>
      ) : (
        <div className="space-y-2">
          {months.map((m) => (
            <div
              key={m.month}
              className="rounded border border-gray-200 dark:border-gray-700 p-3"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{m.month}</span>
                <span
                  className={`font-bold ${m.net >= 0 ? "text-emerald-600" : "text-red-600"}`}
                >
                  {m.net >= 0 ? "+" : "−"}
                  {fmt(Math.abs(m.net))}
                </span>
              </div>
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-emerald-600">In</span>
                  <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${(m.in / maxAbs) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 text-right">{fmt(m.in)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-red-600">Out</span>
                  <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-red-500"
                      style={{ width: `${(m.out / maxAbs) * 100}%` }}
                    />
                  </div>
                  <span className="w-24 text-right">{fmt(m.out)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
