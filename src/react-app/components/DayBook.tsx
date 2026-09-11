import { useMemo, useState } from "react";
import {
  BookOpen,
  Download,
  CheckCircle,
  AlertTriangle,
  Wallet,
  CreditCard,
  Banknote,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  CLOUD_KEYS,
  downloadCsv,
  type DayBookEntry,
} from "@/react-app/lib/forecourt-features";

/**
 * DayBook — daily cash reconciliation (Codelab FMS "Day Book" concept).
 * Aggregates the real data for a chosen date across both shifts from
 * FuelContext.salesHistory: pump sales, POS sales, till/M-Pesa totals,
 * expenses — computes expected cash in hand, then compares against the
 * physical banked deposit recorded by the user. Nothing is fabricated;
 * every figure comes from the station's own saved records.
 */
export default function DayBook() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = useMemo(
    () =>
      resolveCurrencySymbol(
        state.companyData?.currency,
        currentStation?.currency,
      ),
    [state.companyData?.currency, currentStation?.currency],
  );

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const { data: entries, setData: setEntries } = useCloudKV<
    Record<string, DayBookEntry>
  >(CLOUD_KEYS.daybook, stationId, {});
  // POS transactions (fuel + shop items, with per-payment-method split) —
  // the same cloud key PointOfSale writes. Read directly so the day book
  // reconciles the POS channel even when no Sales Tracking shift was saved.
  const { data: posTxns } = useCloudKV<any[]>(
    "pos_transactions",
    stationId,
    [],
  );

  const [depositInput, setDepositInput] = useState("");
  const [notesInput, setNotesInput] = useState("");

  // Aggregate all sales-history entries for the chosen date (both shifts)
  // PLUS POS transactions for the same date (payment-method-aware).
  const totals = useMemo(() => {
    let revenue = 0;
    let till = 0;
    let expensesTotal = 0;
    const entriesForDate = Object.values(state.salesHistory || {}).filter(
      (e: any) => e?.date === date,
    ) as any[];
    for (const e of entriesForDate) {
      const fuelRevenue = Object.values(e.fuelPumpsByType || {}).reduce(
        (sum: number, pumps: any) =>
          sum +
          (pumps as any[]).reduce(
            (s: number, p: any) => s + (p?.salesKsh || 0),
            0,
          ),
        0,
      ) as number;
      revenue += Number.isFinite(fuelRevenue) ? (fuelRevenue as number) : 0;
      till += e.tillPayment || 0;
      expensesTotal += (e.expenses || []).reduce(
        (sum: number, ex: any) => sum + (ex?.amount || 0),
        0,
      );
    }
    // POS sales for the date, split by payment method. pos_transactions is
    // the authoritative record (salesHistory.posSales is only a fuel-only
    // mirror and is intentionally NOT added here to avoid double counting).
    // NOTE: POS M-Pesa *fuel* sales are already mirrored into
    // salesHistory.tillPayment by PointOfSale.syncFuelSalesToHistory, so only
    // the non-fuel portion of POS M-Pesa is added to till here.
    let posCash = 0;
    let posMpesa = 0;
    let posCardBank = 0;
    let posMpesaNonFuel = 0;
    const posForDate = (Array.isArray(posTxns) ? posTxns : []).filter(
      (t: any) =>
        typeof t?.timestamp === "string" && t.timestamp.startsWith(date),
    );
    for (const t of posForDate) {
      const amt = Number.isFinite(t?.total) ? t.total : 0;
      const fuelAmt = (Array.isArray(t?.items) ? t.items : []).reduce(
        (s: number, i: any) => s + (i?.fuelType ? i?.total || 0 : 0),
        0,
      );
      const nonFuelAmt = Math.max(0, amt - fuelAmt);
      if (t?.paymentMethod === "mpesa") {
        posMpesa += amt;
        posMpesaNonFuel += nonFuelAmt;
      } else if (t?.paymentMethod === "card" || t?.paymentMethod === "bank")
        posCardBank += amt;
      else posCash += amt;
    }
    till += posMpesaNonFuel;
    // Physical cash expected = fuel sales cash portion + POS cash - expenses.
    // Card/bank settle straight to the bank, so they are excluded from the
    // cash-in-hand expectation (shown separately).
    const expectedCash = Math.max(
      0,
      revenue - (till - posMpesaNonFuel) + posCash - expensesTotal,
    );
    return {
      revenue,
      till,
      expensesTotal,
      posCash,
      posMpesa,
      posCardBank,
      posCount: posForDate.length,
      expectedCash,
      count: entriesForDate.length,
    };
  }, [state.salesHistory, posTxns, date]);

  const recorded = entries[date];

  const handleSaveDeposit = () => {
    const deposit = parseFloat(depositInput);
    if (!Number.isFinite(deposit) || deposit < 0) {
      toastError("Enter a valid banked deposit amount.");
      return;
    }
    setEntries((prev) => ({
      ...prev,
      [date]: { date, depositAmount: deposit, notes: notesInput || undefined },
    }));
    setDepositInput("");
    setNotesInput("");
    toastSuccess(`Day Book updated for ${date}.`);
  };

  const variance = recorded
    ? totals.expectedCash - recorded.depositAmount
    : null;

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      [
        "date",
        "pump_revenue",
        "pos_cash",
        "till/mpesa",
        "card/bank",
        "expenses",
        "expected_cash",
        "deposited",
        "variance",
        "notes",
      ],
      [
        date,
        totals.revenue.toFixed(2),
        totals.posCash.toFixed(2),
        totals.till.toFixed(2),
        totals.posCardBank.toFixed(2),
        totals.expensesTotal.toFixed(2),
        totals.expectedCash.toFixed(2),
        recorded ? recorded.depositAmount.toFixed(2) : "",
        variance != null ? variance.toFixed(2) : "",
        recorded?.notes || "",
      ],
      ...Object.values(entries)
        .filter((e: DayBookEntry) => e.date !== date)
        .map((e: DayBookEntry) => {
          return [
            e.date,
            "",
            "",
            "",
            "",
            "",
            "",
            e.depositAmount,
            "",
            e.notes || "",
          ] as (string | number | null)[];
        }),
    ];
    downloadCsv(`daybook-${date}.csv`, rows);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <BookOpen className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
          Day Book — Cash Reconciliation
        </h3>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
          aria-label="Pick date"
        />
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200"
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </div>

      {totals.count === 0 && totals.posCount === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No sales records for {date}. Save a shift in Sales Tracking or
          complete a sale in Point of Sale first.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard
            icon={<Banknote className="w-4 h-4 text-amber-500" />}
            label="Pump Revenue"
            value={`${currencySymbol} ${formatNumber(totals.revenue, 2)}`}
          />
          <StatCard
            icon={<Banknote className="w-4 h-4 text-emerald-500" />}
            label={`POS Cash (${totals.posCount} sale${totals.posCount === 1 ? "" : "s"})`}
            value={`${currencySymbol} ${formatNumber(totals.posCash, 2)}`}
          />
          <StatCard
            icon={<CreditCard className="w-4 h-4 text-sky-500" />}
            label="Till / M-Pesa"
            value={`${currencySymbol} ${formatNumber(totals.till, 2)}`}
          />
          <StatCard
            icon={<CreditCard className="w-4 h-4 text-violet-500" />}
            label="Card / Bank"
            value={`${currencySymbol} ${formatNumber(totals.posCardBank, 2)}`}
          />
          <StatCard
            icon={<Wallet className="w-4 h-4 text-rose-500" />}
            label="Expenses"
            value={`${currencySymbol} ${formatNumber(totals.expensesTotal, 2)}`}
          />
          <StatCard
            icon={<Banknote className="w-4 h-4 text-green-500" />}
            label="Expected Cash"
            value={`${currencySymbol} ${formatNumber(totals.expectedCash, 2)}`}
            highlight
          />
        </div>
      )}

      {/* Deposit & variance */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Banked deposit ({currencySymbol})
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={depositInput}
              onChange={(e) => setDepositInput(e.target.value)}
              placeholder={
                recorded
                  ? `Recorded: ${formatNumber(recorded.depositAmount, 2)}`
                  : "Physical cash banked"
              }
              className="mt-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white w-56"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Notes
            </label>
            <input
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="e.g. deposited to Equity Bank"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>
          <button
            onClick={handleSaveDeposit}
            className="px-4 py-2 rounded-lg bg-amber-500 text-gray-900 text-sm font-semibold hover:bg-amber-400"
          >
            Save
          </button>
        </div>
        {recorded && variance != null && (
          <div
            className={`flex items-center gap-2 text-sm ${Math.abs(variance) < 1 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}
          >
            {Math.abs(variance) < 1 ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            Reconciliation for {date}:{" "}
            {Math.abs(variance) < 1
              ? "balanced ✓"
              : `variance ${currencySymbol} ${formatNumber(variance, 2)} (${
                  variance > 0 ? "short" : "over"
                })`}
          </div>
        )}
        {recorded?.notes && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Notes: {recorded.notes}
          </p>
        )}
      </div>

      {/* Recent day book entries */}
      {Object.keys(entries).length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <h4 className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700">
            Recorded Deposits
          </h4>
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50 max-h-64 overflow-y-auto">
            {Object.values(entries)
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 30)
              .map((e) => (
                <div
                  key={e.date}
                  className="px-4 py-2 flex items-center gap-4 text-sm"
                >
                  <span className="font-medium text-gray-900 dark:text-white w-28">
                    {e.date}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300">
                    {currencySymbol} {formatNumber(e.depositAmount, 2)}
                  </span>
                  {e.notes && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {e.notes}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${highlight ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"}`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </span>
      </div>
      <div className="mt-1.5 text-base font-bold text-gray-900 dark:text-white">
        {value}
      </div>
    </div>
  );
}
