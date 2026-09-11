/* BankLedger — reverse-engineered Codelab FMS financial accounts. Codelab's
 * site lists "Ledger Account, Cash Account & Bank Account, Bank
 * Reconciliation" as a headline capability. Reports Center already has
 * Day Book (expected cash) and Loss Control, but there was no place in the
 * app to register bank/cash accounts and reconcile deposits. This ledger
 * keeps account balances and matches Day Book banked deposits as
 * "matched" entries (importable with one click), leaving the day's
 * unreconciled takings visible — exactly Codelab's bank-reconciliation view.
 * Cloud KV `bank_ledger_accounts` + `bank_ledger_entries` (station-scoped).
 */
import { Landmark, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import {
  CLOUD_KEYS,
  type DayBookEntry,
} from "@/react-app/lib/forecourt-features";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const ACCOUNTS_KEY = "bank_ledger_accounts";
const ENTRIES_KEY = "bank_ledger_entries";

type AccountType = "cash" | "bank";

interface LedgerAccount {
  id: string;
  name: string;
  type: AccountType;
  openingBalance: number;
}

interface LedgerEntry {
  id: string;
  accountId: string;
  date: string;
  direction: "in" | "out";
  amount: number;
  reference: string;
  note: string;
  status: "matched" | "unmatched";
}

function id() {
  return `led_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export default function BankLedger() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const { data: accounts, setData: setAccounts } = useCloudKV<LedgerAccount[]>(
    ACCOUNTS_KEY,
    stationId,
    [],
  );
  const { data: entries, setData: setEntries } = useCloudKV<LedgerEntry[]>(
    ENTRIES_KEY,
    stationId,
    [],
  );
  const { data: daybook } = useCloudKV<DayBookEntry[]>(
    CLOUD_KEYS.daybook,
    stationId,
    [],
  );

  const [accountForm, setAccountForm] = useState({
    name: "",
    type: "bank" as AccountType,
    openingBalance: "",
  });
  const [accountId, setAccountId] = useState<string>("");
  const [entryForm, setEntryForm] = useState({
    direction: "in" as "in" | "out",
    amount: "",
    reference: "",
    note: "",
  });

  /* ---------------- Accounts ---------------- */
  const addAccount = () => {
    const name = accountForm.name.trim();
    const opening = parseFloat(accountForm.openingBalance || "0");
    if (!name) {
      toastError("Account name is required.");
      return;
    }
    const account: LedgerAccount = {
      id: id(),
      name,
      type: accountForm.type,
      openingBalance: Number.isFinite(opening) ? opening : 0,
    };
    setAccounts([...(accounts || []), account]);
    setAccountForm({ name: "", type: accountForm.type, openingBalance: "" });
    if (!accountId) setAccountId(account.id);
    toastSuccess(`Account "${name}" added.`);
  };

  const removeAccount = (account: LedgerAccount) => {
    if (
      !window.confirm(`Delete account "${account.name}" and all its entries?`)
    )
      return;
    setAccounts((accounts || []).filter((a) => a.id !== account.id));
    setEntries((entries || []).filter((e) => e.accountId !== account.id));
    if (accountId === account.id) setAccountId("");
    toastSuccess(`Account "${account.name}" removed.`);
  };

  /* ---------------- Entries ---------------- */
  const selectedAccount = (accounts || []).find((a) => a.id === accountId);

  const addEntry = (extra?: Partial<LedgerEntry>) => {
    if (!selectedAccount) {
      toastError("Create an account first.");
      return;
    }
    const amount = parseFloat(extra?.amount?.toString() ?? entryForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toastError("Amount must be greater than 0.");
      return;
    }
    const entry: LedgerEntry = {
      id: id(),
      accountId: selectedAccount.id,
      date: extra?.date ?? new Date().toISOString().split("T")[0],
      direction: extra?.direction ?? entryForm.direction,
      amount,
      reference: extra?.reference ?? entryForm.reference.trim(),
      note: extra?.note ?? entryForm.note.trim(),
      status: extra?.status ?? "unmatched",
    };
    setEntries([entry, ...(entries || [])]);
    setEntryForm({ direction: "in", amount: "", reference: "", note: "" });
    toastSuccess("Entry recorded.");
  };

  /** Import today's Day Book banked deposits as matched cash-in entries */
  const importDayBook = () => {
    if (!selectedAccount) {
      toastError("Create/select an account first.");
      return;
    }
    const dayEntries = (daybook || []).filter((d) => d.depositAmount > 0);
    if (dayEntries.length === 0) {
      toastError("Day Book has no banked deposits to import.");
      return;
    }
    const newEntries: LedgerEntry[] = dayEntries.map((d) => ({
      id: id(),
      accountId: selectedAccount.id,
      date: d.date,
      direction: "in",
      amount: d.depositAmount,
      reference: `Day Book ${d.date}`,
      note: d.notes ?? "",
      status: "matched",
    }));
    /* de-duplicate by reference */
    const existing = new Set(
      (entries || [])
        .filter((e) => e.accountId === selectedAccount.id)
        .map((e) => e.reference),
    );
    const toAdd = newEntries.filter((n) => !existing.has(n.reference));
    if (toAdd.length === 0) {
      toastError("All Day Book deposits are already imported.");
      return;
    }
    setEntries([...toAdd, ...(entries || [])]);
    toastSuccess(`${toAdd.length} deposit(s) imported as matched.`);
  };

  const removeEntry = (entry: LedgerEntry) => {
    setEntries((entries || []).filter((e) => e.id !== entry.id));
    toastSuccess("Entry removed.");
  };

  const markMatched = (entry: LedgerEntry) => {
    setEntries(
      (entries || []).map((e) =>
        e.id === entry.id ? { ...e, status: "matched" as const } : e,
      ),
    );
    toastSuccess("Marked as matched.");
  };

  /* ---------------- Computed balance ---------------- */
  const balance = useMemo(() => {
    if (!selectedAccount) return null;
    let delta = selectedAccount.openingBalance;
    for (const e of entries || []) {
      if (e.accountId !== selectedAccount.id) continue;
      delta += e.direction === "in" ? e.amount : -e.amount;
    }
    return delta;
  }, [entries, selectedAccount]);

  const accountEntries = (entries || []).filter(
    (e) => e.accountId === accountId,
  );
  const unmatchedCount = accountEntries.filter(
    (e) => e.status === "unmatched",
  ).length;

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-start gap-2">
        <Landmark className="w-5 h-5 text-sky-500 mt-0.5" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Bank &amp; Cash Ledger
          </h4>
          <p className="text-xs text-gray-500">
            Register cash/bank accounts and reconcile deposits (Codelab FMS
            financial accounts). One click imports Day Book banked deposits as
            matched entries.
          </p>
        </div>
      </div>

      {/* Accounts register */}
      <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Accounts
        </p>
        <div className="flex flex-wrap gap-2">
          {(accounts || []).map((a) => (
            <button
              key={a.id}
              onClick={() => setAccountId(a.id)}
              className={`group flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${
                a.id === accountId
                  ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              <span>
                {a.name}
                <span className="ml-1 text-gray-500">({a.type})</span>
              </span>
              <Trash2
                className="w-3 h-3 opacity-70 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAccount(a);
                }}
              />
            </button>
          ))}
          {(accounts || []).length === 0 && (
            <p className="text-xs text-gray-500">No accounts yet.</p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="form-group !mb-0">
            <p className="text-xs text-gray-500">Name</p>
            <input
              value={accountForm.name}
              onChange={(e) =>
                setAccountForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="e.g. M-Pesa Till, Equity Bank"
              className="px-2 py-1 rounded text-xs"
            />
          </div>
          <div className="form-group !mb-0">
            <p className="text-xs text-gray-500">Type</p>
            <select
              value={accountForm.type}
              onChange={(e) =>
                setAccountForm((f) => ({
                  ...f,
                  type: e.target.value as AccountType,
                }))
              }
              className="px-2 py-1 rounded text-xs !min-h-0 h-8"
            >
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <div className="form-group !mb-0">
            <p className="text-xs text-gray-500">Opening balance</p>
            <input
              type="number"
              value={accountForm.openingBalance}
              onChange={(e) =>
                setAccountForm((f) => ({
                  ...f,
                  openingBalance: e.target.value,
                }))
              }
              placeholder="0"
              className="px-2 py-1 rounded text-xs w-28"
            />
          </div>
          <button
            onClick={addAccount}
            className="btn btn-secondary !p-2 !text-xs"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
      </div>

      {/* Ledger body */}
      {selectedAccount && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Book balance:{" "}
              <span className="font-semibold">
                {(balance ?? 0).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>{" "}
              <span className="text-gray-500">
                — {unmatchedCount} unmatched entr
                {unmatchedCount === 1 ? "y" : "ies"}
              </span>
            </p>
            <button
              onClick={importDayBook}
              className="btn btn-secondary !p-2 !text-xs"
            >
              Import Day Book deposits
            </button>
          </div>

          {/* Entry form */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
            <div className="form-group !mb-0">
              <p className="text-xs text-gray-500">Direction</p>
              <select
                value={entryForm.direction}
                onChange={(e) =>
                  setEntryForm((f) => ({
                    ...f,
                    direction: e.target.value as "in" | "out",
                  }))
                }
                className="px-2 py-1 rounded text-xs !min-h-0 h-8"
              >
                <option value="in">In</option>
                <option value="out">Out</option>
              </select>
            </div>
            <div className="form-group !mb-0">
              <p className="text-xs text-gray-500">Amount</p>
              <input
                type="number"
                min={0}
                value={entryForm.amount}
                onChange={(e) =>
                  setEntryForm((f) => ({ ...f, amount: e.target.value }))
                }
                className="px-2 py-1 rounded text-xs"
              />
            </div>
            <div className="form-group !mb-0">
              <p className="text-xs text-gray-500">Reference</p>
              <input
                value={entryForm.reference}
                onChange={(e) =>
                  setEntryForm((f) => ({ ...f, reference: e.target.value }))
                }
                placeholder="e.g. Cheque #, Day Book 2026-09-01"
                className="px-2 py-1 rounded text-xs"
              />
            </div>
            <div className="form-group !mb-0 col-span-2 sm:col-span-1">
              <p className="text-xs text-gray-500">Note</p>
              <input
                value={entryForm.note}
                onChange={(e) =>
                  setEntryForm((f) => ({ ...f, note: e.target.value }))
                }
                className="px-2 py-1 rounded text-xs"
              />
            </div>
            <button
              onClick={() => addEntry()}
              className="btn btn-primary !p-2 !text-xs"
            >
              <Plus className="w-3 h-3" /> Record
            </button>
          </div>

          {/* Entries list */}
          <div className="max-h-64 overflow-auto rounded border border-gray-200 dark:border-gray-700">
            {accountEntries.length === 0 ? (
              <p className="p-3 text-xs text-gray-500">
                No entries yet. Record an entry or import from Day Book.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5">Date</th>
                    <th className="text-left px-2 py-1.5">Reference</th>
                    <th className="text-left px-2 py-1.5">Note</th>
                    <th className="text-right px-2 py-1.5">In</th>
                    <th className="text-right px-2 py-1.5">Out</th>
                    <th className="text-right px-2 py-1.5">Match</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {accountEntries.map((e) => (
                    <tr
                      key={e.id}
                      className={`border-t border-gray-100 dark:border-gray-800 ${
                        e.status === "unmatched"
                          ? "bg-amber-50/50 dark:bg-amber-900/10"
                          : ""
                      }`}
                    >
                      <td className="px-2 py-1.5">{e.date}</td>
                      <td className="px-2 py-1.5">
                        {e.reference || (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 max-w-[220px] truncate">
                        {e.note || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        {e.direction === "in"
                          ? e.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        {e.direction === "out"
                          ? e.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {e.status === "matched" ? (
                          <span className="text-emerald-600 font-semibold">
                            matched
                          </span>
                        ) : (
                          <button
                            onClick={() => markMatched(e)}
                            className="text-amber-600 font-semibold hover:underline"
                          >
                            match
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => removeEntry(e)}
                          className="text-red-500 hover:text-red-600"
                          aria-label="Remove entry"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
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
