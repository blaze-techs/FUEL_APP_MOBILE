import { describe, expect, it } from "vitest";
import { analyzePumpPriceIntegrity } from "@/react-app/lib/pump-price-integrity";

describe("pump price integrity", () => {
  it("flags a pump that differs from the station-configured price", () => {
    const result = analyzePumpPriceIntegrity(
      [
        {
          pump_id: "P1",
          fuel_name: "Petrol",
          unit_price: 220.08,
          total_sales_litres: 100,
          total_sales_value: 22008,
        },
      ],
      new Map([["petrol", 220.18]]),
    );

    expect(result.valid).toBe(false);
    expect(result.incorrectPumps).toBe(1);
    expect(result.issues[0].code).toBe("configured_price_mismatch");
  });

  it("does not impose a static/regulator price when the station has no configured price", () => {
    const result = analyzePumpPriceIntegrity([
      {
        pump_id: "P1",
        fuel_name: "Petrol",
        unit_price: 220.08,
        total_sales_litres: 100,
        total_sales_value: 22008,
      },
    ]);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("detects a mathematically inconsistent unit price from litres and sales value", () => {
    const result = analyzePumpPriceIntegrity([
      {
        pump_id: "P2",
        fuel_name: "Diesel",
        unit_price: 229.95,
        total_sales_litres: 100,
        total_sales_value: 22000,
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "sales_value_price_mismatch")).toBe(true);
    expect(result.issues.some((i) => i.expectedPrice === 220)).toBe(true);
  });

  it("detects conflicting prices between pumps selling the same fuel", () => {
    const result = analyzePumpPriceIntegrity([
      {
        pump_id: "P1",
        fuel_name: "PMS",
        unit_price: 220.08,
        total_sales_litres: 100,
        total_sales_value: 22008,
      },
      {
        pump_id: "P2",
        fuel_name: "Petrol",
        unit_price: 221.08,
        total_sales_litres: 100,
        total_sales_value: 22108,
      },
    ]);

    expect(result.warnings.some((w) => w.includes("P2"))).toBe(true);
  });

  it("rejects missing, zero and non-finite prices", () => {
    const result = analyzePumpPriceIntegrity([
      { pump_id: "P1", fuel_name: "Petrol", unit_price: 0 },
      { pump_id: "P2", fuel_name: "Diesel", unit_price: Number.NaN },
    ]);

    expect(result.valid).toBe(false);
    expect(result.incorrectPumps).toBe(2);
  });
});
