// Subscription management for FuelPro - account-scoped localStorage
import {
  readScopedLocal,
  writeScopedLocal,
  removeScopedLocal,
} from "@/react-app/lib/scoped-local-storage";

export interface SubscriptionTier {
  key: string;
  name: string;
  priceKES: number;
  priceUSD: number;
  description: string;
  features: string[];
  maxUploads: number | string;
  maxStorage: string;
  color: string;
  icon: string;
}

export interface SubscriptionState {
  tier: string;
  status: "active" | "expired" | "trial" | "cancelled" | "none";
  activatedAt: string | null;
  expiresAt: string | null;
  mpesaReceipt: string | null;
  phone: string | null;
  autoRenew: boolean;
}

export const TIERS: SubscriptionTier[] = [
  {
    key: "free",
    name: "Free Trial",
    priceKES: 0,
    priceUSD: 0,
    description: "Get started with basic features",
    features: [
      "7-day trial access",
      "View public reports",
      "Download sample templates",
      "1 station only",
      "Basic analytics",
    ],
    maxUploads: 5,
    maxStorage: "100MB",
    color: "#94a3b8",
    icon: "Gift",
  },
  {
    key: "staff",
    name: "Station Staff",
    priceKES: 299,
    priceUSD: 3,
    description: "For fuel station attendants",
    features: [
      "All Free Trial features",
      "Upload daily sales reports",
      "Attach M-PESA receipts",
      "View station analytics",
      "Export CSV reports",
      "Shift management",
      "Email support",
    ],
    maxUploads: 50,
    maxStorage: "2GB",
    color: "#3b82f6",
    icon: "User",
  },
  {
    key: "manager",
    name: "Station Manager",
    priceKES: 999,
    priceUSD: 8,
    description: "For station supervisors & managers",
    features: [
      "All Staff features",
      "Approve expense claims",
      "Multi-station dashboard",
      "Audit trail access",
      "Debt management",
      "Invoice generation",
      "Tax compliance tools",
      "Priority support",
    ],
    maxUploads: 500,
    maxStorage: "20GB",
    color: "#f59e0b",
    icon: "Crown",
  },
  {
    key: "auditor",
    name: "County Auditor",
    priceKES: 2499,
    priceUSD: 20,
    description: "For county auditors & administrators",
    features: [
      "All Manager features",
      "Cross-station compliance reports",
      "Tax reconciliation tools",
      "Data export for ODPC audits",
      "API access",
      "Advanced analytics",
      "Custom integrations",
      "Dedicated account manager",
    ],
    maxUploads: "unlimited",
    maxStorage: "100GB",
    color: "#10b981",
    icon: "Shield",
  },
];

const SUBSCRIPTION_KEY = "fuelpro_subscription_v1";
const TIER_KEY = "fuelpro_tier_v1";
const SUBSCRIPTION_HISTORY_KEY = "fuelpro_subscription_history";

/**
 * Subscription state is per-account: the tier, M-PESA receipt and phone belong
 * to the user who paid. These were on global localStorage keys, so a second
 * account on the same device inherited the first one's plan. Reads/writes go
 * through the account-scoped helper instead.
 */
function readSub<T>(key: string, fallback: T): T {
  return readScopedLocal<T>(key, fallback);
}

function writeSub(key: string, value: unknown): void {
  writeScopedLocal(key, value);
}

export function getSubscription(): SubscriptionState {
  const cached = readSub<SubscriptionState | null>(SUBSCRIPTION_KEY, null);
  if (cached) return cached;

  // Check legacy trial data
  try {
    const trialRaw = readScopedLocal<string>("fuelpro_trial_start", "");
    if (trialRaw) {
      const started = new Date(trialRaw);
      const now = new Date();
      const elapsed = now.getTime() - started.getTime();
      const elapsedHours = elapsed / (1000 * 60 * 60);

      if (elapsedHours < 168) {
        const expiresAt = new Date(
          started.getTime() + 168 * 60 * 60 * 1000,
        ).toISOString();
        const state: SubscriptionState = {
          tier: "free",
          status: "trial",
          activatedAt: started.toISOString(),
          expiresAt,
          mpesaReceipt: null,
          phone: null,
          autoRenew: false,
        };
        writeSub(SUBSCRIPTION_KEY, state);
        return state;
      }
    }
  } catch {
    /* */
  }

  return {
    tier: "free",
    status: "trial",
    activatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 168 * 60 * 60 * 1000).toISOString(),
    mpesaReceipt: null,
    phone: null,
    autoRenew: false,
  };
}

export function setSubscription(state: SubscriptionState): void {
  writeSub(SUBSCRIPTION_KEY, state);
  writeSub(TIER_KEY, state.tier);
}

export function activateTier(
  tier: string,
  opts?: { mpesaReceipt?: string; phone?: string },
): SubscriptionState {
  const tierData = TIERS.find((t) => t.key === tier);
  if (!tierData) return getSubscription();

  const state: SubscriptionState = {
    tier,
    status: tier === "free" ? "trial" : "active",
    activatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    mpesaReceipt: opts?.mpesaReceipt || null,
    phone: opts?.phone || null,
    autoRenew: false,
  };

  if (tier === "free") {
    const trialRaw = readScopedLocal<string>("fuelpro_trial_start", "");
    if (trialRaw) {
      state.activatedAt = trialRaw;
      state.expiresAt = new Date(
        new Date(trialRaw).getTime() + 168 * 60 * 60 * 1000,
      ).toISOString();
    } else {
      const now = new Date().toISOString();
      state.activatedAt = now;
      state.expiresAt = new Date(
        Date.now() + 168 * 60 * 60 * 1000,
      ).toISOString();
      writeScopedLocal("fuelpro_trial_start", now);
    }
  }

  setSubscription(state);
  return state;
}

export function checkAccess(requiredTier: string): boolean {
  const sub = getSubscription();
  if (sub.status === "active") return true;
  if (sub.status === "trial" && requiredTier === "free") return true;
  if (sub.status === "expired") return false;

  const tierOrder: Record<string, number> = {
    free: 0,
    staff: 1,
    manager: 2,
    auditor: 3,
  };
  return (tierOrder[sub.tier] || 0) >= (tierOrder[requiredTier] || 0);
}

export function getCurrentTier(): SubscriptionTier | undefined {
  const sub = getSubscription();
  return TIERS.find((t) => t.key === sub.tier);
}

export function getTimeRemaining(): {
  hours: number;
  minutes: number;
  expired: boolean;
} {
  const sub = getSubscription();
  if (!sub.expiresAt) return { hours: 0, minutes: 0, expired: true };

  const remaining = new Date(sub.expiresAt).getTime() - Date.now();
  if (remaining <= 0) return { hours: 0, minutes: 0, expired: true };

  return {
    hours: Math.floor(remaining / (1000 * 60 * 60)),
    minutes: Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60)),
    expired: false,
  };
}

export function isTrialExpired(): boolean {
  const remaining = getTimeRemaining();
  return remaining.expired;
}

export function getSubscriptionHistory(): Array<{
  date: string;
  action: string;
  tier: string;
  details: string;
}> {
  return readSub<Array<{
    date: string;
    action: string;
    tier: string;
    details: string;
  }>>(SUBSCRIPTION_HISTORY_KEY, []);
}

export function logSubscriptionAction(
  action: string,
  tier: string,
  details: string,
): void {
  const history = getSubscriptionHistory();
  history.push({ date: new Date().toISOString(), action, tier, details });
  if (history.length > 100) history.shift();
  writeSub(SUBSCRIPTION_HISTORY_KEY, history);
}

export function cancelSubscription(): SubscriptionState {
  const sub = getSubscription();
  const cancelled: SubscriptionState = {
    ...sub,
    status: "cancelled",
    autoRenew: false,
  };
  setSubscription(cancelled);
  logSubscriptionAction(
    "cancelled",
    sub.tier,
    "Subscription cancelled by user",
  );
  return cancelled;
}

export function resetSubscription(): void {
  removeScopedLocal(SUBSCRIPTION_KEY);
  removeScopedLocal(TIER_KEY);
  removeScopedLocal(SUBSCRIPTION_HISTORY_KEY);
  // Keep trial start for tracking
}
