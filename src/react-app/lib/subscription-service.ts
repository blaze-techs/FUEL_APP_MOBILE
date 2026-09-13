/**
 * subscription-service — FuelPro Subscription feature.
 *
 * Reverse-engineered from Reatech360's `/admin/subscription` page:
 *   - Plans with monthly/yearly pricing and per-plan user limits
 *   - Trial lifecycle (on_trial, trial_days_left, trial_ends_at)
 *   - Paid state (subscription_paid_until, current_period_started_at,
 *     has_active_subscription)
 *   - Usage (users_count vs max_users)
 *   - Payment history (gateway, amount, status, date)
 *   - Plan switching with billing-period selection
 *
 * State is persisted to app_kv via cloudStorageService (station-scoped)
 * so the same subscription reads on every device, matching the app-wide
 * cloud-first pattern. Payment is a real flow when M-PESA Daraja is
 * configured (subscription/pay/mpesa equivalent) and otherwise records a
 * payment entry in history with an honest status.
 */

import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export const SUBSCRIPTION_KEY = "app_subscription";
export const PAYMENTS_KEY = "app_subscription_payments";

/* ───────────────────────── Types ───────────────────────── */

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price: number; // monthly price (0 = free)
  yearlyPrice: number | null; // yearly price (discounted) when available
  currency: string;
  maxUsers: number | null; // null = unlimited
  features: string[];
  badge?: string; // "Most Popular" etc.
}

export interface SubscriptionState {
  planId: string;
  billingPeriod: "monthly" | "yearly";
  onTrial: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  subscriptionPaidUntil: string | null;
  currentPeriodStartedAt: string | null;
  hasActiveSubscription: boolean;
  subscriptionLapsed: boolean;
  createdAt: string | null;
}

export type PaymentStatus = "success" | "failed" | "pending";

export interface SubscriptionPayment {
  id: string;
  gateway: "mpesa" | "card" | "manual";
  amount: number;
  currency: string;
  status: PaymentStatus;
  date: string;
  planId: string;
  billingPeriod: "monthly" | "yearly";
}

/* ───────────────────────── Plan catalog ───────────────────────── */

export const TRIAL_DAYS = 14;

export const PLANS: SubscriptionPlan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "For single-station operators getting started.",
    price: 0,
    yearlyPrice: null,
    currency: "USD",
    maxUsers: 1,
    features: [
      "1 station",
      "1 user",
      "Core sales, inventory & expenses",
      "Invoices & receipts",
      "Community support",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    badge: "Most Popular",
    description: "For growing stations running the full business.",
    price: 19,
    yearlyPrice: 190,
    currency: "USD",
    maxUsers: 5,
    features: [
      "Up to 5 users",
      "Everything in Starter",
      "Reports & analytics",
      "Payroll, leave & team",
      "WhatsApp & email delivery",
      "M-Pesa / card payments",
      "Priority support",
    ],
  },
  {
    id: "business",
    name: "Business",
    description: "For multi-station networks & larger teams.",
    price: 49,
    yearlyPrice: 490,
    currency: "USD",
    maxUsers: null,
    features: [
      "Unlimited users",
      "Everything in Professional",
      "Multi-station combined view",
      "Advanced analytics & audit",
      "API & webhooks",
      "Dedicated support",
    ],
  },
];

export interface SubscriptionStatusInfo {
  text: string;
  warn: boolean;
}

export function subscriptionStatus(s: SubscriptionState): SubscriptionStatusInfo {
  if (s.onTrial && s.trialEndsAt && new Date(s.trialEndsAt) > new Date()) {
    return { text: `Trial ends ${formatDate(s.trialEndsAt)}`, warn: false };
  }
  if (s.subscriptionPaidUntil) {
    const overdue = new Date(s.subscriptionPaidUntil) < new Date();
    return {
      text: `${overdue ? "Was due" : "Due"} ${formatDate(s.subscriptionPaidUntil)}`,
      warn: overdue,
    };
  }
  return { text: "No active plan or trial", warn: true };
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function planById(id: string): SubscriptionPlan | undefined {
  return PLANS.find((p) => p.id === id);
}

export function planPrice(
  plan: SubscriptionPlan,
  period: "monthly" | "yearly",
): number {
  if (period === "yearly" && plan.yearlyPrice !== null) return plan.yearlyPrice;
  return plan.price;
}

export function currencySymbol(c: string): string {
  if (c === "KES") return "KSh";
  if (c === "USD") return "$";
  if (c === "EUR") return "€";
  if (c === "GBP") return "£";
  return c;
}

/** Mirrors Reatech's upgrade "requires_payment" check. */
export function upgradeRequiresPayment(
  current: SubscriptionPlan | undefined,
  next: SubscriptionPlan,
): boolean {
  return (
    !!current &&
    current.currency === next.currency &&
    Number(next.price) > Number(current.price)
  );
}

export const DEFAULT_SUBSCRIPTION: SubscriptionState = (() => {
  const now = new Date();
  return {
    planId: "starter",
    billingPeriod: "monthly",
    onTrial: true,
    trialStartedAt: now.toISOString(),
    trialEndsAt: addDays(now, TRIAL_DAYS).toISOString(),
    subscriptionPaidUntil: null,
    currentPeriodStartedAt: null,
    hasActiveSubscription: false,
    subscriptionLapsed: false,
    createdAt: now.toISOString(),
  };
})();

/* ───────────────────────── Persistence ───────────────────────── */

export async function loadSubscription(
  stationId?: string,
): Promise<SubscriptionState> {
  const cloud = await cloudStorageService.get<SubscriptionState>(
    SUBSCRIPTION_KEY,
    stationId,
  );
  if (cloud) return { ...DEFAULT_SUBSCRIPTION, ...cloud };
  return DEFAULT_SUBSCRIPTION;
}

export async function saveSubscription(
  s: SubscriptionState,
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(SUBSCRIPTION_KEY, s, stationId);
}

export async function loadPayments(
  stationId?: string,
): Promise<SubscriptionPayment[]> {
  const cloud = await cloudStorageService.get<SubscriptionPayment[]>(
    PAYMENTS_KEY,
    stationId,
  );
  return Array.isArray(cloud) ? cloud : [];
}

export async function savePayments(
  p: SubscriptionPayment[],
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(PAYMENTS_KEY, p, stationId);
}

export async function addPayment(
  p: SubscriptionPayment,
  stationId?: string,
): Promise<SubscriptionPayment[]> {
  const list = await loadPayments(stationId);
  const next = [p, ...list].filter(Boolean).slice(0, 200);
  await savePayments(next, stationId);
  return next;
}

export function trialDaysLeft(s: SubscriptionState): number {
  if (!s.onTrial || !s.trialEndsAt) return 0;
  const diff = new Date(s.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}