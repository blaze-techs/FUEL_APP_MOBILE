import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { getPayrollLabels } from "@/react-app/lib/payroll-localization";
import { parseEmployeeWorkbook } from "@/react-app/lib/payroll-import";

function workbookOf(rows: unknown[][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Payroll");
  return wb;
}

describe("getPayrollLabels", () => {
  it("returns Kenya terminology", () => {
    expect(getPayrollLabels("KE")).toEqual({
      taxPin: "KRA PIN",
      medicalCover: "SHA",
      socialFund: "NSSF",
    });
  });

  it("returns localized terminology for other countries", () => {
    expect(getPayrollLabels("US")).toEqual({
      taxPin: "SSN",
      medicalCover: "Health Insurance",
      socialFund: "401(k)",
    });
    expect(getPayrollLabels("UG")).toEqual({
      taxPin: "TIN",
      medicalCover: "SHU",
      socialFund: "NSSF",
    });
    expect(getPayrollLabels("GB").taxPin).toBe("NINO");
    expect(getPayrollLabels("IN").socialFund).toBe("EPF");
  });

  it("falls back to generic labels for unknown countries", () => {
    expect(getPayrollLabels("XX")).toEqual({
      taxPin: "Tax PIN",
      medicalCover: "Medical Cover",
      socialFund: "Social Security",
    });
  });

  it("is case-insensitive", () => {
    expect(getPayrollLabels("ke").taxPin).toBe("KRA PIN");
  });
});

describe("importer round-trips localized export headers", () => {
  it("imports a US-localized payroll sheet (HEALTH INSURANCE / 401(K) / SSN)", () => {
    const wb = workbookOf([
      [
        "S/NO.",
        "NAME",
        "BASIC SALARY",
        "HEALTH INSURANCE",
        "401(K)",
        "NET PAY",
      ],
      [1, "John Doe", 10000, 275, 540, 9185],
    ]);
    const { employees } = parseEmployeeWorkbook(wb);
    expect(employees).toHaveLength(1);
    expect(`${employees[0].first_name} ${employees[0].last_name}`).toBe(
      "John Doe",
    );
    expect(employees[0].sha_amount).toBe(275);
    expect(employees[0].nssf_amount).toBe(540);
    expect(employees[0].net_pay).toBe(9185);
  });

  it("imports localized member-number + tax-id columns", () => {
    const wb = workbookOf([
      ["NAME", "ID NO.", "HEALTH INSURANCE NO", "401(K) NO", "TIN"],
      ["John Doe", "12345678", "HI-900", "PEN-100", "TIN-55"],
    ]);
    const { employees } = parseEmployeeWorkbook(wb);
    expect(employees).toHaveLength(1);
    expect(employees[0].id_number).toBe("12345678");
    expect(employees[0].sha_number).toBe("HI-900");
    expect(employees[0].nssf_number).toBe("PEN-100");
    expect(employees[0].kra_pin).toBe("TIN-55");
  });

  it("still imports the Kenya headers", () => {
    const wb = workbookOf([
      ["S/NO.", "NAME", "BASIC SALARY", "SHA", "NSSF", "KRA PIN"],
      [1, "Jane Doe", 20000, 550, 480, "A001"],
    ]);
    const { employees } = parseEmployeeWorkbook(wb);
    expect(employees).toHaveLength(1);
    expect(employees[0].sha_amount).toBe(550);
    expect(employees[0].nssf_amount).toBe(480);
    expect(employees[0].kra_pin).toBe("A001");
  });
});
