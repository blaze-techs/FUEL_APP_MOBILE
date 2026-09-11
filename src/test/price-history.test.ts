import { describe, it, expect, beforeEach } from "vitest";

// In-memory cloud storage stub — recordPriceChange reads/writes via
// cloudStorageService, so we back it with a Map for deterministic tests.
const store = new Map<string, unknown>();

vi.mock("@/react-app/lib/cloud-storage-service", () => ({
  default: {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T) ?? null;
    },
    async set(key: string, value: unknown): Promise<void> {
      store.set(key, value);
    },
  },
}));

import { vi } from "vitest";
import {
  recordPriceChange,
  PRICE_HISTORY_KEY,
  type PriceChangeRecord,
} from "@/react-app/lib/price-history";

function history(): PriceChangeRecord[] {
  return (store.get(PRICE_HISTORY_KEY) as PriceChangeRecord[]) || [];
}

describe("recordPriceChange", () => {
  beforeEach(() => {
    store.clear();
  });

  it("appends a record with legacy aliases for FuelRateHistory", async () => {
    await recordPriceChange({
      fuelType: "Super Petrol",
      oldPrice: 214.03,
      newPrice: 220.0,
      changedBy: "Fuel Type Manager",
    });
    const h = history();
    expect(h).toHaveLength(1);
    expect(h[0].fuelType).toBe("Super Petrol");
    expect(h[0].label).toBe("Super Petrol");
    expect(h[0].oldPrice).toBeCloseTo(214.03);
    expect(h[0].newPrice).toBe(220.0);
    expect(h[0].price).toBe(220.0); // legacy alias
    expect(h[0].changedBy).toBe("Fuel Type Manager");
    expect(h[0].changedAt).toBeTruthy();
    expect(h[0].date).toBe(h[0].changedAt); // legacy alias
  });

  it("is a no-op when the price did not change", async () => {
    await recordPriceChange({
      fuelType: "Diesel",
      oldPrice: 217.86,
      newPrice: 217.86,
      changedBy: "X",
    });
    expect(history()).toHaveLength(0);
  });

  it("rejects invalid prices", async () => {
    await recordPriceChange({
      fuelType: "Diesel",
      oldPrice: 100,
      newPrice: 0,
      changedBy: "X",
    });
    await recordPriceChange({
      fuelType: "Diesel",
      oldPrice: 100,
      newPrice: NaN,
      changedBy: "X",
    });
    expect(history()).toHaveLength(0);
  });

  it("dedupes the same logical change within the window (double-caller path)", async () => {
    const input = {
      fuelType: "Super Petrol",
      oldPrice: 200,
      newPrice: 210,
      changedBy: "PriceBoard",
    };
    await recordPriceChange(input);
    await recordPriceChange(input); // e.g. PriceBoard + syncPriceToFuelTypes
    expect(history()).toHaveLength(1);
  });

  it("records a genuinely different change right after", async () => {
    await recordPriceChange({
      fuelType: "Kerosene",
      oldPrice: 190,
      newPrice: 195,
      changedBy: "A",
    });
    await recordPriceChange({
      fuelType: "Kerosene",
      oldPrice: 195,
      newPrice: 199,
      changedBy: "B",
    });
    expect(history()).toHaveLength(2);
    // Newest first
    expect(history()[0].newPrice).toBe(199);
    expect(history()[1].newPrice).toBe(195);
  });

  it("caps the trail at 500 entries", async () => {
    const seed: PriceChangeRecord[] = Array.from({ length: 500 }, (_, i) => ({
      id: `old_${i}`,
      fuelType: "Diesel",
      label: "Diesel",
      oldPrice: i,
      newPrice: i + 1,
      changedBy: "seed",
      reason: "seed",
      changedAt: new Date(2020, 0, 1).toISOString(),
    }));
    store.set(PRICE_HISTORY_KEY, seed);
    await recordPriceChange({
      fuelType: "Kerosene",
      oldPrice: 100,
      newPrice: 101,
      changedBy: "new",
    });
    expect(history()).toHaveLength(500);
    expect(history()[0].changedBy).toBe("new");
  });
});
