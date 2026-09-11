/**
 * FuelPro useLoyalty Hook
 * React hook for managing multi-station loyalty programs
 *
 * Cross-device cloud sync: customers, rewards, transactions, and per-station
 * config are persisted to Supabase `app_kv` (RLS by owner_id, scoped row id)
 * via `cloudStorageService`, so a loyalty member enrolled / points awarded on
 * one device are visible on every other device. localStorage is kept ONLY as a
 * read-through cache for instant first render.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  LoyaltyCustomer,
  StationReward,
  LoyaltyTransaction,
  StationLoyaltyConfig,
  LoyaltyStats,
  getTierFromPoints,
  calculatePointsEarned,
  generateCardNumber,
  DEFAULT_TIER_THRESHOLDS,
} from "./loyaltyProgram";
import { getCurrencySymbol } from "./currency";
import cloudStorageService from "./cloud-storage-service";

const LOYALTY_CUSTOMERS_KEY = "fuelpro_loyalty_customers";
const LOYALTY_REWARDS_KEY = "fuelpro_loyalty_rewards";
const LOYALTY_TRANSACTIONS_KEY = "fuelpro_loyalty_transactions";
const LOYALTY_CONFIG_KEY = "fuelpro_loyalty_config";

// Cloud keys (station-scoped). These are the cross-device source of truth;
// the LOYALTY_*_KEY constants above are now ONLY the localStorage cache names.
const CLOUD_CUSTOMERS_KEY = "loyalty_customers";
const CLOUD_REWARDS_KEY = "loyalty_rewards";
const CLOUD_TXNS_KEY = "loyalty_transactions";
const CLOUD_CONFIG_KEY = "loyalty_config";

// ─── Storage Helpers ───
function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error("[Loyalty] Storage error:", e);
  }
}

/** Coerce an unknown cloud value into a LoyaltyCustomer array (defensive). */
function normalizeCustomers(arr: unknown): LoyaltyCustomer[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (c) => c && typeof c === "object" && (c as LoyaltyCustomer).id,
  );
}

/** Coerce an unknown cloud value into a LoyaltyTransaction array. */
function normalizeTxns(arr: unknown): LoyaltyTransaction[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (t) => t && typeof t === "object" && (t as LoyaltyTransaction).id,
  );
}

/** Coerce an unknown cloud value into a StationReward array. */
function normalizeRewards(arr: unknown): StationReward[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (r) => r && typeof r === "object" && (r as StationReward).id,
  );
}

// ─── Default Station Config ───
function getDefaultStationConfig(
  stationId: string,
  stationName: string,
): StationLoyaltyConfig {
  return {
    stationId,
    stationName,
    isEnabled: true,
    pointsPerLiter: 1,
    minimumLiters: 1,
    pointsMultiplier: { Bronze: 1, Silver: 1.25, Gold: 1.5, Platinum: 2 },
    tierThresholds: DEFAULT_TIER_THRESHOLDS,
    autoUpgradeTier: true,
    upgradeNotifications: true,
    pointsExpirationMonths: 12,
    cardPrefix: "FP",
    cardBgColor: "#1a1a2e",
    cardTextColor: "#ffffff",
    updatedAt: new Date().toISOString(),
  };
}

// ─── Default Rewards ───
function getDefaultRewards(stationId: string): StationReward[] {
  const now = new Date().toISOString();
  const yearLater = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString();

  return [
    {
      id: `${stationId}_r1`,
      stationId,
      name: "5% Off Next Fill",
      description: "Get 5% discount on your next fuel purchase",
      category: "discount",
      pointsCost: 500,
      value: 5,
      valueType: "percentage",
      maxDiscount: 500,
      minPurchaseAmount: 1000,
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      totalQuantity: 100,
      remainingQuantity: 100,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${stationId}_r2`,
      stationId,
      name: "10% Off Total",
      description: "10% discount on entire purchase",
      category: "discount",
      pointsCost: 1000,
      value: 10,
      valueType: "percentage",
      maxDiscount: 1000,
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${stationId}_r3`,
      stationId,
      name: "Free Oil Check",
      description: "Complimentary engine oil level check",
      category: "service",
      pointsCost: 300,
      value: 0,
      valueType: "free",
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${stationId}_r4`,
      stationId,
      name: "Free Car Wash",
      description: "Premium car wash service on us",
      category: "service",
      pointsCost: 1000,
      value: 0,
      valueType: "free",
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${stationId}_r5`,
      stationId,
      name: "Free Engine Oil (1L)",
      description: "1L of quality engine oil (5W-30)",
      category: "free_item",
      pointsCost: 2000,
      value: 500,
      valueType: "fixed",
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      totalQuantity: 50,
      remainingQuantity: 50,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${stationId}_r6`,
      stationId,
      name: `${getCurrencySymbol()} 500 Voucher`,
      description: `${getCurrencySymbol()} 500 off any purchase over ${getCurrencySymbol()} 2000`,
      category: "voucher",
      pointsCost: 3000,
      value: 500,
      valueType: "fixed",
      minPurchaseAmount: 2000,
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${stationId}_r7`,
      stationId,
      name: "20% Off (Gold Members)",
      description: "Exclusive 20% discount for Gold & Platinum members",
      category: "discount",
      pointsCost: 5000,
      minPointsRequired: 5000,
      value: 20,
      valueType: "percentage",
      maxDiscount: 2000,
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${stationId}_r8`,
      stationId,
      name: "Free Tire Pressure",
      description: "Tire pressure check and inflate",
      category: "service",
      pointsCost: 200,
      value: 0,
      valueType: "free",
      validFrom: now,
      validUntil: yearLater,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

// ─── Main Hook ───
export function useLoyalty(stationId: string) {
  // ─── State ───
  // Initialize from the synchronous in-memory cloud cache (freshest
  // cross-device data) for an instant first render, falling back to the
  // localStorage read-through cache. The async cloud `get` in the load effect
  // below reconciles with the authoritative source of truth.
  const [customers, setCustomers] = useState<LoyaltyCustomer[]>(() => {
    const cached = cloudStorageService.getCached<unknown>(
      CLOUD_CUSTOMERS_KEY,
      stationId,
    );
    const arr = normalizeCustomers(cached);
    if (arr.length) return arr;
    return loadFromStorage<LoyaltyCustomer[]>(LOYALTY_CUSTOMERS_KEY, []);
  });
  const [rewards, setRewards] = useState<StationReward[]>(() => {
    const cached = cloudStorageService.getCached<unknown>(
      CLOUD_REWARDS_KEY,
      stationId,
    );
    const arr = normalizeRewards(cached);
    if (arr.length) return arr;
    return loadFromStorage<StationReward[]>(
      LOYALTY_REWARDS_KEY,
      getDefaultRewards(stationId),
    );
  });
  const [transactions, setTransactions] = useState<LoyaltyTransaction[]>(() => {
    const cached = cloudStorageService.getCached<unknown>(
      CLOUD_TXNS_KEY,
      stationId,
    );
    const arr = normalizeTxns(cached);
    if (arr.length) return arr;
    return loadFromStorage<LoyaltyTransaction[]>(LOYALTY_TRANSACTIONS_KEY, []);
  });
  const [configs, setConfigs] = useState<Record<string, StationLoyaltyConfig>>(
    () => {
      const cached = cloudStorageService.getCached<
        Record<string, StationLoyaltyConfig>
      >(CLOUD_CONFIG_KEY, stationId);
      const stored =
        cached ||
        loadFromStorage<Record<string, StationLoyaltyConfig>>(
          LOYALTY_CONFIG_KEY,
          {},
        );
      if (!stored[stationId]) {
        stored[stationId] = getDefaultStationConfig(
          stationId,
          `Station ${stationId.slice(0, 4)}`,
        );
        saveToStorage(LOYALTY_CONFIG_KEY, stored);
      }
      return stored;
    },
  );
  const [isLoading, setIsLoading] = useState(false);

  // Echo guard: when state is set FROM the cloud (load or real-time
  // subscription), we must NOT write it straight back to the cloud — that
  // would create a write → realtime-echo → write loop. Each flag is set true
  // immediately before a cloud-originated setState and consumed (reset) by the
  // matching persist effect.
  const skipWrite = useRef({
    customers: false,
    rewards: false,
    transactions: false,
    configs: false,
  });

  // ─── Load from cloud (authoritative) on mount / station change ───
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      const [cloudCust, cloudRew, cloudTxn, cloudCfg] = await Promise.all([
        cloudStorageService.get<unknown>(CLOUD_CUSTOMERS_KEY, stationId),
        cloudStorageService.get<unknown>(CLOUD_REWARDS_KEY, stationId),
        cloudStorageService.get<unknown>(CLOUD_TXNS_KEY, stationId),
        cloudStorageService.get<Record<string, StationLoyaltyConfig>>(
          CLOUD_CONFIG_KEY,
          stationId,
        ),
      ]);
      if (cancelled) return;
      if (cloudCust) {
        skipWrite.current.customers = true;
        setCustomers(normalizeCustomers(cloudCust));
      }
      if (cloudRew && normalizeRewards(cloudRew).length) {
        skipWrite.current.rewards = true;
        setRewards(normalizeRewards(cloudRew));
      }
      if (cloudTxn) {
        skipWrite.current.transactions = true;
        setTransactions(normalizeTxns(cloudTxn));
      }
      if (cloudCfg) {
        if (!cloudCfg[stationId]) {
          cloudCfg[stationId] = getDefaultStationConfig(
            stationId,
            `Station ${stationId.slice(0, 4)}`,
          );
        }
        skipWrite.current.configs = true;
        setConfigs(cloudCfg);
      }
      setIsLoading(false);
    })();
    // Real-time cross-device sync: edits on another device reflect instantly.
    const unsubs = [
      cloudStorageService.subscribe<unknown>(
        CLOUD_CUSTOMERS_KEY,
        stationId,
        (val) => {
          if (val) {
            skipWrite.current.customers = true;
            setCustomers(normalizeCustomers(val));
          }
        },
      ),
      cloudStorageService.subscribe<unknown>(
        CLOUD_REWARDS_KEY,
        stationId,
        (val) => {
          if (val) {
            const arr = normalizeRewards(val);
            if (arr.length) {
              skipWrite.current.rewards = true;
              setRewards(arr);
            }
          }
        },
      ),
      cloudStorageService.subscribe<unknown>(
        CLOUD_TXNS_KEY,
        stationId,
        (val) => {
          if (val) {
            skipWrite.current.transactions = true;
            setTransactions(normalizeTxns(val));
          }
        },
      ),
      cloudStorageService.subscribe<Record<string, StationLoyaltyConfig>>(
        CLOUD_CONFIG_KEY,
        stationId,
        (val) => {
          if (val) {
            skipWrite.current.configs = true;
            setConfigs(val);
          }
        },
      ),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [stationId]);

  // ─── Persist to localStorage cache (instant) + cloud (cross-device) ───
  // Cloud writes are skipped when the state change originated from the cloud
  // (echo guard) to prevent write → realtime-echo → write loops.
  useEffect(() => {
    saveToStorage(LOYALTY_CUSTOMERS_KEY, customers);
    if (skipWrite.current.customers) {
      skipWrite.current.customers = false;
      return;
    }
    cloudStorageService
      .set(CLOUD_CUSTOMERS_KEY, customers, stationId)
      .catch(() => {});
  }, [customers, stationId]);
  useEffect(() => {
    saveToStorage(LOYALTY_REWARDS_KEY, rewards);
    if (skipWrite.current.rewards) {
      skipWrite.current.rewards = false;
      return;
    }
    cloudStorageService
      .set(CLOUD_REWARDS_KEY, rewards, stationId)
      .catch(() => {});
  }, [rewards, stationId]);
  useEffect(() => {
    saveToStorage(LOYALTY_TRANSACTIONS_KEY, transactions);
    if (skipWrite.current.transactions) {
      skipWrite.current.transactions = false;
      return;
    }
    cloudStorageService
      .set(CLOUD_TXNS_KEY, transactions, stationId)
      .catch(() => {});
  }, [transactions, stationId]);
  useEffect(() => {
    saveToStorage(LOYALTY_CONFIG_KEY, configs);
    if (skipWrite.current.configs) {
      skipWrite.current.configs = false;
      return;
    }
    cloudStorageService
      .set(CLOUD_CONFIG_KEY, configs, stationId)
      .catch(() => {});
  }, [configs, stationId]);

  // ─── Station-specific data ───
  const stationCustomers = useMemo(
    () => customers.filter((c) => c.stationId === stationId),
    [customers, stationId],
  );

  const stationRewards = useMemo(
    () => rewards.filter((r) => r.stationId === stationId && r.isActive),
    [rewards, stationId],
  );

  const stationTransactions = useMemo(
    () => transactions.filter((t) => t.stationId === stationId),
    [transactions, stationId],
  );

  const config = useMemo(() => configs[stationId], [configs, stationId]);

  // ─── Stats ───
  const stats: LoyaltyStats = useMemo(() => {
    const stationCusts = stationCustomers.filter(
      (c) => c.cardStatus === "active",
    );
    return {
      stationId,
      totalCustomers: stationCustomers.length,
      activeCustomers: stationCusts.length,
      totalPointsIssued: stationTransactions
        .filter((t) => t.type === "earn")
        .reduce((s, t) => s + t.points, 0),
      totalPointsRedeemed: Math.abs(
        stationTransactions
          .filter((t) => t.type === "redeem")
          .reduce((s, t) => s + t.points, 0),
      ),
      totalRevenue: stationCusts.reduce((s, c) => s + c.totalSpent, 0),
      averageSpend:
        stationCusts.length > 0
          ? stationCusts.reduce((s, c) => s + c.totalSpent, 0) /
            stationCusts.length
          : 0,
      topTierBreakdown: {
        Bronze: stationCusts.filter((c) => c.tier === "Bronze").length,
        Silver: stationCusts.filter((c) => c.tier === "Silver").length,
        Gold: stationCusts.filter((c) => c.tier === "Gold").length,
        Platinum: stationCusts.filter((c) => c.tier === "Platinum").length,
      },
    };
  }, [stationCustomers, stationTransactions, stationId]);

  // ─── Customer Operations ───
  const addCustomer = useCallback(
    (
      data: Omit<
        LoyaltyCustomer,
        | "id"
        | "stationId"
        | "points"
        | "lifetimePoints"
        | "tier"
        | "totalSpent"
        | "totalVisits"
        | "lastVisit"
        | "joinDate"
        | "cardNumber"
        | "cardStatus"
        | "createdAt"
        | "updatedAt"
        | "createdBy"
      >,
      createdBy: string,
    ): LoyaltyCustomer => {
      const stationIndex = parseInt(stationId.slice(0, 2), 16) % 100;
      const customerIndex = stationCustomers.length + 1;

      const newCustomer: LoyaltyCustomer = {
        ...data,
        id: `cust_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        stationId,
        points: 0,
        lifetimePoints: 0,
        tier: "Bronze",
        totalSpent: 0,
        totalVisits: 0,
        lastVisit: "-",
        joinDate: new Date().toISOString().split("T")[0],
        cardNumber: generateCardNumber(stationId, stationIndex, customerIndex),
        cardStatus: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy,
      };

      setCustomers((prev) => [newCustomer, ...prev]);
      return newCustomer;
    },
    [stationId, stationCustomers.length],
  );

  const updateCustomer = useCallback(
    (id: string, updates: Partial<LoyaltyCustomer>) => {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, ...updates, updatedAt: new Date().toISOString() }
            : c,
        ),
      );
    },
    [],
  );

  const deleteCustomer = useCallback((id: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const getCustomer = useCallback(
    (id: string): LoyaltyCustomer | undefined => {
      return customers.find((c) => c.id === id);
    },
    [customers],
  );

  const findCustomerByPhone = useCallback(
    (phone: string): LoyaltyCustomer | undefined => {
      return customers.find(
        (c) => c.phone === phone && c.stationId === stationId,
      );
    },
    [customers, stationId],
  );

  const findCustomerByCard = useCallback(
    (cardNumber: string): LoyaltyCustomer | undefined => {
      return customers.find((c) => c.cardNumber === cardNumber);
    },
    [customers],
  );

  // ─── Points Operations ───
  const earnPoints = useCallback(
    (
      customerId: string,
      saleId: string,
      amount: number,
      liters: number,
      fuelType: string,
      processedBy: string,
    ): LoyaltyTransaction | null => {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer || !config) return null;

      const points = calculatePointsEarned(
        liters,
        amount / liters,
        config,
        customer.tier,
      );
      if (points === 0) return null;

      const newPoints = customer.points + points;
      const newTier = config.autoUpgradeTier
        ? getTierFromPoints(newPoints, config.tierThresholds)
        : customer.tier;
      const tierChanged = newTier !== customer.tier;

      const transaction: LoyaltyTransaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        customerId,
        stationId,
        type: "earn",
        points,
        previousBalance: customer.points,
        newBalance: newPoints,
        saleId,
        amount,
        liters,
        fuelType: fuelType as any,
        description: `Earned ${points} points for ${liters}L of ${fuelType}`,
        processedBy,
        processedAt: new Date().toISOString(),
      };

      // Update customer
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customerId
            ? {
                ...c,
                points: newPoints,
                lifetimePoints: c.lifetimePoints + points,
                tier: newTier,
                totalSpent: c.totalSpent + amount,
                totalVisits: c.totalVisits + 1,
                lastVisit: new Date().toISOString().split("T")[0],
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );

      setTransactions((prev) => [transaction, ...prev]);

      // Trigger notification if tier changed
      if (tierChanged && config.upgradeNotifications) {
        // Could trigger a toast/notification here
        console.log(
          `[Loyalty] Customer ${customer.name} upgraded to ${newTier}!`,
        );
      }

      return transaction;
    },
    [customers, config, stationId],
  );

  const redeemPoints = useCallback(
    (
      customerId: string,
      rewardId: string,
      pointsCost: number,
      processedBy: string,
    ): LoyaltyTransaction | null => {
      const customer = customers.find((c) => c.id === customerId);
      const reward = rewards.find((r) => r.id === rewardId);

      if (!customer || !reward || customer.points < pointsCost) return null;
      if (
        reward.remainingQuantity !== undefined &&
        reward.remainingQuantity <= 0
      )
        return null;

      const transaction: LoyaltyTransaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        customerId,
        stationId,
        type: "redeem",
        points: -pointsCost,
        previousBalance: customer.points,
        newBalance: customer.points - pointsCost,
        description: `Redeemed: ${reward.name}`,
        reference: `RWD-${rewardId.slice(-4)}`,
        processedBy,
        processedAt: new Date().toISOString(),
        rewardId,
        rewardName: reward.name,
      };

      // Update customer
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customerId
            ? {
                ...c,
                points: c.points - pointsCost,
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );

      // Update reward quantity
      if (reward.remainingQuantity !== undefined) {
        setRewards((prev) =>
          prev.map((r) =>
            r.id === rewardId
              ? {
                  ...r,
                  remainingQuantity: r.remainingQuantity! - 1,
                  updatedAt: new Date().toISOString(),
                }
              : r,
          ),
        );
      }

      setTransactions((prev) => [transaction, ...prev]);
      return transaction;
    },
    [customers, rewards, stationId],
  );

  const adjustPoints = useCallback(
    (
      customerId: string,
      points: number,
      reason: string,
      processedBy: string,
    ): LoyaltyTransaction | null => {
      const customer = customers.find((c) => c.id === customerId);
      if (!customer) return null;

      const transaction: LoyaltyTransaction = {
        id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        customerId,
        stationId,
        type: "adjustment",
        points,
        previousBalance: customer.points,
        newBalance: Math.max(0, customer.points + points),
        description: reason,
        processedBy,
        processedAt: new Date().toISOString(),
      };

      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customerId
            ? {
                ...c,
                points: Math.max(0, c.points + points),
                lifetimePoints:
                  points > 0 ? c.lifetimePoints + points : c.lifetimePoints,
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );

      setTransactions((prev) => [transaction, ...prev]);
      return transaction;
    },
    [customers, stationId],
  );

  // ─── Reward Operations ───
  const addReward = useCallback(
    (
      data: Omit<StationReward, "id" | "stationId" | "createdAt" | "updatedAt">,
    ): StationReward => {
      const reward: StationReward = {
        ...data,
        id: `${stationId}_r_${Date.now()}`,
        stationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setRewards((prev) => [reward, ...prev]);
      return reward;
    },
    [stationId],
  );

  const updateReward = useCallback(
    (id: string, updates: Partial<StationReward>) => {
      setRewards((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, ...updates, updatedAt: new Date().toISOString() }
            : r,
        ),
      );
    },
    [],
  );

  const deleteReward = useCallback((id: string) => {
    setRewards((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // ─── Config Operations ───
  const updateConfig = useCallback(
    (updates: Partial<StationLoyaltyConfig>) => {
      setConfigs((prev) => ({
        ...prev,
        [stationId]: {
          ...prev[stationId],
          ...updates,
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [stationId],
  );

  // ─── Export/Import ───
  const exportData = useCallback(() => {
    return {
      customers: stationCustomers,
      rewards: stationRewards,
      transactions: stationTransactions,
      config,
      exportedAt: new Date().toISOString(),
    };
  }, [stationCustomers, stationRewards, stationTransactions, config]);

  const importCustomers = useCallback((data: LoyaltyCustomer[]) => {
    setCustomers((prev) => {
      const existing = new Set(prev.map((c) => c.id));
      const newCustomers = data.filter((c) => !existing.has(c.id));
      return [...newCustomers, ...prev];
    });
  }, []);

  return {
    // Data
    customers: stationCustomers,
    rewards: stationRewards,
    transactions: stationTransactions,
    config,
    stats,
    isLoading,

    // Customer operations
    addCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomer,
    findCustomerByPhone,
    findCustomerByCard,

    // Points operations
    earnPoints,
    redeemPoints,
    adjustPoints,

    // Reward operations
    addReward,
    updateReward,
    deleteReward,

    // Config
    updateConfig,

    // Export/Import
    exportData,
    importCustomers,
  };
}

// ─── Multi-Station Hook ───
export function useAllStationLoyalty() {
  const [allCustomers, setAllCustomers] = useState<LoyaltyCustomer[]>(() =>
    loadFromStorage(LOYALTY_CUSTOMERS_KEY, []),
  );
  const [allRewards, setAllRewards] = useState<StationReward[]>(() =>
    loadFromStorage(LOYALTY_REWARDS_KEY, []),
  );

  const getStationCustomers = useCallback(
    (stationId: string) =>
      allCustomers.filter((c) => c.stationId === stationId),
    [allCustomers],
  );

  const getCustomerStation = useCallback(
    (customerId: string) => {
      const customer = allCustomers.find((c) => c.id === customerId);
      return customer?.stationId;
    },
    [allCustomers],
  );

  return {
    allCustomers,
    allRewards,
    getStationCustomers,
    getCustomerStation,
    setAllCustomers,
    setAllRewards,
  };
}

export default useLoyalty;
