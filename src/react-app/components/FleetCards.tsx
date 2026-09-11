import { useMemo, useState } from "react";
import {
  CreditCard,
  Plus,
  Trash2,
  Download,
  Fuel,
  AlertTriangle,
  Ban,
  CheckCircle,
  Truck,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { getFuelLabel } from "@/react-app/config/pricing";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { toastSuccess, toastError } from "@/react-app/lib/toast";
import {
  CLOUD_KEYS,
  downloadCsv,
  type FleetCard,
  type FleetUsage,
} from "@/react-app/lib/forecourt-features";

interface CreditAccountLite {
  id: string | number;
  customerName: string;
  balance?: number;
  balanceUsed?: number;
}

/**
 * FleetCards — fleet & corporate fuel card management
 * (Shell Fleet Solutions card controls + Pesapal fleet/corporate fuel
 * management). Each card links to a real credit/corporate account and
 * carries product/volume limits, pre/post-paid mode and usage tracking.
 * Usage is recorded against the card and checked against its limits —
 * no fabricated data.
 */
export default function FleetCards({
  accounts,
}: {
  accounts: CreditAccountLite[];
}) {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const fuelTypeApi = useStationFuelTypes();
  const currencySymbol = useMemo(
    () =>
      resolveCurrencySymbol(
        state.companyData?.currency,
        currentStation?.currency,
      ),
    [state.companyData?.currency, currentStation?.currency],
  );

  const { data: cards, setData: setCards } = useCloudKV<FleetCard[]>(
    CLOUD_KEYS.fleetCards,
    stationId,
    [],
  );
  const { data: usage, setData: setUsage } = useCloudKV<FleetUsage[]>(
    CLOUD_KEYS.fleetUsage,
    stationId,
    [],
  );

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    accountName: "",
    cardNumber: "",
    plate: "",
    driver: "",
    fuelProduct: "",
    txnLimitLitres: "",
    dailyLimitAmount: "",
    prepaid: false,
    balance: "",
  });
  const [usageForm, setUsageForm] = useState({
    cardId: "",
    amount: "",
    litres: "",
    fuelType: "",
  });

  const usageByCard = useMemo(() => {
    const m = new Map<
      string,
      { today: number; total: number; count: number }
    >();
    for (const u of usage) {
      const rec = m.get(u.cardId) || { today: 0, total: 0, count: 0 };
      rec.total += u.amount;
      rec.count += 1;
      if (u.date.slice(0, 10) === today) rec.today += u.amount;
      m.set(u.cardId, rec);
    }
    return m;
  }, [usage, today]);

  const handleAddCard = () => {
    if (!form.cardNumber.trim() || !form.plate.trim()) {
      toastError("Card number and vehicle plate are required.");
      return;
    }
    const card: FleetCard = {
      id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      accountName: form.accountName || "Unassigned",
      cardNumber: form.cardNumber.trim(),
      plate: form.plate.trim(),
      driver: form.driver.trim(),
      fuelProduct: form.fuelProduct,
      txnLimitLitres: parseFloat(form.txnLimitLitres) || 0,
      dailyLimitAmount: parseFloat(form.dailyLimitAmount) || 0,
      prepaid: form.prepaid,
      balance: parseFloat(form.balance) || 0,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    setCards((prev) => [card, ...prev]);
    setForm({
      accountName: "",
      cardNumber: "",
      plate: "",
      driver: "",
      fuelProduct: "",
      txnLimitLitres: "",
      dailyLimitAmount: "",
      prepaid: false,
      balance: "",
    });
    toastSuccess(`Fleet card ${card.cardNumber} added.`);
  };

  const handleRecordUsage = () => {
    const card = cards.find((c) => c.id === usageForm.cardId);
    if (!card) {
      toastError("Pick a card first.");
      return;
    }
    const amount = parseFloat(usageForm.amount);
    const litres = parseFloat(usageForm.litres) || 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      toastError("Enter a valid usage amount.");
      return;
    }
    if (card.status !== "active") {
      toastError(`Card ${card.cardNumber} is ${card.status} — blocked.`);
      return;
    }
    if (card.txnLimitLitres > 0 && litres > card.txnLimitLitres) {
      toastError(
        `Exceeds per-transaction limit (${card.txnLimitLitres} L) for this card.`,
      );
      return;
    }
    const todayUsed = usageByCard.get(card.id)?.today ?? 0;
    if (
      card.dailyLimitAmount > 0 &&
      todayUsed + amount > card.dailyLimitAmount
    ) {
      toastError(
        `Would exceed daily limit (${currencySymbol} ${formatNumber(card.dailyLimitAmount, 2)}).`,
      );
      return;
    }
    if (card.prepaid && amount > card.balance) {
      toastError(
        `Prepaid balance insufficient (${currencySymbol} ${formatNumber(card.balance, 2)} left).`,
      );
      return;
    }
    const entry: FleetUsage = {
      id: `fu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      cardId: card.id,
      date: new Date().toISOString(),
      amount,
      litres,
      fuelType: usageForm.fuelType || card.fuelProduct || "Unspecified",
    };
    setUsage((prev) => [entry, ...prev].slice(0, 1000));
    if (card.prepaid) {
      setCards((prev) =>
        prev.map((c) =>
          c.id === card.id ? { ...c, balance: c.balance - amount } : c,
        ),
      );
    }
    setUsageForm({ cardId: "", amount: "", litres: "", fuelType: "" });
    toastSuccess(`Usage recorded on ${card.plate} (${card.cardNumber}).`);
  };

  const toggleStatus = (id: string) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, status: c.status === "active" ? "suspended" : "active" }
          : c,
      ),
    );
  };

  const handleDelete = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setUsage((prev) => prev.filter((u) => u.cardId !== id));
    toastSuccess("Card deleted with its usage history.");
  };

  const exportCsv = () => {
    downloadCsv(`fleet-cards-${today}.csv`, [
      [
        "Card",
        "Plate",
        "Driver",
        "Account",
        "Fuel",
        "Txn Limit L",
        "Daily Limit",
        "Mode",
        "Balance",
        "Status",
      ],
      ...cards.map((c) => [
        c.cardNumber,
        c.plate,
        c.driver,
        c.accountName,
        c.fuelProduct || "All",
        c.txnLimitLitres,
        c.dailyLimitAmount,
        c.prepaid ? "Prepaid" : "Postpaid",
        c.prepaid ? c.balance : "",
        c.status,
      ]),
      [],
      ["Card", "Date", "Amount", "Litres", "Fuel"],
      ...usage.map((u) => [u.cardId, u.date, u.amount, u.litres, u.fuelType]),
    ]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-amber-500" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            Fleet & Fuel Cards
          </h3>
        </div>
        <button
          onClick={exportCsv}
          disabled={cards.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-200 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </div>

      {/* Add card form */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          Issue New Card
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input
            value={form.cardNumber}
            onChange={(e) =>
              setForm((f) => ({ ...f, cardNumber: e.target.value }))
            }
            placeholder="Card number *"
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <input
            value={form.plate}
            onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))}
            placeholder="Vehicle plate *"
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <input
            value={form.driver}
            onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value }))}
            placeholder="Driver"
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <select
            value={form.accountName}
            onChange={(e) =>
              setForm((f) => ({ ...f, accountName: e.target.value }))
            }
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            aria-label="Corporate account"
          >
            <option value="">Account (optional)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.customerName}>
                {a.customerName}
              </option>
            ))}
          </select>
          <select
            value={form.fuelProduct}
            onChange={(e) =>
              setForm((f) => ({ ...f, fuelProduct: e.target.value }))
            }
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            aria-label="Fuel restriction"
          >
            <option value="">All fuels</option>
            {fuelTypeApi.activeFuelTypes.map((ft) => (
              <option key={ft.name} value={ft.name}>
                {getFuelLabel(ft.name)} only
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={form.txnLimitLitres}
            onChange={(e) =>
              setForm((f) => ({ ...f, txnLimitLitres: e.target.value }))
            }
            placeholder="Per-Txn limit (L)"
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <input
            type="number"
            min={0}
            value={form.dailyLimitAmount}
            onChange={(e) =>
              setForm((f) => ({ ...f, dailyLimitAmount: e.target.value }))
            }
            placeholder={`Daily limit (${currencySymbol})`}
            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.prepaid}
              onChange={(e) =>
                setForm((f) => ({ ...f, prepaid: e.target.checked }))
              }
            />
            Prepaid
          </label>
          {form.prepaid && (
            <input
              type="number"
              min={0}
              value={form.balance}
              onChange={(e) =>
                setForm((f) => ({ ...f, balance: e.target.value }))
              }
              placeholder="Prepaid balance"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
          )}
          <button
            onClick={handleAddCard}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-gray-900 text-sm font-semibold hover:bg-amber-400"
          >
            <Plus className="w-4 h-4" /> Issue Card
          </button>
        </div>
      </div>

      {/* Cards list */}
      {cards.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No fleet cards yet. Issue your first card above.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c) => {
            const use = usageByCard.get(c.id);
            const pct =
              c.dailyLimitAmount > 0
                ? Math.min(100, ((use?.today ?? 0) / c.dailyLimitAmount) * 100)
                : 0;
            const over =
              c.dailyLimitAmount > 0 && (use?.today ?? 0) > c.dailyLimitAmount;
            return (
              <div
                key={c.id}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-amber-500" />
                    <span className="font-mono font-semibold text-gray-900 dark:text-white">
                      {c.cardNumber}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${c.status === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}
                  >
                    {c.status.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5" /> {c.plate}
                    {c.driver ? ` — ${c.driver}` : ""}
                  </div>
                  <div>
                    {c.accountName
                      ? `Account: ${c.accountName}`
                      : "No linked account"}
                  </div>
                  {c.fuelProduct && (
                    <div className="inline-flex items-center gap-1">
                      <Fuel className="w-3.5 h-3.5" />{" "}
                      {getFuelLabel(c.fuelProduct)} only
                    </div>
                  )}
                  <div>
                    {c.prepaid
                      ? `Prepaid — balance ${currencySymbol} ${formatNumber(c.balance, 2)}`
                      : "Postpaid (credit)"}
                    {c.txnLimitLitres > 0 && ` · txn ≤ ${c.txnLimitLitres} L`}
                  </div>
                </div>
                {c.dailyLimitAmount > 0 && (
                  <div>
                    <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
                      <span>Today</span>
                      <span className={over ? "text-red-600" : ""}>
                        {currencySymbol} {formatNumber(use?.today ?? 0, 2)} /{" "}
                        {formatNumber(c.dailyLimitAmount, 2)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mt-0.5">
                      <div
                        className={`h-full rounded-full ${over ? "bg-red-500" : "bg-green-500"}`}
                        style={{ width: `${over ? 100 : pct}%` }}
                      />
                    </div>
                  </div>
                )}
                {over && (
                  <div className="inline-flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-3 h-3" /> Daily limit exceeded
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => toggleStatus(c.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:text-amber-600"
                  >
                    {c.status === "active" ? (
                      <Ban className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircle className="w-3.5 h-3.5" />
                    )}
                    {c.status === "active" ? "Suspend" : "Activate"}
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Record usage */}
      {cards.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            Record Card Usage
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <select
              value={usageForm.cardId}
              onChange={(e) =>
                setUsageForm((f) => ({ ...f, cardId: e.target.value }))
              }
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
              aria-label="Card"
            >
              <option value="">Pick a card</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.plate} — {c.cardNumber}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="0.01"
              value={usageForm.amount}
              onChange={(e) =>
                setUsageForm((f) => ({ ...f, amount: e.target.value }))
              }
              placeholder={`Amount (${currencySymbol})`}
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
            <input
              type="number"
              min={0}
              value={usageForm.litres}
              onChange={(e) =>
                setUsageForm((f) => ({ ...f, litres: e.target.value }))
              }
              placeholder="Litres"
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400"
            />
            <select
              value={usageForm.fuelType}
              onChange={(e) =>
                setUsageForm((f) => ({ ...f, fuelType: e.target.value }))
              }
              className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
              aria-label="Fuel type"
            >
              <option value="">Fuel (optional)</option>
              {fuelTypeApi.activeFuelTypes.map((ft) => (
                <option key={ft.name} value={ft.name}>
                  {getFuelLabel(ft.name)}
                </option>
              ))}
            </select>
            <button
              onClick={handleRecordUsage}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-500"
            >
              <Plus className="w-4 h-4" /> Record
            </button>
          </div>
          {usage.length > 0 && (
            <div className="max-h-40 overflow-y-auto text-xs divide-y divide-gray-100 dark:divide-gray-700/50">
              {usage.slice(0, 30).map((u) => {
                const card = cards.find((c) => c.id === u.cardId);
                return (
                  <div key={u.id} className="py-1.5 flex items-center gap-3">
                    <span className="text-gray-500 dark:text-gray-400">
                      {new Date(u.date).toLocaleString()}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {card?.plate ?? u.cardId}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">
                      {currencySymbol} {formatNumber(u.amount, 2)}
                      {u.litres > 0 ? ` · ${formatNumber(u.litres, 1)} L` : ""}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {u.fuelType}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
