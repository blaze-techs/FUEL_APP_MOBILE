import { describe, expect, it } from "vitest";
import { extractSalesSheetFromText } from "./sales-scan-parser";

describe("handwritten fuel sales scan parser", () => {
  it("extracts the two pump readings and exact totals from the 27/09 sample", () => {
    const input = `
27/09/2026

65 941 844.05 - 458 782.50
65 878 268.25 - 458 495.42
63,575.8

225 490 326.37 - 1 616 974.43
225 471 081.62 - 1 616 885.92
19,244.75

Total sales = 82,820.55

Expenses:
- Supplier - 100
- Generator - 10 x 224.95
= 2,249
- Till - 55,970
- Cash - 24,501

Petrol - 4100
Diesel - 1700
`;

    const result = extractSalesSheetFromText(input);

    expect(result.date).toBe("2026-09-27");
    expect(result.pumps).toHaveLength(2);

    expect(result.pumps[0].openingReading).toBeCloseTo(65941844.05, 2);
    expect(result.pumps[0].closingReading).toBeCloseTo(65878268.25, 2);
    expect(result.pumps[0].openingLitres).toBeCloseTo(458782.5, 2);
    expect(result.pumps[0].closingLitres).toBeCloseTo(458495.42, 2);
    expect(result.pumps[0].salesAmount).toBeCloseTo(63575.8, 2);
    expect(result.pumps[0].salesLitres).toBeCloseTo(287.08, 2);

    expect(result.pumps[1].openingReading).toBeCloseTo(225490326.37, 2);
    expect(result.pumps[1].closingReading).toBeCloseTo(225471081.62, 2);
    expect(result.pumps[1].openingLitres).toBeCloseTo(1616974.43, 2);
    expect(result.pumps[1].closingLitres).toBeCloseTo(1616885.92, 2);
    expect(result.pumps[1].salesAmount).toBeCloseTo(19244.75, 2);
    expect(result.pumps[1].salesLitres).toBeCloseTo(88.51, 2);

    expect(result.totalSales).toBeCloseTo(82820.55, 2);
    expect(result.tillAmount).toBe(55970);
    expect(result.cashAmount).toBe(24501);
    expect(result.expenses.map(x => x.amount)).toEqual(expect.arrayContaining([100, 2249]));
  });

  it("does not create a pump when a reading is only a single line", () => {
    const result = extractSalesSheetFromText("27/09/2026\n65 941 844.05 - 458 782.50");
    expect(result.pumps).toHaveLength(0);
  });
});
