import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseShiftReconciliationWorkbook } from "../shift-reconciliation-workbook";

function makeWorkbookFile(): File {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Shift", "Total Sales (Ksh)", "Till (Ksh)", "Deductions & Credit (Ksh)", "Expenses & Credit Descriptions", "Reported Cash (Ksh)", "Variance (Ksh)", "SMS timestamp", "Audit flags"],
      ["13 Nov 2025 Day", 180610.22, 48079, 84604, "Lunch: 200\nCustomer credit: 1,000", 47927, -0.22, "2025-11-13 17:23:52", "Reconciliation variance"],
    ]),
    "Latest per shift",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Shift", "Total Sales (Ksh)", "Till (Ksh)", "Deductions & Credit (Ksh)", "Expenses & Credit Descriptions", "Reported Cash (Ksh)", "Variance (Ksh)", "SMS timestamp", "Audit flags", "Full original message"],
      ["13 Nov 2025 Day", 180610.22, 48079, 84604, "Lunch: 200", 47927, -0.22, "2025-11-13 17:22:54", "", "13th Nov 2025 DAY\nSales: 180,610.22"],
    ]),
    "All source versions",
  );
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return {
    name: "Shift_Sales_Reconciliation_Complete.xlsx",
    arrayBuffer: async () => bytes,
  } as unknown as File;
}

describe("parseShiftReconciliationWorkbook", () => {
  it("defaults to Latest per shift and maps reconciliation columns without pump assumptions", async () => {
    const parsed = await parseShiftReconciliationWorkbook(makeWorkbookFile());
    expect(parsed.selectedSheet).toBe("Latest per shift");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      date: "2025-11-13",
      shift: "Day",
      totalSales: 180610.22,
      till: 48079,
      deductionsAndCredit: 84604,
      reportedCash: 47927,
      variance: -0.22,
      sourceSheet: "Latest per shift",
    });
    expect(parsed.rows[0].expensesAndCreditDescriptions).toContain("Customer credit");
  });

  it("allows selecting the source-version sheet and preserves the original SMS", async () => {
    const parsed = await parseShiftReconciliationWorkbook(makeWorkbookFile(), "All source versions");
    expect(parsed.selectedSheet).toBe("All source versions");
    expect(parsed.rows[0].originalMessage).toContain("13th Nov 2025 DAY");
    expect(parsed.rows[0].smsTimestamp).toBe("2025-11-13 17:22:54");
  });

  it("rejects workbooks without a recognisable reconciliation sheet", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Name", "Amount"], ["Fuel", 100]]), "Sheet1");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = { name: "wrong.xlsx", arrayBuffer: async () => bytes } as File;
    await expect(parseShiftReconciliationWorkbook(file)).rejects.toThrow("No sheet with recognisable");
  });
});
