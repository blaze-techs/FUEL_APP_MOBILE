import { describe, it, expect } from "vitest";
import { extractSalesSheetFromText } from "@/react-app/lib/sales-scan-parser";

describe("extractSalesSheetFromText", () => {
  it("parses a typical labelled daily sales sheet", () => {
    const text = `
DAILY SALES REPORT
Date: 04/09/2026 Shift: Day
Pump Product Opening Closing Sales
PMS-1 Super Petrol 12045.5 12340.0 62,000
PMS-2 Super Petrol 9800.0 10050.0 53,000
AGO-1 Diesel 8021.0 8300.0 58,500
EXPENSES
Fuel 2,000
Lunch 500
Till/M-PESA: 45,000
Cash: 78,500
Total Sales: 173,500
`;
    const r = extractSalesSheetFromText(text);
    expect(r.date).toBe("2026-09-04");
    expect(r.shift).toBe("Day");
    expect(r.pumps).toHaveLength(3);
    expect(r.pumps[0]).toMatchObject({
      name: "PMS-1",
      fuelType: "petrol",
      openingReading: 12045.5,
      closingReading: 12340.0,
      salesAmount: 62000,
    });
    expect(r.pumps[2].fuelType).toBe("diesel");
    expect(r.expenses).toEqual([
      { name: "Fuel", amount: 2000 },
      { name: "Lunch", amount: 500 },
    ]);
    expect(r.tillAmount).toBe(45000);
    expect(r.cashAmount).toBe(78500);
    expect(r.totalSales).toBe(173500);
    expect(r.confidence).toBe("high");
  });

  it("handles OCR digit confusions and colon separators", () => {
    const text = `
DAILY SALES - 04.09.2026
PMS-1 12O45 12340 62000
AGO-1 802l 8300 58500
Mpesa : 45,000
Cash : 78,500
`;
    const r = extractSalesSheetFromText(text);
    expect(r.date).toBe("2026-09-04");
    expect(r.pumps).toHaveLength(2);
    expect(r.pumps[0].openingReading).toBe(12045);
    expect(r.pumps[1].openingReading).toBe(8021);
    expect(r.tillAmount).toBe(45000);
    expect(r.cashAmount).toBe(78500);
  });

  it("supports fuel names beyond petrol/diesel (kerosene/lpg)", () => {
    const text = `
Sales Sheet 4 Sept 2026
IK-1 Kerosene 5000 5120 14400
LPG-1 LPG 200 260 7200
Total Sales: 21,600
`;
    const r = extractSalesSheetFromText(text);
    expect(r.pumps.map((p) => p.fuelType)).toEqual(["kerosene", "lpg"]);
    expect(r.totalSales).toBe(21600);
    expect(r.confidence).not.toBe("low");
  });

  it("returns low confidence + honest notes for unreadable scans", () => {
    const r = extractSalesSheetFromText("~~~ garbled ### nothing useful ~~~");
    expect(r.pumps).toHaveLength(0);
    expect(r.confidence).toBe("low");
    expect(r.notes.join(" ")).toMatch(/enter readings manually/i);
  });

  it("ignores closing < opening rows (not meter pairs)", () => {
    const text = `
PMS-1 12340 12045 62000
`;
    const r = extractSalesSheetFromText(text);
    expect(r.pumps).toHaveLength(0);
  });
});
