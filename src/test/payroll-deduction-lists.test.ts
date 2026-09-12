import { describe, it, expect } from "vitest";
import {
  buildCustomDeductionListSheets,
  sanitizeSheetName,
  type DeductionType,
} from "@/react-app/lib/payroll-deductions";

const RESERVED = [
  "Payroll Payment",
  "Cash Payments",
  "SHA List",
  "NSSF List",
  "CPC Centralized",
];

const EMP = (
  name: string,
  basicSalary: number,
  customDeductions: {
    typeId: string;
    amount: number;
    mode?: "fixed" | "percent";
  }[] = [],
) => ({ fullName: name, idNo: "12345678", basicSalary, customDeductions });

describe("sanitizeSheetName", () => {
  it("appends ' List' and strips Excel-forbidden characters", () => {
    const used = new Set<string>();
    expect(sanitizeSheetName("Union Dues", used)).toBe("Union Dues List");
    expect(sanitizeSheetName("A/B:C*D?E[F]G\\H", used)).toBe(
      "A B C D E F G H List",
    );
  });

  it("truncates to Excel's 31-char limit and dedupes collisions", () => {
    const used = new Set(RESERVED);
    const long = "A Very Long Deduction Label Here Indeed";
    const first = sanitizeSheetName(long, used);
    const second = sanitizeSheetName(long, used);
    expect(first.length).toBeLessThanOrEqual(31);
    expect(second.length).toBeLessThanOrEqual(31);
    expect(first).not.toBe(second);
    expect(second).toContain("(2)");
  });

  it("dedupes against reserved sheet names", () => {
    const used = new Set(RESERVED);
    // A custom deduction literally labelled "SHA" must not collide with the
    // statutory "SHA List" sheet.
    expect(sanitizeSheetName("SHA", used)).toBe("SHA List (2)");
  });
});

describe("buildCustomDeductionListSheets", () => {
  const types: DeductionType[] = [
    { id: "helb", label: "HELB Loan" },
    { id: "union", label: "Union Dues" },
    { id: "pct", label: "Sacco", calcMode: "percent", percentRate: 5 },
  ];

  it("emits one sheet per custom type, contributors only", () => {
    const employees = [
      EMP("John Mwangi", 45000, [
        { typeId: "helb", amount: 1000 },
        { typeId: "union", amount: 0 }, // zero => excluded
      ]),
      EMP("Sarah Wanjiku", 85000, [{ typeId: "helb", amount: 2500 }]),
      EMP("Obadiah Ekal", 8000, []), // no entries at all => excluded
    ];
    const sheets = buildCustomDeductionListSheets(employees, types, RESERVED);
    const byName = Object.fromEntries(sheets.map((s) => [s.sheetName, s]));

    // HELB: 2 contributors.
    expect(byName["HELB Loan List"].rows).toEqual([
      [1, "JOHN MWANGI", "12345678", 45000, 1000],
      [2, "SARAH WANJIKU", "12345678", 85000, 2500],
    ]);
    expect(byName["HELB Loan List"].totalBasic).toBe(130000);
    expect(byName["HELB Loan List"].totalAmount).toBe(3500);

    // Union Dues: everyone is 0/absent => NO sheet at all.
    expect(byName["Union Dues List"]).toBeUndefined();

    // Sacco (percent type with no per-employee entries) => no contributors.
    expect(byName["Sacco List"]).toBeUndefined();
  });

  it("resolves percent-mode per-employee overrides against basic salary", () => {
    const employees = [
      EMP("Anna Moit", 10000, [{ typeId: "pct", amount: 10, mode: "percent" }]),
    ];
    const sheets = buildCustomDeductionListSheets(employees, types, RESERVED);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].sheetName).toBe("Sacco List");
    expect(sheets[0].rows[0][4]).toBe(1000); // 10% of 10,000
  });

  it("returns an empty array when no types exist", () => {
    expect(
      buildCustomDeductionListSheets([EMP("A B", 1000)], [], RESERVED),
    ).toEqual([]);
  });
});
