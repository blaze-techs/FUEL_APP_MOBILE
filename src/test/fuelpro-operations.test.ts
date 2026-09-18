import { describe, expect, it } from "vitest";
import { calculateFuelReconciliation } from "@/react-app/lib/fuelpro-operations";

describe("FuelPro reconciliation engine", () => {
  it("calculates litres and expected sales from increasing meter readings", () => {
    expect(
      calculateFuelReconciliation(1490000.04, 1490454.57, 220.08),
    ).toMatchObject({
      litresSold: 454.53,
      expectedSales: 100032.96,
      status: "pending",
    });
  });

  it("rejects a closing meter below opening meter", () => {
    expect(() => calculateFuelReconciliation(1000, 999, 200)).toThrow();
  });

  it("flags a monetary variance", () => {
    const r = calculateFuelReconciliation(100, 150, 220, 10800);
    expect(r.litresSold).toBe(50);
    expect(r.expectedSales).toBe(11000);
    expect(r.varianceAmount).toBe(-200);
    expect(r.status).toBe("variance");
  });

  it("marks an exact reconciliation as balanced", () => {
    expect(calculateFuelReconciliation(100, 150, 220, 11000).status).toBe(
      "balanced",
    );
  });
});
