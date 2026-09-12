import { describe, it, expect } from "vitest";
import {
  buildPayslipRecord,
  filterPayslipRecords,
  payrollPeriodKey,
  payrollPeriodLabel,
  payslipRecordId,
  payslipRecordYears,
  upsertPayslipRecord,
  PAYSLIP_RECORDS_CAP,
  type PayslipRecord,
} from "@/react-app/lib/payslip-records";

const sampleInput = {
  employeeId: "EMP-001",
  employeeName: "John Mwangi",
  month: 8,
  year: 2026,
  grossPay: 45000,
  totalDeductions: 1237.5,
  netPay: 43762.5,
  source: "export" as const,
  employee: { fullName: "John Mwangi", basicSalary: 45000, netPay: 43762.5 },
};

describe("payrollPeriodLabel / payrollPeriodKey (settings-driven period)", () => {
  it("uses the SETTINGS month/year, not the current date", () => {
    // The bug this guards: sending in September for an August payroll must
    // say "August 2026", never the current month.
    expect(payrollPeriodLabel(8, 2026)).toBe("August 2026");
    expect(payrollPeriodLabel(9, 2026)).toBe("September 2026");
    expect(payrollPeriodKey(8, 2026)).toBe("2026-08");
    expect(payrollPeriodKey(1, 2027)).toBe("2027-01");
  });

  it("clamps invalid months", () => {
    expect(payrollPeriodKey(0, 2026)).toBe("2026-01");
    expect(payrollPeriodKey(13, 2026)).toBe("2026-12");
    expect(payrollPeriodLabel(NaN, 2026)).toBe("January 2026");
  });
});

describe("buildPayslipRecord", () => {
  it("builds a stable id from employee + period", () => {
    const r = buildPayslipRecord(sampleInput);
    expect(r.id).toBe(payslipRecordId("EMP-001", "2026-08"));
    expect(r.periodLabel).toBe("August 2026");
    expect(r.periodKey).toBe("2026-08");
    expect(r.employee.basicSalary).toBe(45000);
  });
});

describe("upsertPayslipRecord", () => {
  it("adds new records newest-first", () => {
    const a = buildPayslipRecord(sampleInput);
    const b = buildPayslipRecord({
      ...sampleInput,
      employeeId: "EMP-002",
      employeeName: "Sarah Wanjiku",
      month: 9,
    });
    const list = upsertPayslipRecord(upsertPayslipRecord([], a), b);
    expect(list).toHaveLength(2);
    expect(list[0].generatedAt >= list[1].generatedAt).toBe(true);
  });

  it("re-regeneration of the same (employee, period) replaces, not duplicates", () => {
    const a = buildPayslipRecord(sampleInput);
    const again = buildPayslipRecord({
      ...sampleInput,
      source: "send",
      netPay: 43000,
    });
    const list = upsertPayslipRecord(upsertPayslipRecord([], a), again);
    expect(list).toHaveLength(1);
    expect(list[0].netPay).toBe(43000);
    expect(list[0].source).toBe("send");
  });

  it("respects the cap", () => {
    let list: PayslipRecord[] = [];
    for (let i = 0; i < PAYSLIP_RECORDS_CAP + 50; i++) {
      list = upsertPayslipRecord(
        list,
        buildPayslipRecord({
          ...sampleInput,
          employeeId: `EMP-${i}`,
        }),
      );
    }
    expect(list).toHaveLength(PAYSLIP_RECORDS_CAP);
  });
});

describe("filterPayslipRecords", () => {
  const records: PayslipRecord[] = [
    buildPayslipRecord(sampleInput),
    buildPayslipRecord({
      ...sampleInput,
      employeeId: "EMP-002",
      employeeName: "Sarah Wanjiku",
      month: 9,
    }),
    buildPayslipRecord({
      ...sampleInput,
      employeeId: "EMP-003",
      employeeName: "Peter Otieno",
      year: 2025,
      month: 12,
    }),
  ];

  it("filters by month + year", () => {
    expect(filterPayslipRecords(records, { month: 8 })).toHaveLength(1);
    expect(filterPayslipRecords(records, { year: 2026 })).toHaveLength(2);
    expect(
      filterPayslipRecords(records, { month: 12, year: 2025 }),
    ).toHaveLength(1);
    expect(filterPayslipRecords(records, {})).toHaveLength(3);
  });

  it("searches by employee name, id and period label", () => {
    expect(
      filterPayslipRecords(records, { search: "sarah" })[0].employeeId,
    ).toBe("EMP-002");
    expect(filterPayslipRecords(records, { search: "emp-003" })).toHaveLength(
      1,
    );
    expect(
      filterPayslipRecords(records, { search: "august" })[0].employeeId,
    ).toBe("EMP-001");
    expect(filterPayslipRecords(records, { search: "nobody" })).toHaveLength(0);
  });
});

describe("payslipRecordYears", () => {
  it("returns distinct years, newest first", () => {
    const records: PayslipRecord[] = [
      buildPayslipRecord(sampleInput),
      buildPayslipRecord({ ...sampleInput, employeeId: "E2", year: 2025 }),
      buildPayslipRecord({ ...sampleInput, employeeId: "E3", year: 2025 }),
    ];
    expect(payslipRecordYears(records)).toEqual([2026, 2025]);
    expect(payslipRecordYears([])).toEqual([]);
  });
});
