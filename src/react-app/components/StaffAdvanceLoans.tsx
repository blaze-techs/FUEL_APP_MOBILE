/* StaffAdvanceLoans — reverse-engineered Codelab FMS staff/HR charge
 * machinery: track salary advances and staff loans per employee, with
 * repayments deducted over time. Reads the payroll employee roster and
 * keeps per-employee loan ledgers. Cloud KV `staff_loans` (station-scoped).
 */
import { HandCoins, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { resolveEmployeeName } from "@/react-app/lib/payslip-security";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

const KEY = "staff_loans";

interface PayrollEmployeeLike {
  id?: string | number;
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  name?: string;
  role?: string;
}

interface LoanEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  principal: number;
  repayments: { id: string; date: string; amount: number }[];
  status: "active" | "settled";
  date: string;
}

function id() {
  return `ln_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function employeeName(e: PayrollEmployeeLike): string {
  return resolveEmployeeName(e);
}

export default function StaffAdvanceLoans() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currency = getCurrencySymbol();

  const { data: employees } = useCloudKV<PayrollEmployeeLike[]>(
    "payroll_employees",
    stationId,
    [],
  );
  const { data: loans, setData: setLoans } = useCloudKV<LoanEntry[]>(
    KEY,
    stationId,
    [],
  );

  const [form, setForm] = useState({ employeeId: "", amount: "" });
  const [repay, setRepay] = useState({ loanId: "", amount: "" });

  const outstanding = useMemo(() => {
    const map = new Map<string, number>();
    for (const loan of loans || []) {
      const paid = loan.repayments.reduce((s, r) => s + r.amount, 0);
      map.set(loan.id, loan.principal - paid);
    }
    return map;
  }, [loans]);

  const totals = useMemo(() => {
    let principal = 0;
    let paid = 0;
    for (const loan of loans || []) {
      principal += loan.principal;
      paid += loan.repayments.reduce((s, r) => s + r.amount, 0);
    }
    return { principal, outstanding: principal - paid };
  }, [loans]);

  const employeeOptions = useMemo(
    () =>
      (employees || []).map((e) => ({
        id: e.employeeId || String(e.id),
        name: employeeName(e),
      })),
    [employees],
  );

  const addLoan = () => {
    const amount = parseFloat(form.amount);
    const emp = employeeOptions.find((e) => e.id === form.employeeId);
    if (!emp) return toastError("Choose the employee.");
    if (!Number.isFinite(amount) || amount <= 0)
      return toastError("Amount must be greater than 0.");
    setLoans([
      {
        id: id(),
        employeeId: emp.id,
        employeeName: emp.name,
        principal: amount,
        repayments: [],
        status: "active",
        date: new Date().toISOString().split("T")[0],
      },
      ...(loans || []),
    ]);
    setForm({ employeeId: "", amount: "" });
    toastSuccess(`Advance of ${currency}${amount} opened for ${emp.name}.`);
  };

  const addRepayment = () => {
    const amount = parseFloat(repay.amount);
    const loan = (loans || []).find((l) => l.id === repay.loanId);
    if (!loan) return toastError("Choose the loan.");
    if (!Number.isFinite(amount) || amount <= 0)
      return toastError("Amount must be greater than 0.");
    setLoans(
      (loans || []).map((l) => {
        if (l.id !== repay.loanId) return l;
        const newPaid = l.repayments.reduce((s, r) => s + r.amount, 0) + amount;
        return {
          ...l,
          repayments: [
            ...l.repayments,
            {
              id: id(),
              date: new Date().toISOString().split("T")[0],
              amount,
            },
          ],
          status: newPaid >= l.principal ? "settled" : "active",
        };
      }),
    );
    setRepay({ loanId: "", amount: "" });
    toastSuccess("Repayment recorded.");
  };

  const fmt = (n: number) =>
    `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="card space-y-4 rounded border">
      <div className="flex items-center gap-2">
        <HandCoins className="w-5 h-5 text-amber-500" />
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white">
            Staff Advances &amp; Loans
          </h4>
          <p className="text-xs text-gray-500">
            Salary advances per employee with repayment tracking (Codelab HR
            charges). Outstanding:{" "}
            <span className="font-semibold text-amber-600">
              {fmt(totals.outstanding)}
            </span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
        <div className="form-group !mb-0 col-span-2 sm:col-span-1">
          <p className="text-xs text-gray-500">Employee</p>
          <select
            value={form.employeeId}
            onChange={(e) =>
              setForm((f) => ({ ...f, employeeId: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="">Select…</option>
            {employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Amount</p>
          <input
            type="number"
            min={0}
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button onClick={addLoan} className="btn btn-primary !p-2 !text-xs">
          <Plus className="w-3 h-3" /> New Advance
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Repay on</p>
          <select
            value={repay.loanId}
            onChange={(e) =>
              setRepay((f) => ({ ...f, loanId: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs !min-h-0 h-8"
          >
            <option value="">Select loan…</option>
            {(loans || [])
              .filter((l) => l.status === "active")
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.employeeName} — {fmt(l.principal)}
                </option>
              ))}
          </select>
        </div>
        <div className="form-group !mb-0">
          <p className="text-xs text-gray-500">Repayment</p>
          <input
            type="number"
            min={0}
            value={repay.amount}
            onChange={(e) =>
              setRepay((f) => ({ ...f, amount: e.target.value }))
            }
            className="px-2 py-1 rounded text-xs"
          />
        </div>
        <button
          onClick={addRepayment}
          className="btn btn-secondary !p-2 !text-xs"
        >
          <Plus className="w-3 h-3" /> Record Repayment
        </button>
      </div>

      <div className="max-h-56 overflow-auto rounded border border-gray-200 dark:border-gray-700">
        {(loans || []).length === 0 ? (
          <p className="p-3 text-xs text-gray-500">No advances recorded.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-left px-2 py-1.5">Employee</th>
                <th className="text-right px-2 py-1.5">Principal</th>
                <th className="text-right px-2 py-1.5">Outstanding</th>
                <th className="text-left px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {(loans || []).map((l) => (
                <tr
                  key={l.id}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="px-2 py-1.5">{l.date}</td>
                  <td className="px-2 py-1.5 font-medium">{l.employeeName}</td>
                  <td className="px-2 py-1.5 text-right">{fmt(l.principal)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">
                    {fmt(Math.max(0, outstanding.get(l.id) ?? l.principal))}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        l.status === "settled"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() =>
                        setLoans((loans || []).filter((x) => x.id !== l.id))
                      }
                      className="text-red-500"
                      aria-label="Delete advance"
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
    </div>
  );
}
