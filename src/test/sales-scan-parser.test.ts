import { describe, it, expect } from "vitest";
import { extractSalesSheetFromText } from "@/react-app/lib/sales-scan-parser";

describe("extractSalesSheetFromText", () => {
  it("does not crash when a cash label is written without a value", () => {
    // Regression: the un-grouped /cash|cach/ label made the trailing \b bind
    // to only the last alternative, so "Cash" matched without capturing a
    // number and the whole scan threw.
    const r = extractSalesSheetFromText("Cash: 24,501");
    expect(r.cashAmount).toBe(24501);
    expect(r.pumps).toHaveLength(0);
    expect(r.confidence).toBe("medium");
  });

  it("extracts pumps, prices, tank dips and totals from a handwritten block", () => {
    const text = `
27/09/2026
65 941 844.05 - 458 782.50
65 878 268.25 - 458 495.42
63,575.8
225 490 326.37 - 1 616 974.43
225 471 081.62 - 1 616 885.92
19,244.75
PMS Price: 220.08 /L
Diesel Price: 224.95 per litre
PMS Tank Opening 458 782.50 Closing 458 495.42
Till - 55,970
Cash - 24,501
Total sales = 82,820.55
`;
    const r = extractSalesSheetFromText(text);
    expect(r.pumps).toHaveLength(2);
    expect(r.confidence).toBe("high");
    expect(r.pumps.map((p) => p.salesAmount)).toEqual([63575.8, 19244.75]);
    expect(r.pumps[0].salesLitres).toBeCloseTo(287.08, 2);
    expect(r.fuelPricing).toEqual({ petrol: 220.08, diesel: 224.95 });
    expect(r.tanks).toEqual([
      { fuelType: "petrol", opening: 458782.5, closing: 458495.42 },
    ]);
    expect(r.tillAmount).toBe(55970);
    expect(r.cashAmount).toBe(24501);
    expect(r.totalSales).toBeCloseTo(82820.55, 2);
  });

  it("supports fuel names beyond petrol/diesel (kerosene/lpg)", () => {
    const text = `
Sales Sheet 4 Sept 2026
IK-1 Kerosene 5000 5120 120
LPG-1 LPG 200 260 60
Total Sales: 180
`;
    const r = extractSalesSheetFromText(text);
    expect(r.pumps.map((p) => p.fuelType)).toEqual(["kerosene", "lpg"]);
    expect(r.pumps.map((p) => p.salesAmount)).toEqual([120, 60]);
    expect(r.confidence).not.toBe("low");
  });

  it("captures expenses, including computed formulas, till and cash", () => {
    const text = `
27/09/2026
- Supplier - 100
- Generator - 10 x 224.95
= 2,249
- Till - 55,970
- Cash - 24,501
`;
    const r = extractSalesSheetFromText(text);
    expect(r.expenses).toEqual([
      { name: "Supplier", amount: 100 },
      { name: "Generator", amount: 2249 },
    ]);
    expect(r.tillAmount).toBe(55970);
    expect(r.cashAmount).toBe(24501);
  });

  it("returns low confidence + honest notes for unreadable scans", () => {
    const r = extractSalesSheetFromText("~~~ garbled ### nothing useful ~~~");
    expect(r.pumps).toHaveLength(0);
    expect(r.confidence).toBe("low");
    expect(r.notes.join(" ")).toMatch(/unreadable meter data/i);
  });

  it("never treats a pump reading line as a fuel price", () => {
    const text = `
27/09/2026
65 941 844.05 - 458 782.50
65 878 268.25 - 458 495.42
63,575.8
`;
    const r = extractSalesSheetFromText(text);
    expect(r.fuelPricing).toEqual({});
  });
});
