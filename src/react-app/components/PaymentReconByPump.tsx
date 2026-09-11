/* PaymentReconByPump — reverse-engineered Pesapal PFMS "link every
 * transaction to the right pump and attendant" + Codelab "Salesman wise
 * Day Book": reconciles each POS sale against the pump + attendant it was
 * recorded under so the owner sees per-pump/per-attendant cash, M-Pesa and
 * card splits for the day. Reads the shared `pos_transactions` cloud store
 * (no manual entry); attribution comes from the transaction's pump /
 * cashier fields where present.
 */
import { Download, Link2 } from "lucide-react";
import { useMemo } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess } from "@/react-app/lib/toast";

interface PosTransactionLike {
  id?: string;
  invoice?: string;
  date?: string;
  created_at?: string;
  total?: number;
  payment?: string;
  paymentMethod?: string;
  pump?: string;
  pumpId?: string;
  nozzle?: string;
  cashier?: string;
  attendant?: string;
  customer?: string;
}

function normMethod(t: PosTransactionLike): string {
  const raw = (t.payment || t.paymentMethod || "").toLowerCase();
  if (raw.includes("mpesa") || raw.includes("m-pesa")) return "M-Pesa";
  if (raw.includes("card") || raw.includes("bank")) return "Card/Bank";
  if (raw.includes("credit") || raw.includes("debt")) return "Credit";
  return "Cash";
}

export default function PaymentReconByPump() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: transactions } = useCloudKV<PosTransactionLike[]>(
    "pos_transactions",
    stationId,
    [],
  );

  const rows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        pump: string;
        attendant: string;
        cash: number;
        mpesa: number;
        card: number;
        credit: number;
        count: number;
      }
    >();
    for (const t of transactions || []) {
      const pump = t.pump || t.pumpId || t.nozzle || "Unassigned pump";
      const attendant = t.attendant || t.cashier || "Unassigned attendant";
      const key = `${pump}::${attendant}`;
      const row = map.get(key) ?? {
        key,
        pump,
        attendant,
        cash: 0,
        mpesa: 0,
        card: 0,
        credit: 0,
        count: 0,
      };
      const method = normMethod(t);
      const total = Number(t.total) || 0;
      if (method === "Cash") row.cash += total;
      else if (method === "M-Pesa") row.mpesa += total;
      else if (method === "Card/Bank") row.card += total;
      else row.credit += total;
      row.count += 1;
      map.set(key, row);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        b.cash +
        b.mpesa +
        b.card +
        b.credit -
        (a.cash + a.mpesa + a.card + a.credit),
    );
  }, [transactions]);

  const fmt = (n: number) =>
    `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportCsv = () => {
    const csv = [
      "Pump,Attendant,Cash,M-Pesa,Card/Bank,Credit,Transactions",
      ...rows.map((r) =>
        [r.pump, r.attendant, r.cash, r.mpesa, r.card, r.credit, r.count].join(
          ",",
        ),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payment-reconciliation-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Reconciliation exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-emerald-500" />
          <div>
            <h4 className="font-bold text-gray-900 dark:text-white">
              Payment Reconciliation by Pump &amp; Attendant
            </h4>
            <p className="text-xs text-gray-500">
              Every transaction linked to its pump and attendant (Pesapal PFMS
              reconciliation / Codelab salesman-wise day book). Computed from
              POS transactions.
            </p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-secondary !p-2 !text-xs"
          disabled={rows.length === 0}
        >
          <Download className="w-3 h-3" /> Export
        </button>
      </div>

      <div className="max-h-72 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {rows.length === 0 ? (
          <p className="p-3 text-xs text-gray-500">
            No POS transactions yet — reconciliation appears after the first
            sale.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Pump</th>
                <th className="text-left px-2 py-1.5">Attendant</th>
                <th className="text-right px-2 py-1.5">Cash</th>
                <th className="text-right px-2 py-1.5">M-Pesa</th>
                <th className="text-right px-2 py-1.5">Card/Bank</th>
                <th className="text-right px-2 py-1.5">Credit</th>
                <th className="text-right px-2 py-1.5">Txns</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5 font-medium">{r.pump}</td>
                  <td className="px-2 py-1.5">{r.attendant}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.cash)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.mpesa)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.card)}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(r.credit)}</td>
                  <td className="px-2 py-1.5 text-right">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
