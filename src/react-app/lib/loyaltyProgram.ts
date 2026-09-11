/**
 * FuelPro Multi-Station Customer Loyalty System
 *
 * Features:
 * - Per-station loyalty programs (each station has unique customers/rewards)
 * - Customer tracking across stations
 * - Points accumulation and redemption
 * - Tier system (Bronze, Silver, Gold, Platinum)
 * - QR code loyalty cards
 * - Real-time sync across devices
 * - Seafile/Supabase integration for cloud sync
 */

// ═══════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════

export type FuelType = string; // any canonical fuel code (PMS, AGO, IK, LPG, VPW, etc.) or "Both"
export type CustomerTier = "Bronze" | "Silver" | "Gold" | "Platinum";
export type RewardCategory = "discount" | "free_item" | "service" | "voucher";
export type TransactionType = "earn" | "redeem" | "adjustment" | "expire";
export type LoyaltyStatus = "active" | "suspended" | "expired";

// ─── Customer Profile ───
export interface LoyaltyCustomer {
  id: string;
  stationId: string; // Each customer belongs to a station
  name: string;
  phone: string;
  email?: string;
  vehicleReg?: string;
  vehicleMake?: string;
  vehicleModel?: string;

  // Points & Tier
  points: number;
  lifetimePoints: number;
  tier: CustomerTier;

  // Stats
  totalSpent: number;
  totalVisits: number;
  lastVisit: string;
  joinDate: string;

  // Preferences
  preferredFuel: FuelType;
  preferredPaymentMethod?: "cash" | "mpesa" | "card";

  // Card
  cardNumber: string; // Unique card number (station prefix + sequential)
  cardStatus: LoyaltyStatus;

  // Notes
  notes?: string;
  tags?: string[];

  // Meta
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

// ─── Reward Definition ───
export interface StationReward {
  id: string;
  stationId: string; // Station-specific rewards
  name: string;
  description: string;
  category: RewardCategory;

  // Points cost
  pointsCost: number;
  minPointsRequired?: number;

  // Value
  value: number;
  valueType: "percentage" | "fixed" | "free";
  maxDiscount?: number;

  // Availability
  fuelType?: FuelType; // Which fuel type this applies to
  minPurchaseAmount?: number;
  maxUsesPerCustomer?: number;

  // Validity
  validFrom: string;
  validUntil: string;
  isActive: boolean;

  // Limits
  totalQuantity?: number;
  remainingQuantity?: number;

  createdAt: string;
  updatedAt: string;
}

// ─── Transaction Record ───
export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  stationId: string;

  type: TransactionType;
  points: number; // Positive for earn, negative for redeem
  previousBalance: number;
  newBalance: number;

  // Linked sale
  saleId?: string;
  amount?: number;
  fuelType?: FuelType;
  liters?: number;

  // Details
  description: string;
  reference?: string; // Receipt number, coupon code, etc.

  // Admin info
  processedBy: string;
  processedAt: string;

  // For redemptions
  rewardId?: string;
  rewardName?: string;
}

// ─── Station Loyalty Config ───
export interface StationLoyaltyConfig {
  stationId: string;
  stationName: string;

  // Enabled
  isEnabled: boolean;

  // Points earning
  pointsPerLiter: number; // e.g., 1 point per liter
  minimumLiters: number; // Minimum purchase to earn points
  pointsMultiplier: {
    [key in CustomerTier]?: number; // e.g., Gold: 1.5x
  };

  // Tier thresholds (points needed)
  tierThresholds: {
    [key in CustomerTier]: number;
  };

  // Auto-upgrade
  autoUpgradeTier: boolean;
  upgradeNotifications: boolean;

  // Expiration
  pointsExpirationMonths: number; // 0 = never expire

  // Card prefix
  cardPrefix: string; // e.g., "FP" for FuelPro

  // Branding
  cardBgColor: string;
  cardTextColor: string;
  logo?: string;

  updatedAt: string;
}

// ─── Loyalty Statistics ───
export interface LoyaltyStats {
  stationId: string;
  totalCustomers: number;
  activeCustomers: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  totalRevenue: number;
  averageSpend: number;
  topTierBreakdown: {
    [key in CustomerTier]: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// TIER SYSTEM
// ═══════════════════════════════════════════════════════════════════

export const DEFAULT_TIER_THRESHOLDS: StationLoyaltyConfig["tierThresholds"] = {
  Bronze: 0,
  Silver: 1000,
  Gold: 5000,
  Platinum: 10000,
};

export const TIER_COLORS: Record<
  CustomerTier,
  { bg: string; text: string; border: string; gradient: string }
> = {
  Bronze: {
    bg: "bg-orange-100",
    text: "text-orange-700",
    border: "border-orange-300",
    gradient: "from-orange-400 to-amber-500",
  },
  Silver: {
    bg: "bg-gray-100",
    text: "text-gray-700",
    border: "border-gray-300",
    gradient: "from-gray-300 to-gray-500",
  },
  Gold: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    border: "border-amber-300",
    gradient: "from-yellow-400 to-amber-500",
  },
  Platinum: {
    bg: "bg-purple-100",
    text: "text-purple-700",
    border: "border-purple-300",
    gradient: "from-purple-400 to-pink-500",
  },
};

export function getTierFromPoints(
  points: number,
  thresholds = DEFAULT_TIER_THRESHOLDS,
): CustomerTier {
  if (points >= thresholds.Platinum) return "Platinum";
  if (points >= thresholds.Gold) return "Gold";
  if (points >= thresholds.Silver) return "Silver";
  return "Bronze";
}

export function getTierProgress(
  points: number,
  tier: CustomerTier,
  thresholds = DEFAULT_TIER_THRESHOLDS,
): number {
  const tiers: CustomerTier[] = ["Bronze", "Silver", "Gold", "Platinum"];
  const currentIndex = tiers.indexOf(tier);
  const nextTier = tiers[currentIndex + 1];

  if (!nextTier) return 100; // Already at max tier

  const currentThreshold = thresholds[tier];
  const nextThreshold = thresholds[nextTier];
  const range = nextThreshold - currentThreshold;
  const progress = points - currentThreshold;

  return Math.min(100, Math.round((progress / range) * 100));
}

export function getTierMultiplier(
  tier: CustomerTier,
  config?: StationLoyaltyConfig,
): number {
  return config?.pointsMultiplier?.[tier] || 1;
}

// ═══════════════════════════════════════════════════════════════════
// CARD NUMBER GENERATION
// ═══════════════════════════════════════════════════════════════════

export function generateCardNumber(
  stationId: string,
  stationIndex: number,
  customerIndex: number,
): string {
  const prefix = `FP${stationIndex.toString().padStart(2, "0")}`;
  const number = customerIndex.toString().padStart(6, "0");
  const checkDigit = calculateCheckDigit(prefix + number);
  return `${prefix}${number}${checkDigit}`;
}

function calculateCheckDigit(cardNumber: string): string {
  let sum = 0;
  for (let i = 0; i < cardNumber.length; i++) {
    const digit = parseInt(cardNumber[i], 10);
    sum += i % 2 === 0 ? digit * 1 : digit * 3;
  }
  return ((10 - (sum % 10)) % 10).toString();
}

export function validateCardNumber(cardNumber: string): boolean {
  if (cardNumber.length !== 10) return false;
  const base = cardNumber.slice(0, -1);
  const checkDigit = cardNumber.slice(-1);
  return calculateCheckDigit(base) === checkDigit;
}

// ═══════════════════════════════════════════════════════════════════
// POINTS CALCULATION
// ═══════════════════════════════════════════════════════════════════

export function calculatePointsEarned(
  liters: number,
  pricePerLiter: number,
  config: StationLoyaltyConfig,
  customerTier: CustomerTier,
): number {
  if (liters < config.minimumLiters) return 0;

  const basePoints = Math.floor(liters * config.pointsPerLiter);
  const multiplier = getTierMultiplier(customerTier, config);

  return Math.floor(basePoints * multiplier);
}

export function calculateDiscount(
  pointsToRedeem: number,
  reward: StationReward,
  purchaseAmount: number,
): number {
  if (reward.valueType === "percentage") {
    let discount = (pointsToRedeem / reward.pointsCost) * reward.value;
    if (reward.maxDiscount) discount = Math.min(discount, reward.maxDiscount);
    return Math.round(discount * 100) / 100;
  }

  if (reward.valueType === "fixed") {
    return Math.min(reward.value, purchaseAmount);
  }

  // Free item
  return 0;
}
