// ============================================================
// FUEL PRO SUBSCRIPTION ENGINE v3
// Trial, Tiered Pricing, Geo-Pricing, Coupons, Abuse Prevention
// All 250+ countries supported via world-country-utils
// ============================================================

import {
  generateRegionalPricesForAllCountries,
  getCountryByCode,
} from "./world-country-utils";
import { resolveCountryCode, runAllStorageMigrations } from "./geo-utils";

// ─── Storage Keys ───
// Non-versioned keys survive application upgrades without data loss
const SUB_KEY = "fuelpro_subscription";
const TRIAL_KEY = "fuelpro_trial";
const PRICING_KEY = "fuelpro_pricing_tiers";
const COUPON_KEY = "fuelpro_coupons";
const PAYMENT_KEY = "fuelpro_payments_log";
const TRIAL_ABUSE_KEY = "fuelpro_trial_abuse";
const TRIAL_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ─── Version Migration ───
// Migrate data from old versioned keys to current non-versioned keys
function runStorageMigrations(): void {
  const migrations: { oldKeys: string[]; currentKey: string }[] = [
    {
      oldKeys: [
        "fuelpro_subscription_v3",
        "fuelpro_subscription_v2",
        "fuelpro_subscription_v1",
      ],
      currentKey: SUB_KEY,
    },
    {
      oldKeys: ["fuelpro_trial_v3", "fuelpro_trial_v2", "fuelpro_trial_v1"],
      currentKey: TRIAL_KEY,
    },
  ];
  for (const { oldKeys, currentKey } of migrations) {
    try {
      const current = localStorage.getItem(currentKey);
      if (current) continue; // Already migrated
      for (const oldKey of oldKeys) {
        const old = localStorage.getItem(oldKey);
        if (old) {
          localStorage.setItem(currentKey, old);
          break;
        }
      }
    } catch {
      /* */
    }
  }
}

// ─── Tier Definitions ───
export type TierSlug = "daily" | "weekly" | "monthly" | "yearly" | "lifetime";

export interface PricingTier {
  id: TierSlug;
  name: string;
  durationDays: number;
  isActive: boolean;
  features: string[];
  recommended?: boolean;
}

export interface RegionalPrice {
  tierId: TierSlug;
  currency: string;
  price: number;
  regionCodes: string[];
  paymentGateways: string[];
}

export interface Subscription {
  id: string;
  userId: string;
  tierId: TierSlug;
  status: "trial" | "active" | "expired" | "canceled" | "refunded";
  currency: string;
  amountPaid: number;
  gateway: string;
  startedAt: string;
  expiresAt: string | null;
  autoRenew: boolean;
  couponUsed?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrialRecord {
  userId: string;
  email: string;
  deviceFingerprint: string;
  trialStartedAt: string;
  trialUsed: boolean;
  verified: boolean;
  ipHash: string;
}

export interface Coupon {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  maxUses: number;
  usedCount: number;
  tierIds: TierSlug[];
  regionCodes: string[];
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  description: string;
}

export interface PaymentRecord {
  id: string;
  subscriptionId: string;
  gateway: string;
  status: "pending" | "success" | "failed" | "refunded";
  amount: number;
  currency: string;
  transactionRef: string;
  idempotencyKey: string;
  createdAt: string;
}

// ─── Default Pricing Tiers ───
export const DEFAULT_TIERS: PricingTier[] = [
  {
    id: "daily",
    name: "Daily",
    durationDays: 1,
    isActive: true,
    features: ["Full access", "All features", "24-hour support"],
  },
  {
    id: "weekly",
    name: "Weekly",
    durationDays: 7,
    isActive: true,
    features: ["Full access", "All features", "Priority support", "Analytics"],
  },
  {
    id: "monthly",
    name: "Monthly",
    durationDays: 30,
    isActive: true,
    recommended: true,
    features: [
      "Full access",
      "All features",
      "Priority support",
      "Advanced analytics",
      "Data export",
    ],
  },
  {
    id: "yearly",
    name: "Yearly",
    durationDays: 365,
    isActive: true,
    features: [
      "Full access",
      "All features",
      "VIP support",
      "Advanced analytics",
      "Unlimited data history",
      "Free updates",
    ],
  },
  {
    id: "lifetime",
    name: "Lifetime",
    durationDays: -1,
    isActive: true,
    features: [
      "One-time payment",
      "All features forever",
      "VIP support",
      "Lifetime updates",
      "No recurring fees",
    ],
  },
];

// ─── Default Regional Prices ───
export const DEFAULT_REGIONAL_PRICES: RegionalPrice[] =
  generateRegionalPricesForAllCountries();

// ─── Gateway Info ───
export interface GatewayInfo {
  id: string;
  name: string;
  currencies: string[];
  methods: string[];
  icon: string;
}

export const GATEWAYS: GatewayInfo[] = [
  {
    id: "mpesa",
    name: "M-PESA",
    currencies: ["KES"],
    methods: ["STK Push", "C2B", "B2B"],
    icon: "phone",
  },
  {
    id: "stripe",
    name: "Stripe",
    currencies: ["USD", "EUR", "GBP"],
    methods: ["Card", "Apple Pay", "Google Pay", "SEPA"],
    icon: "credit-card",
  },
  {
    id: "paypal",
    name: "PayPal",
    currencies: ["USD", "EUR", "GBP"],
    methods: ["PayPal Balance", "Card"],
    icon: "globe",
  },
  {
    id: "flutterwave",
    name: "Flutterwave",
    currencies: ["KES", "UGX", "TZS", "NGN", "GHS", "ZAR", "RWF", "ETB", "USD"],
    methods: ["Card", "Mobile Money", "Bank Transfer"],
    icon: "zap",
  },
  {
    id: "paystack",
    name: "Paystack",
    currencies: ["KES", "NGN", "GHS", "ZAR", "USD"],
    methods: ["Card", "Bank Transfer", "Mobile Money"],
    icon: "credit-card",
  },
  {
    id: "mtn-momo",
    name: "MTN MoMo",
    currencies: ["UGX", "GHS", "RWF", "TZS"],
    methods: ["Mobile Money"],
    icon: "smartphone",
  },
  {
    id: "airtel-money",
    name: "Airtel Money",
    currencies: ["KES", "UGX", "TZS", "RWF"],
    methods: ["Mobile Money"],
    icon: "wifi",
  },
  {
    id: "opay",
    name: "OPay",
    currencies: ["NGN"],
    methods: ["Mobile Money", "Card", "Bank"],
    icon: "banknote",
  },
  {
    id: "snapscan",
    name: "SnapScan",
    currencies: ["ZAR"],
    methods: ["QR Code"],
    icon: "qrcode",
  },
  {
    id: "peach",
    name: "Peach Payments",
    currencies: ["ZAR", "USD"],
    methods: ["Card", "EFT"],
    icon: "credit-card",
  },
  {
    id: "telebirr",
    name: "Telebirr",
    currencies: ["ETB"],
    methods: ["Mobile Money"],
    icon: "phone",
  },
  {
    id: "tigo-pesa",
    name: "Tigo Pesa",
    currencies: ["TZS"],
    methods: ["Mobile Money"],
    icon: "smartphone",
  },
  {
    id: "vodafone-cash",
    name: "Vodafone Cash",
    currencies: ["GHS"],
    methods: ["Mobile Money"],
    icon: "wifi",
  },
  {
    id: "mpesa-tz",
    name: "M-PESA Tanzania",
    currencies: ["TZS"],
    methods: ["Mobile Money"],
    icon: "phone",
  },
];

// ─── Load / Save ───
export function loadTiers(): PricingTier[] {
  try {
    const s = localStorage.getItem(PRICING_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return [...DEFAULT_TIERS];
}

export function saveTiers(tiers: PricingTier[]) {
  localStorage.setItem(PRICING_KEY, JSON.stringify(tiers));
}

export function loadRegionalPrices(): RegionalPrice[] {
  try {
    const s = localStorage.getItem(`${PRICING_KEY}_regional`);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return [...DEFAULT_REGIONAL_PRICES];
}

export function saveRegionalPrices(prices: RegionalPrice[]) {
  localStorage.setItem(`${PRICING_KEY}_regional`, JSON.stringify(prices));
}

export function loadCoupons(): Coupon[] {
  try {
    const s = localStorage.getItem(COUPON_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return [
    {
      id: "c1",
      code: "WELCOME50",
      type: "percentage",
      value: 50,
      maxUses: 100,
      usedCount: 0,
      tierIds: ["monthly", "yearly"],
      regionCodes: ["ALL"],
      expiresAt: null,
      isActive: true,
      createdAt: new Date().toISOString(),
      description: "50% off for new subscribers",
    },
    {
      id: "c2",
      code: "FUELPRO20",
      type: "percentage",
      value: 20,
      maxUses: 500,
      usedCount: 0,
      tierIds: ["daily", "weekly", "monthly", "yearly"],
      regionCodes: ["ALL"],
      expiresAt: null,
      isActive: true,
      createdAt: new Date().toISOString(),
      description: "20% off any plan",
    },
  ];
}

export function saveCoupons(coupons: Coupon[]) {
  localStorage.setItem(COUPON_KEY, JSON.stringify(coupons));
}

export function loadPayments(): PaymentRecord[] {
  try {
    const s = localStorage.getItem(PAYMENT_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return [];
}

export function savePayments(payments: PaymentRecord[]) {
  localStorage.setItem(PAYMENT_KEY, JSON.stringify(payments));
}

// ─── Trial Logic ───
export function startTrial(userId: string, email: string): TrialRecord {
  const fingerprint = generateFingerprint();
  const ipHash = hashString(navigator.userAgent + screen.width + screen.height);
  const trial: TrialRecord = {
    userId,
    email,
    deviceFingerprint: fingerprint,
    trialStartedAt: new Date().toISOString(),
    trialUsed: false,
    verified: true,
    ipHash,
  };
  localStorage.setItem(TRIAL_KEY, JSON.stringify(trial));
  return trial;
}

export function getTrial(): TrialRecord | null {
  try {
    const s = localStorage.getItem(TRIAL_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return null;
}

export function checkTrialStatus(): {
  active: boolean;
  remainingMs: number;
  elapsedMs: number;
} {
  const trial = getTrial();
  if (!trial || trial.trialUsed)
    return { active: false, remainingMs: 0, elapsedMs: 0 };
  const elapsed = Date.now() - new Date(trial.trialStartedAt).getTime();
  const remaining = TRIAL_DURATION_MS - elapsed;
  return {
    active: remaining > 0,
    remainingMs: Math.max(0, remaining),
    elapsedMs: elapsed,
  };
}

export function markTrialUsed() {
  const trial = getTrial();
  if (trial) {
    trial.trialUsed = true;
    localStorage.setItem(TRIAL_KEY, JSON.stringify(trial));
  }
}

export function checkTrialAbuse(email: string): boolean {
  try {
    const abuseData: string[] = JSON.parse(
      localStorage.getItem(TRIAL_ABUSE_KEY) || "[]",
    );
    const fp = generateFingerprint();
    const ipHash = hashString(
      navigator.userAgent + screen.width + screen.height,
    );
    const emailHash = hashString(email);

    // Check if email, fingerprint, or IP hash has been used for trial
    const flags = abuseData.filter(
      (h) => h === emailHash || h === fp || h === ipHash,
    );
    return flags.length >= 2; // If 2+ matches, likely abuse
  } catch {
    return false;
  }
}

export function recordTrialAbuse(email: string) {
  try {
    const abuseData: string[] = JSON.parse(
      localStorage.getItem(TRIAL_ABUSE_KEY) || "[]",
    );
    const fp = generateFingerprint();
    const ipHash = hashString(
      navigator.userAgent + screen.width + screen.height,
    );
    abuseData.push(hashString(email), fp, ipHash);
    localStorage.setItem(
      TRIAL_ABUSE_KEY,
      JSON.stringify(abuseData.slice(-500)),
    );
  } catch {
    /* */
  }
}

// ─── Subscription Logic ───
export function createSubscription(
  userId: string,
  tierId: TierSlug,
  currency: string,
  amount: number,
  gateway: string,
  couponCode?: string,
): Subscription {
  const tier = DEFAULT_TIERS.find((t) => t.id === tierId);
  const isLifetime = tierId === "lifetime";
  const sub: Subscription = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    userId,
    tierId,
    status: "active",
    currency,
    amountPaid: amount,
    gateway,
    startedAt: new Date().toISOString(),
    expiresAt: isLifetime
      ? null
      : new Date(
          Date.now() + (tier?.durationDays || 30) * 86400000,
        ).toISOString(),
    autoRenew: !isLifetime,
    couponUsed: couponCode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(SUB_KEY, JSON.stringify(sub));
  return sub;
}

export function getSubscription(): Subscription | null {
  try {
    const s = localStorage.getItem(SUB_KEY);
    if (s) return JSON.parse(s);
  } catch {
    /* */
  }
  return null;
}

export function checkSubscription(): {
  access: boolean;
  type: "trial" | "paid" | "none";
  reason?: string;
  remainingMs?: number;
  expiresAt?: string;
} {
  // Check trial first
  const trial = checkTrialStatus();
  if (trial.active) {
    return { access: true, type: "trial", remainingMs: trial.remainingMs };
  }

  // Check subscription
  const sub = getSubscription();
  if (sub) {
    if (sub.status === "active" || sub.status === "trial") {
      if (sub.tierId === "lifetime" || sub.expiresAt === null) {
        return { access: true, type: "paid", expiresAt: "lifetime" };
      }
      if (new Date(sub.expiresAt) > new Date()) {
        return { access: true, type: "paid", expiresAt: sub.expiresAt };
      }
      // Expired - update status
      sub.status = "expired";
      sub.updatedAt = new Date().toISOString();
      localStorage.setItem(SUB_KEY, JSON.stringify(sub));
      return {
        access: false,
        type: "none",
        reason: "expired_subscription",
        expiresAt: sub.expiresAt,
      };
    }
  }

  return {
    access: false,
    type: "none",
    reason: trial.elapsedMs > 0 ? "expired_trial" : "no_subscription",
  };
}

export function cancelSubscription() {
  const sub = getSubscription();
  if (sub) {
    sub.status = "canceled";
    sub.autoRenew = false;
    sub.updatedAt = new Date().toISOString();
    localStorage.setItem(SUB_KEY, JSON.stringify(sub));
  }
}

export function recordPayment(
  subId: string,
  gateway: string,
  amount: number,
  currency: string,
  status: PaymentRecord["status"] = "success",
): PaymentRecord {
  const payments = loadPayments();
  const payment: PaymentRecord = {
    id: `pay_${Date.now()}`,
    subscriptionId: subId,
    gateway,
    status,
    amount,
    currency,
    transactionRef: `TXN_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: `idmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  payments.unshift(payment);
  savePayments(payments.slice(0, 500));
  return payment;
}

// ─── Coupon Logic ───
export function applyCoupon(
  code: string,
  tierId: TierSlug,
  regionCode: string,
): {
  valid: boolean;
  discount: number;
  finalPrice: number;
  message: string;
  coupon?: Coupon;
} {
  const coupons = loadCoupons();
  const coupon = coupons.find(
    (c) => c.code.toUpperCase() === code.toUpperCase() && c.isActive,
  );

  if (!coupon)
    return {
      valid: false,
      discount: 0,
      finalPrice: 0,
      message: "Invalid coupon code",
    };
  if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date())
    return {
      valid: false,
      discount: 0,
      finalPrice: 0,
      message: "Coupon has expired",
    };
  if (coupon.usedCount >= coupon.maxUses)
    return {
      valid: false,
      discount: 0,
      finalPrice: 0,
      message: "Coupon usage limit reached",
    };
  if (
    !coupon.tierIds.includes(tierId) &&
    !coupon.tierIds.includes("all" as any)
  )
    return {
      valid: false,
      discount: 0,
      finalPrice: 0,
      message: "Coupon not valid for this tier",
    };
  if (
    !coupon.regionCodes.includes(regionCode) &&
    !coupon.regionCodes.includes("ALL")
  )
    return {
      valid: false,
      discount: 0,
      finalPrice: 0,
      message: "Coupon not valid in your region",
    };

  return {
    valid: true,
    discount: coupon.value,
    finalPrice: 0,
    message: `${coupon.type === "percentage" ? coupon.value + "%" : coupon.value + " off"} applied!`,
    coupon,
  };
}

export function recordCouponUse(code: string) {
  const coupons = loadCoupons();
  const idx = coupons.findIndex(
    (c) => c.code.toUpperCase() === code.toUpperCase(),
  );
  if (idx >= 0) {
    coupons[idx].usedCount++;
    saveCoupons(coupons);
  }
}

// ─── Geo Pricing ───
export function resolvePrice(
  tierId: TierSlug,
  countryCode: string,
): RegionalPrice | null {
  const prices = loadRegionalPrices();
  // Try exact country match
  let match = prices.find(
    (p) => p.tierId === tierId && p.regionCodes.includes(countryCode),
  );
  if (!match) {
    // Fallback to USD
    match = prices.find((p) => p.tierId === tierId && p.currency === "USD");
  }
  return match || null;
}

export function resolveCountry(): {
  code: string;
  name: string;
  currency: string;
} {
  runAllStorageMigrations();
  const cc = resolveCountryCode("US");
  const country = getCountryByCode(cc);
  if (country)
    return { code: cc, name: country.name, currency: country.currency };
  return { code: "US", name: "United States", currency: "USD" };
}

export function getAvailableGateways(currency: string): GatewayInfo[] {
  return GATEWAYS.filter((g) => g.currencies.includes(currency));
}

// ─── Analytics ───
export function getSubscriptionStats() {
  const sub = getSubscription();
  const trial = getTrial();
  const payments = loadPayments();
  const coupons = loadCoupons();

  const totalRevenue = payments
    .filter((p) => p.status === "success")
    .reduce((s, p) => s + p.amount, 0);
  const totalPayments = payments.length;
  const avgOrderValue = totalPayments > 0 ? totalRevenue / totalPayments : 0;

  return {
    isSubscribed: sub?.status === "active",
    tierId: sub?.tierId || null,
    trialActive: checkTrialStatus().active,
    trialElapsed: trial
      ? Date.now() - new Date(trial.trialStartedAt).getTime()
      : 0,
    totalRevenue,
    totalPayments,
    avgOrderValue,
    activeCoupons: coupons.filter((c) => c.isActive).length,
    totalCouponsUsed: coupons.reduce((s, c) => s + c.usedCount, 0),
  };
}

// ─── Helpers ───
function generateFingerprint(): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.textBaseline = "top";
    ctx.font = "14px Arial";
    ctx.fillText("FuelPro FP", 2, 2);
  }
  const canvasData = canvas.toDataURL();
  return hashString(
    navigator.userAgent +
      navigator.language +
      screen.colorDepth +
      screen.width +
      screen.height +
      canvasData.slice(-50),
  );
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).slice(0, 12);
}
