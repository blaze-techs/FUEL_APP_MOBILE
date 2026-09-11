/* CustomerStatement — reverse-engineered Codelab FMS "Statement Generation":
 * produce a period statement for any credit account (opening balance,
 * itemised purchases + payments from credit_transactions, closing balance),
 * exportable as CSV for emailing/printing to the customer. Reads the live
 * credit account + transactions cloud stores — no duplicate entry.
 */
import { Download, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { toastSuccess } from "@/react-app/lib/toast";

interface CreditAccountLike {
  id: string;
  customerName?: string;
  name?: string;
  balance?: number;
  creditLimit?: number;
  phone?: string;
}

interface CreditTransactionLike {
  id: string;
  accountId: string;
  type: "purchase" | "payment" | string;
  amount: number;
  description?: string;
  date?: string;
  createdAt?: string;
}

export default function CustomerStatement() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: accounts } = useCloudKV<CreditAccountLike[]>(
    "credit_accounts",
    stationId,
    [],
  );
  const { data: transactions } = useCloudKV<CreditTransactionLike[]>(
    "credit_transactions",
    stationId,
    [],
  );

  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const account = (accounts || []).find((a) => a.id === accountId);
  const accountName = account
    ? account.customerName || account.name || "Customer"
    : "";

  const statement = useMemo(() => {
    if (!account) return null;
    const txns = (transactions || [])
      .filter((t) => t.accountId === account.id)
      .filter((t) => {
        const d = t.date || t.createdAt || "";
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .sort((a, b) =>
        (a.date || a.createdAt || "").localeCompare(
          b.date || b.createdAt || "",
        ),
      );
    let running = 0;
    const rows = txns.map((t) => {
      const delta = t.type === "purchase" ? t.amount : -t.amount;
      running += delta;
      return { ...t, delta, balance: running };
    });
    const purchases = txns
      .filter((t) => t.type === "purchase")
      .reduce((s, t) => s + t.amount, 0);
    const payments = txns
      .filter((t) => t.type === "payment")
      .reduce((s, t) => s + t.amount, 0);
    return { rows, purchases, payments, closing: running };
  }, [account, transactions, from, to]);

  const fmt = (n: number) =>
    `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const exportCsv = () => {
    if (!account || !statement) return;
    const csv = [
      [`Statement for ${accountName}`],
      [`Period: ${from || "all time"} → ${to || "today"}`],
      [],
      ["Date", "Type", "Description", "Amount", "Running Balance"],
      ...statement.rows.map((r) => [
        r.date || r.createdAt || "",
        r.type,
        r.description || "",
        r.delta,
        r.balance,
      ]),
      [],
      ["Purchases", "", "", statement.purchases, ""],
      ["Payments", "", "", -statement.payments, ""],
      ["Closing Balance", "", "", "", statement.closing],
    ]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `statement-${accountName.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toastSuccess("Statement exported.");
  };

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <FileText className="w-5 h-5 text-indigo-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Customer Statement
          </h4>
          <p className="text-xs text-gray-500">
            Period statement for any credit account (Codelab statement
            generation). Itemised purchases/payments with running balance.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Account</p>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="">Select account…</option>
            {(accounts || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.customerName || a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">From</p>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">To</p>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-primary !p-2 !text-xs"
          disabled={!statement || statement.rows.length === 0}
        >
          <Download className="w-3 h-3" /> Export Statement
        </button>
      </div>

      {account && statement && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
              <p className="text-xs text-gray-500">Purchases</p>
              <p className="font-bold text-red-600">
                {fmt(statement.purchases)}
              </p>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
              <p className="text-xs text-gray-500">Payments</p>
              <p className="font-bold text-emerald-600">
                {fmt(statement.payments)}
              </p>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
              <p className="text-xs text-gray-500">Closing balance</p>
              <p className="font-bold">{fmt(statement.closing)}</p>
            </div>
          </div>
          <div className="max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700">
            {statement.rows.length === 0 ? (
              <p className="p-3 text-xs text-gray-500">
                No transactions in this period.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5">Date</th>
                    <th className="text-left px-2 py-1.5">Type</th>
                    <th className="text-left px-2 py-1.5">Description</th>
                    <th className="text-right px-2 py-1.5">Amount</th>
                    <th className="text-right px-2 py-1.5">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-gray-100 dark:border-gray-800"
                    >
                      <td className="px-2 py-1.5">{r.date || r.createdAt}</td>
                      <td className="px-2 py-1.5 capitalize">{r.type}</td>
                      <td className="px-2 py-1.5 max-w-[220px] truncate">
                        {r.description || "—"}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right ${r.delta >= 0 ? "text-red-600" : "text-emerald-600"}`}
                      >
                        {r.delta >= 0 ? "+" : "−"}
                        {fmt(Math.abs(r.delta))}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold">
                        {fmt(r.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
