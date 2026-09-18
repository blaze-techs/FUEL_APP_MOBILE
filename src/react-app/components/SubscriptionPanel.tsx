/**
 * SubscriptionPanel — FuelPro Subscription tab.
 *
 * Port of Reatech360's `/admin/subscription` page adapted to FuelPro's
 * cloud-first architecture:
 *   - Current plan summary card (plan name, billing period, status,
 *     trial/paid dates, users usage vs plan limit)
 *   - "Pay Now" card: M-PESA (when Daraja configured) or card payment
 *     (honest pending recording when no gateway is set)
 *   - Available plans grid with monthly/yearly billing toggle + switch
 *   - Payment history table (gateway, amount, status, date)
 *   - Trial banner + lapsed/overdue warnings
 *
 * All state persisted station-scoped to app_kv via cloudStorageService,
 * so the subscription is consistent across every device.
 */

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  CreditCard,
  Crown,
  Loader2,
  RefreshCcw,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { getMpesaConfig } from "@/react-app/lib/mpesa-integration-service";
import {
  PLANS,
  DEFAULT_SUBSCRIPTION,
  SubscriptionPayment,
  SubscriptionPlan,
  SubscriptionState,
  addPayment,
  currencySymbol,
  formatDate,
  loadPayments,
  loadSubscription,
  planById,
  planPrice,
  savePayments,
  saveSubscription,
  subscriptionStatus,
  trialDaysLeft,
  upgradeRequiresPayment,
} from "@/react-app/lib/subscription-service";

/* ───────────────────────── Helpers ───────────────────────── */

function uid(): string {
  return `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtMoney(n: number, cur: string): string {
  return `${currencySymbol(cur)}${n.toLocaleString(undefined, {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ───────────────────────── Component ───────────────────────── */

export default function SubscriptionPanel() {
  const { currentStation, stations } = useStations();
  const { token } = useAuth();
  const stationId = currentStation?.id;

  const [sub, setSub] = useState<SubscriptionState>(DEFAULT_SUBSCRIPTION);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Pay Now state
  const [phone, setPhone] = useState("");
  const [payNote, setPayNote] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  // Plan switch state
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, p] = await Promise.all([
        loadSubscription(stationId),
        loadPayments(stationId),
      ]);
      if (cancelled) return;
      setSub(s);
      setPayments(p);
      setPeriod(s.billingPeriod);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const currentPlan = planById(sub.planId);
  const status = subscriptionStatus(sub);
  const tLeft = trialDaysLeft(sub);
  const totalUsers = useMemo(
    () => Math.max(1, stations.length),
    [stations.length],
  );

  async function persist(next: SubscriptionState) {
    setSub(next);
    await saveSubscription(next, stationId);
  }

  async function switchPlan(plan: SubscriptionPlan) {
    setSwitchError(null);
    if (plan.id === sub.planId && period === sub.billingPeriod) return;
    const next: SubscriptionState = {
      ...sub,
      planId: plan.id,
      billingPeriod: period,
      onTrial: sub.onTrial,
      trialStartedAt: sub.trialStartedAt,
      trialEndsAt: sub.trialEndsAt,
      hasActiveSubscription: sub.hasActiveSubscription,
      subscriptionPaidUntil: sub.subscriptionPaidUntil,
    };
    // Mirror Reatech: upgrading to a paid plan needs payment (handled via
    // Pay Now below). Downgrades / free plan switch immediately.
    const paid = planPrice(plan, period) > 0;
    if (paid && !next.hasActiveSubscription && !(next.onTrial && tLeft > 0)) {
      setSwitchError(
        `Switching to ${plan.name} starts a ${fmtMoney(
          planPrice(plan, period),
          plan.currency,
        )} subscription. Use Pay Now above to secure your access.`,
      );
      return;
    }
    setSaving(true);
    await persist(next);
    setSaving(false);
    setPeriod(period);
  }

  async function handleMpesaPay(e: FormEvent) {
    e.preventDefault();
    setPayNote(null);
    const amount = planPrice(currentPlan ?? PLANS[1], period);
    if (!phone.trim()) {
      setPayNote("Enter the M-PESA number to charge.");
      return;
    }
    setPayBusy(true);
    try {
      // Check if M-PESA Daraja is configured on this station.
      const cfg = await getMpesaConfig(stationId);
      const amt = Math.max(1, Math.round(amount));
      if (cfg.enabled && cfg.shortcode) {
        // Configured gateway — record a pending payment that the station
        // owner completes via their Daraja integration (Live Transaction
        // STK Push). We mark it pending honestly.
        const rec: SubscriptionPayment = {
          id: uid(),
          gateway: "mpesa",
          amount: amt,
          currency: currentPlan?.currency ?? "USD",
          status: "pending",
          date: new Date().toISOString(),
          planId: sub.planId,
          billingPeriod: period,
        };
        const list = await addPayment(rec, stationId);
        setPayments(list);
        setPayNote(
          `M-PESA payment of ${fmtMoney(amt, rec.currency)} recorded as pending (shortcode ${cfg.shortcode}). Complete it via Live Transaction → STK Push.`,
        );
      } else {
        // No gateway configured — honest pending note + history entry.
        const rec: SubscriptionPayment = {
          id: uid(),
          gateway: "manual",
          amount: amt,
          currency: currentPlan?.currency ?? "USD",
          status: "pending",
          date: new Date().toISOString(),
          planId: sub.planId,
          billingPeriod: period,
        };
        const list = await addPayment(rec, stationId);
        setPayments(list);
        setPayNote(
          `M-PESA gateway is not configured on this station. ${fmtMoney(
            amt,
            rec.currency,
          )} was noted as pending. Configure M-PESA in Integration Hub → Payment Setup to accept real payments.`,
        );
      }
    } catch (err) {
      setPayNote(`Could not start the M-PESA payment: ${String(err)}`);
    } finally {
      setPayBusy(false);
    }
  }

  async function handleCardPay() {
    setPayNote(null);
    if (!token || !stationId) {
      setPayNote("Please sign in and select a station before starting billing.");
      return;
    }
    setPayBusy(true);
    try {
      const res = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "initialize", stationId, planId: currentPlan?.id || sub.planId, billingPeriod: period }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.authorizationUrl) {
        throw new Error(data.error || `Billing initialization failed (HTTP ${res.status})`);
      }
      window.location.assign(data.authorizationUrl);
    } catch (err) {
      setPayNote(`Could not start the card payment: ${String(err)}`);
    } finally {
      setPayBusy(false);
    }
  }

  async function refresh() {
    setLoading(true);
    const [s, p] = await Promise.all([
      loadSubscription(stationId),
      loadPayments(stationId),
    ]);
    setSub(s);
    setPayments(p);
    setLoading(false);
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-xl p-5 text-white shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Crown className="w-8 h-8" />
            <div>
              <h2 className="text-xl font-bold">Subscription</h2>
              <p className="text-sm text-emerald-100">
                See your plan, usage, and billing details
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${
                status.warn ? "bg-amber-500/40" : "bg-white/20"
              }`}
            >
              <TriangleAlert size={10} /> {status.text}
            </span>
            <button
              onClick={refresh}
              className="text-xs px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg flex items-center gap-1 transition-colors"
            >
              <RefreshCcw size={12} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : (
        <>
          {/* Trial banner */}
          {sub.onTrial && (
            <div
              className={`rounded-xl border p-4 flex items-center gap-3 ${
                tLeft <= 3
                  ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-900"
                  : "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-900"
              }`}
            >
              <Sparkles className="w-6 h-6 text-emerald-500" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {tLeft} day{tLeft === 1 ? "" : "s"} left in your free trial
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Pay below any time to secure your access after it ends.
                </p>
              </div>
            </div>
          )}

          {/* Current plan + usage */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Current plan
                  </p>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {currentPlan?.name ?? sub.planId}{" "}
                    <span className="text-sm font-medium text-gray-400">
                      · {sub.billingPeriod}
                    </span>
                  </h3>
                </div>
                <span className="px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center gap-1">
                  <BadgeCheck size={12} />{" "}
                  {sub.hasActiveSubscription
                    ? "Active"
                    : sub.onTrial
                      ? "On trial"
                      : sub.subscriptionLapsed
                        ? "Lapsed"
                        : "Trial"}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Trial ends</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {formatDate(sub.trialEndsAt)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Paid until</p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {formatDate(sub.subscriptionPaidUntil)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">
                    Period start
                  </p>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {formatDate(sub.currentPeriodStartedAt)}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-gray-400">Users</p>
                  <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-1">
                    <Users size={12} className="text-emerald-500" />{" "}
                    {totalUsers}
                    {currentPlan?.maxUsers ? ` / ${currentPlan.maxUsers}` : ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Pay Now */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                Pay Now
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {fmtMoney(
                  planPrice(currentPlan ?? PLANS[0], sub.billingPeriod),
                  currentPlan?.currency ?? "USD",
                )}{" "}
                {sub.billingPeriod === "yearly" ? "year" : "month"} ·{" "}
                {currentPlan?.maxUsers
                  ? `${currentPlan.maxUsers} users`
                  : "Unlimited users"}
              </p>
              <form onSubmit={handleMpesaPay} className="mt-3 space-y-2">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="M-PESA phone (e.g. 254712345678)"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
                />
                <button
                  type="submit"
                  disabled={payBusy}
                  className="w-full px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {payBusy ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}{" "}
                  Pay with M-PESA
                </button>
              </form>
              <button
                onClick={handleCardPay}
                disabled={payBusy}
                className="w-full mt-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CreditCard size={14} /> Pay with Card
              </button>
              {payNote && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  {payNote}
                </p>
              )}
            </div>
          </div>

          {/* Plan switcher */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  Available Plans
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Switch any time. {"Your "}plan changes right away.
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  className={`px-3 py-1.5 rounded-lg text-xs ${period === "monthly" ? "bg-emerald-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                  onClick={() => setPeriod("monthly")}
                >
                  Monthly
                </button>
                <button
                  className={`px-3 py-1.5 rounded-lg text-xs ${period === "yearly" ? "bg-emerald-600 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                  onClick={() => setPeriod("yearly")}
                >
                  Yearly
                </button>
              </div>
            </div>

            {switchError && (
              <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-300">
                {switchError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              {PLANS.map((plan) => {
                const active = plan.id === sub.planId;
                const requiresPayment = upgradeRequiresPayment(
                  currentPlan,
                  plan,
                );
                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-xl border p-4 flex flex-col ${
                      active
                        ? "border-emerald-500 dark:border-emerald-600 ring-2 ring-emerald-500/30"
                        : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    {plan.badge && (
                      <span className="absolute -top-2.5 right-3 text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                        {plan.badge}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {plan.name}
                      </span>
                      {active && (
                        <Check size={14} className="text-emerald-500" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {plan.description}
                    </p>
                    <div className="mt-3 flex items-end gap-1">
                      <span className="text-2xl font-bold text-gray-900 dark:text-white">
                        {fmtMoney(planPrice(plan, period), plan.currency)}
                      </span>
                      <span className="text-xs text-gray-500 pb-1">
                        /{" "}
                        {period === "yearly" && plan.yearlyPrice !== null
                          ? "year"
                          : "month"}
                      </span>
                    </div>
                    <ul className="mt-3 space-y-1 flex-1">
                      {plan.features.map((ft) => (
                        <li
                          key={ft}
                          className="text-xs text-gray-600 dark:text-gray-300 flex items-start gap-1.5"
                        >
                          <Check
                            size={12}
                            className="text-emerald-500 mt-0.5 flex-shrink-0"
                          />{" "}
                          {ft}
                        </li>
                      ))}
                    </ul>
                    <button
                      disabled={saving || active}
                      onClick={() => switchPlan(plan)}
                      className={`mt-4 px-3 py-2 rounded-lg text-sm w-full flex items-center justify-center gap-1 ${
                        active
                          ? "bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed"
                          : "bg-emerald-600 hover:bg-emerald-700 text-white"
                      }`}
                    >
                      {active
                        ? "Current plan"
                        : requiresPayment
                          ? "Upgrade"
                          : "Switch"}
                    </button>
                  </div>
                );
              })}
            </div>
            {saving && (
              <p className="mt-3 text-xs flex items-center gap-1 text-emerald-600">
                <Loader2 size={12} className="animate-spin" /> Saving…
              </p>
            )}
          </div>

          {/* Payment history */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
            <p className="font-semibold text-gray-900 dark:text-white">
              Payment History
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Past subscription payments for this workspace.
            </p>
            {payments.length === 0 ? (
              <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                No payments yet. When you pay, each entry appears here.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-2 pr-3">Gateway</th>
                      <th className="py-2 pr-3">Amount</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-gray-100 dark:border-gray-800"
                      >
                        <td className="py-2 capitalize pr-3 text-gray-900 dark:text-white">
                          {p.gateway}
                        </td>
                        <td className="py-2 pr-3 text-gray-900 dark:text-white">
                          {fmtMoney(p.amount, p.currency)}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              p.status === "success"
                                ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                                : p.status === "pending"
                                  ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
                                  : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                            }`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">
                          {formatDate(p.date)}
                        </td>
                        <td className="py-2" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
