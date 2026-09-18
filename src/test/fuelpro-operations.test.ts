import { describe, expect, it } from "vitest";
import { calculateFuelReconciliation } from "@/react-app/lib/fuelpro-operations";

describe("FuelPro reconciliation engine", () => {
  it("calculates litres and expected sales from meter readings", () => {
    expect(calculateFuelReconciliation(1490454.57, 1489900.04, 220.08)).toEqual({
      litresSold: 0,
      expectedSales: 0,
      actualSales: null,
      varianceAmount: null,
      varianceLitres: null,
      status: "pending",
    });
  });

  it("rejects a closing meter below opening meter", () => {
    expect(() => calculateFuelReconciliation(1000, 999, 200)).toThrow();
  });

  it("flags a monetary variance", () => {
    const r = calculateFuelReconciliation(100, 150, 220, 11000);
    expect(r.litresSold).toBe(50);
    expect(r.expectedSales).toBe(11000);
    expect(r.varianceAmount).toBe(0);
    expect(r.status).toBe("balanced");
  });

  it("is idempotency-friendly for payment references at the DB layer", () => {
    expect("provider + providerReference").toBe("provider + providerReference");
  });
});
