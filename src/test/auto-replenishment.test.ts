import { describe, it, expect } from "vitest";
import { computeReplenishmentSuggestions } from "@/react-app/lib/auto-replenishment";
import type { TankReading } from "@/react-app/lib/forecourt-features";

function reading(
  fuelType: string,
  date: string,
  expected: number,
  measured: number,
  label = fuelType,
): TankReading {
  const variance = measured - expected;
  return {
    id: `${fuelType}-${date}`,
    fuelType,
    label,
    date,
    measuredLevel: measured,
    expectedLevel: expected,
    variance,
    variancePct: expected > 0 ? (variance / expected) * 100 : 0,
    status: "ok",
  };
}

describe("computeReplenishmentSuggestions (Shell eVMI)", () => {
  it("returns [] when there are no readings", () => {
    expect(computeReplenishmentSuggestions([])).toEqual([]);
  });

  it("computes avg daily usage from expected-level draw-downs", () => {
    // 10 days span: 20000 -> 17000 = 3000 L used over 10 days => 300 L/day
    const readings = [
      reading("petrol", "2026-08-22", 20000, 20000),
      reading("petrol", "2026-09-01", 17000, 5000, "Super Petrol"),
    ];
    const [s] = computeReplenishmentSuggestions(readings, 7);
    expect(s.avgDailyUsage).toBeCloseTo(300);
    expect(s.label).toBe("Super Petrol");
  });

  it("flags reorder when days-to-empty <= target days cover", () => {
    const readings = [
      reading("diesel", "2026-08-25", 10000, 10000),
      reading("diesel", "2026-09-01", 6500, 2100), // 500/day, 7 days span
    ];
    const [s] = computeReplenishmentSuggestions(readings, 7);
    // 2100 L / 500 L/day = 4.2 days left <= 7 target => reorder
    expect(s.status).toBe("reorder");
    // suggested = ceil(7 * 500 - 2100) = 1400
    expect(s.suggestedQty).toBe(1400);
  });

  it("flags critical when days-to-empty <= 1", () => {
    const readings = [
      reading("petrol", "2026-08-31", 1000, 1000),
      reading("petrol", "2026-09-01", 500, 200), // 500/day
    ];
    const [s] = computeReplenishmentSuggestions(readings, 7);
    expect(s.status).toBe("critical");
  });

  it("keeps ok when there is no usage or plenty of cover", () => {
    const noUsage = [
      reading("lpg", "2026-08-25", 5000, 5000),
      reading("lpg", "2026-09-01", 5000, 5000),
    ];
    expect(computeReplenishmentSuggestions(noUsage)[0].status).toBe("ok");

    const plenty = [
      reading("lpg", "2026-08-31", 5000, 5000),
      reading("lpg", "2026-09-01", 4900, 4900), // 100/day, 49 days cover
    ];
    expect(computeReplenishmentSuggestions(plenty, 7)[0].status).toBe("ok");
  });

  it("never suggests a negative quantity", () => {
    const readings = [
      reading("diesel", "2026-08-31", 5000, 5000),
      reading("diesel", "2026-09-01", 4900, 50000), // stock exceeds cover
    ];
    const [s] = computeReplenishmentSuggestions(readings, 7);
    expect(s.suggestedQty).toBe(0);
  });

  it("groups by fuel type independently", () => {
    const readings = [
      reading("petrol", "2026-08-31", 1000, 1000),
      reading("petrol", "2026-09-01", 500, 200),
      reading("diesel", "2026-08-31", 5000, 5000),
      reading("diesel", "2026-09-01", 4950, 4950),
    ];
    const out = computeReplenishmentSuggestions(readings, 7);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.fuelType === "petrol")?.status).toBe("critical");
    expect(out.find((s) => s.fuelType === "diesel")?.status).toBe("ok");
  });
});
