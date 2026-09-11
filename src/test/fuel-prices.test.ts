import { describe, it, expect } from "vitest";
import {
  KENYA_BASE_PRICES,
  KENYA_CITIES,
  DEFAULT_PRICES,
  getClosestKenyaCityPrice,
  getBasePrice,
  getCountryPrice,
} from "@/react-app/config/pricing";

// Official EPRA maximum retail prices, cycle 15 Aug – 14 Sep 2026
// (announced 14 Aug 2026: diesel −KSh5.00; petrol & kerosene unchanged).
const OFFICIAL: Record<string, [number, number, number]> = {
  Nairobi: [214.03, 217.86, 191.38],
  Mombasa: [210.87, 214.58, 188.09],
  Kisumu: [213.69, 218.08, 191.63],
  Nakuru: [212.92, 217.27, 190.81],
  Eldoret: [213.69, 218.09, 191.63],
  Kakamega: [213.43, 217.8, 191.35],
  Nyeri: [215.9, 219.87, 193.38],
  Machakos: [214.07, 217.91, 191.41],
  Meru: [218.67, 222.85, 196.35],
  Lodwar: [220.08, 224.95, 198.5],
  Garissa: [220.4, 224.7, 198.21],
  Malindi: [212.01, 215.81, 189.32],
  Kisii: [214.77, 219.24, 192.78],
  Thika: [213.7, 217.5, 191.02],
  Naivasha: [213.11, 217.47, 191.01],
  Kericho: [214.16, 218.6, 192.14],
  Embu: [215.46, 219.4, 192.91],
  Isiolo: [218.44, 222.59, 196.11],
  Nanyuki: [216.8, 220.83, 194.35],
  Migori: [216.03, 220.61, 194.15],
  Narok: [215.92, 219.89, 193.41],
  Voi: [212.91, 216.77, 190.29],
  Kilifi: [211.68, 215.45, 188.96],
  Moyale: [228.87, 233.8, 207.32],
};

describe("fuel price accuracy (EPRA 15 Aug – 14 Sep 2026)", () => {
  it("base prices match the official current EPRA cycle", () => {
    expect(KENYA_BASE_PRICES.petrol).toBe(214.03);
    expect(KENYA_BASE_PRICES.diesel).toBe(217.86);
    expect(KENYA_BASE_PRICES.kerosene).toBe(191.38);
  });

  it("DEFAULT_PRICES tracks the base prices (no stale duplicates)", () => {
    expect(DEFAULT_PRICES.petrol).toBe(KENYA_BASE_PRICES.petrol);
    expect(DEFAULT_PRICES.diesel).toBe(KENYA_BASE_PRICES.diesel);
    expect(DEFAULT_PRICES.kerosene).toBe(KENYA_BASE_PRICES.kerosene);
  });

  it("every official gazette town matches the published EPRA price", () => {
    for (const [town, [p, d, k]] of Object.entries(OFFICIAL)) {
      const row = KENYA_CITIES.find((c) => c.name === town);
      expect(row, `missing town ${town}`).toBeDefined();
      expect(row!.petrolPrice, `${town} petrol`).toBeCloseTo(p, 2);
      expect(row!.dieselPrice, `${town} diesel`).toBeCloseTo(d, 2);
      expect(row!.kerosenePrice, `${town} kerosene`).toBeCloseTo(k, 2);
    }
  });

  it("has no duplicate town names (Mombasa was listed twice)", () => {
    const names = KENYA_CITIES.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("Mlimani (Dar es Salaam, Tanzania) is not in the Kenya table", () => {
    expect(KENYA_CITIES.find((c) => c.name === "Mlimani")).toBeUndefined();
  });

  it("GPS nearest-city lookup returns the official town price", () => {
    const lodwar = getClosestKenyaCityPrice(3.1219, 35.5972);
    expect(lodwar.name).toBe("Lodwar");
    expect(lodwar.dieselPrice).toBeCloseTo(224.95, 2);
    const nairobi = getClosestKenyaCityPrice(-1.2864, 36.8172);
    expect(nairobi.name).toBe("Nairobi");
    expect(nairobi.dieselPrice).toBeCloseTo(217.86, 2);
  });

  it("non-Kenya countries never resolve to Kenyan KSh prices", () => {
    const us = getCountryPrice("US", "petrol");
    expect(us.currency).not.toBe("KES");
    expect(us.price).toBeGreaterThan(0.5);
    expect(us.price).toBeLessThan(3);
  });

  it("getBasePrice resolves canonical Kenya fuel prices", () => {
    expect(getBasePrice("petrol")).toBe(214.03);
    expect(getBasePrice("diesel")).toBe(217.86);
    expect(getBasePrice("kerosene")).toBe(191.38);
  });
});
