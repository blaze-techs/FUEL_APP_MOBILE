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
- Supplier - 100
- Generator - 10 x 224.95
= 2,249
- Till - 55,970
- Cash - 24,501
`;
    const result = extractSalesSheetFromText(input);
    expect(result.date).toBe("2026-09-27");
    expect(result.pumps).toHaveLength(2);
    expect(result.confidence).toBe("high");
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
  });

  it("recognizes the supplied four-pump page as HIGH confidence even when the header/date is cropped", () => {
    const input = `
65 021 771.32 - 458 624.82
64 951 701.59 - 454 308.42
70,069.73
224 811 189.12 - 1 613 953.17
224 768 817.57 - 1 613 764.89
42,371.55
56 527 663.91 - 419 602.94
56 527 663.91 - 419 602.94
0
170 511 109.82 - 1 195 253.11
170 476 867.19 - 1 195 098.32
34,242.63
Total sales = 146,683.91
`;
    const result = extractSalesSheetFromText(input);
    expect(result.confidence).toBe("high");
    expect(result.pumps).toHaveLength(4);
    expect(result.totalSales).toBeCloseTo(146683.91, 2);
    expect(result.pumps.map((p) => p.salesAmount)).toEqual([
      70069.73, 42371.55, 0, 34242.63,
    ]);
  });

  it("retains a near-matching pump instead of dropping it, but correctly prevents HIGH confidence", () => {
    const input = `
65 255 390.88 - 455 679.72
65 192 537.89 - 455 396.12
62,852.99
225 097 950.18 - 1 615 227.66
224 939 860.80 - 1 614 525.01
158,089.98
56 614 580.26 - 419 989.30
56 531 663.91 - 419 620.74
82,916.35
170 571 428.05 - 1 195 525.96
170 545 537.94 - 1 195 408.72
25,890.11
Total sales = 329,749.43
`;
    const result = extractSalesSheetFromText(input);
    expect(result.confidence).toBe("medium");
    expect(result.pumps).toHaveLength(4);
    expect(result.totalSales).toBeCloseTo(329749.43, 2);
    expect(result.pumps.map((p) => p.salesAmount)).toEqual([
      62852.99, 158089.98, 82916.35, 25890.11,
    ]);
    expect(result.pumps[1].confidence).toBe("medium");
    expect(result.notes.some((n) => n.includes("0.60"))).toBe(true);
  });

  it("does not create a pump when a reading is only a single line", () => {
    const result = extractSalesSheetFromText(
      "27/09/2026\n65 941 844.05 - 458 782.50",
    );
    expect(result.pumps).toHaveLength(0);
  });
});
