import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseEmployeeWorkbook,
  buildTemplateWorkbook,
  workbookFromOcrText,
  employeeDedupKey,
} from "@/react-app/lib/payroll-import";

function workbookOf(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return wb;
}

function loadFixture(name: string): XLSX.WorkBook {
  const buf = readFileSync(resolve(process.cwd(), "src", "test", name));
  return XLSX.read(buf, { type: "buffer", cellDates: true });
}

describe("parseEmployeeWorkbook", () => {
  it("round-trips the app's own Employees export (title row must NOT be picked as header)", () => {
    const wb = workbookOf({
      Employees: [
        ["ACME FUEL EMPLOYEES LIST MARCH 2026"],
        [],
        [
          "No.",
          "Name",
          "Role",
          "Department",
          "Basic Salary",
          "SHA",
          "NSSF",
          "Advance",
          "Net Pay",
          "Bank",
          "Bank Code",
        ],
        [
          "1",
          "John Mwangi",
          "Cashier",
          "Sales",
          45000,
          1237.5,
          480,
          0,
          43282.5,
          "KCB",
          "01100",
        ],
        [
          "2",
          "Sarah Wanjiku",
          "Manager",
          "Ops",
          85000,
          2337.5,
          480,
          5000,
          77662.5,
          "Equity",
          "01144",
        ],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(2);
    expect(result.employees[0].first_name).toBe("John");
    expect(result.employees[0].last_name).toBe("Mwangi");
    expect(result.employees[0].basic_salary).toBe(45000);
    // "SHA"/"NSSF" columns hold AMOUNTS, not member numbers
    expect(result.employees[0].sha_amount).toBe(1237.5);
    expect(result.employees[0].sha_number).toBe("");
    expect(result.employees[0].nssf_amount).toBe(480);
    expect(result.employees[0].net_pay).toBe(43282.5);
    expect(result.employees[1].advance_amount).toBe(5000);
    expect(result.employees[0].bank_name).toBe("KCB");
    expect(result.employees[0].bank_code).toBe("01100");
  });

  it("round-trips the 4-sheet PAYROLL export without importing the TOTALS row", () => {
    const wb = workbookOf({
      "Payroll Payment": [
        ["ACME SALARY MARCH 2026 PAYMENT"],
        [],
        [
          "S/NO.",
          "NAME",
          "BASIC AMOUNT",
          "SHA",
          "NSSF",
          "BANK CHARGES",
          "ADVANCE",
          "NET TOTAL",
        ],
        [1, "JOHN MWANGI", 45000, 1237.5, 480, 0, 0, 43282.5],
        [2, "SARAH WANJIKU", 85000, 2337.5, 480, 0, 5000, 77662.5],
        [],
        ["TOTALS", "", 130000, 3575, 960, 0, 5000, 120945],
      ],
      "SHA List": [
        ["ACME STAFF SHA LIST MARCH 2026"],
        [],
        ["S/NO.", "NAME", "ID NO.", "SHA NO.", "BASIC SALARY", "SHA AMOUNT"],
        [1, "JOHN MWANGI", "12345678", "SHA-001", 45000, 1237.5],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(2);
    // No "TOTALS" employee
    expect(result.employees.some((e) => /totals?/i.test(e.first_name))).toBe(
      false,
    );
    expect(result.employees[0].basic_salary).toBe(45000);
  });

  it("never maps the national ID column into employee_id", () => {
    const wb = workbookOf({
      Sheet1: [
        ["ID No.", "Full Name", "Salary"],
        ["12345678", "John Mwangi", 45000],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].id_number).toBe("12345678");
    expect(result.employees[0].employee_id).toBe("");
  });

  it("handles split first/last name columns", () => {
    const wb = workbookOf({
      Staff: [
        ["First Name", "Last Name", "Position", "Basic Pay", "Phone"],
        ["Jane", "Doe", "Attendant", 30000, "0712345678"],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].first_name).toBe("Jane");
    expect(result.employees[0].last_name).toBe("Doe");
    expect(result.employees[0].role).toBe("Attendant");
  });

  it("restores leading zero on numeric Kenyan phone numbers", () => {
    const wb = workbookOf({
      Sheet1: [
        ["Name", "Phone", "Salary"],
        ["John Mwangi", 712345678, 1000],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees[0].phone).toBe("0712345678");
  });

  it("converts Excel serial dates to ISO", () => {
    const wb = workbookOf({
      Sheet1: [
        ["Name", "Employment Date", "Salary"],
        ["John Mwangi", 45306, 1000], // 2024-01-15
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees[0].employment_date).toBe("2024-01-15");
  });

  it("picks the best sheet across multiple sheets", () => {
    const wb = workbookOf({
      Notes: [["Random notes with no table"], ["nothing here"]],
      Employees: [
        ["Name", "Role", "Basic Salary", "Email"],
        ["John Mwangi", "Cashier", 45000, "j@x.com"],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.sheetName).toBe("Employees");
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].email).toBe("j@x.com");
  });

  it("dedupes repeated rows inside the file", () => {
    const wb = workbookOf({
      Sheet1: [
        ["Name", "Employee ID", "Salary"],
        ["John Mwangi", "EMP-1", 1000],
        ["John Mwangi", "EMP-1", 1000],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
  });

  it("returns an empty result for files without an employee table", () => {
    const wb = workbookOf({ Sheet1: [["hello"], ["world"]] });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(0);
    expect(result.sheetName).toBeNull();
  });

  it("skips rows whose 'name' is purely numeric (serial/amount rows)", () => {
    const wb = workbookOf({
      Sheet1: [
        ["Name", "Salary"],
        ["1,234.00", 1000],
        ["Real Person", 2000],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].first_name).toBe("Real");
  });

  it("merges data split across payment/SHA/NSSF/CPC sheets (Publican payroll format)", () => {
    const result = parseEmployeeWorkbook(
      loadFixture("fixtures-publican-payroll.xlsx"),
    );
    // Primary sheet is the payments sheet; the other 3 contribute fields.
    expect(result.sheetName).toBe("Payroll Payment");
    expect(result.sheetsUsed).toContain("SHA List");
    expect(result.sheetsUsed).toContain("NSSF List");
    expect(result.sheetsUsed).toContain("CPC Centralized");
    // 10 employees, TOTALS footer rows skipped.
    expect(result.employees).toHaveLength(10);

    const byName = (n: string) =>
      result.employees.find((e) => `${e.first_name} ${e.last_name}` === n)!;

    // Payments sheet values.
    const ekal = byName("EKAL HEBREWS");
    expect(ekal.basic_salary).toBe(10000);
    expect(ekal.sha_amount).toBe(275);
    expect(ekal.nssf_amount).toBe(540);
    expect(ekal.net_pay).toBe(9185);
    // SHA List sheet values (national ID + SHA member number).
    expect(ekal.id_number).toBe("33847994");
    expect(ekal.sha_number).toBe("CR2665367732646-5");
    // NSSF List sheet value.
    expect(ekal.nssf_number).toBe("2061523639");
    // CPC Centralized sheet values (bank details; "Originator Account"
    // and "Orig Code" must NOT be picked up).
    expect(ekal.bank_name).toBe("KCB LODWAR");
    expect(ekal.bank_account).toBe("1335159843");
    expect(ekal.bank_code).toBe("01144");

    // Different bank preserved per employee.
    const patrick = byName("PATRICK KIVENGA");
    expect(patrick.bank_name).toBe("EQUITY");
    expect(patrick.bank_account).toBe("300190948511");
    expect(patrick.bank_code).toBe("00202");
    expect(patrick.net_pay).toBe(28635);

    // NSSF number with a trailing letter stays a string.
    expect(byName("JOSEPHAT AMAN").nssf_number).toBe("205545492X");
    // Advance deduction from the payments sheet.
    expect(byName("LEON IBUYA").advance_amount).toBe(6000);
    // Employee absent from the CPC sheet keeps empty bank fields.
    const obadiah = byName("OBADIAH EKAI EKAL");
    expect(obadiah.bank_name).toBe("");
    expect(obadiah.basic_salary).toBe(8000);
    // Primary-sheet values win when both sheets carry them.
    expect(byName("MOIT ANNAH").basic_salary).toBe(8000);
    expect(byName("MOIT ANNAH").sha_amount).toBe(220);
  });

  it("merges a secondary sheet that adds employees missing from the primary", () => {
    const wb = workbookOf({
      Payments: [
        ["Name", "Basic Salary", "Net Pay"],
        ["ALICE ONE", 10000, 9000],
      ],
      Banks: [
        ["Name", "Bank Name", "Account"],
        ["ALICE ONE", "KCB", "111"],
        ["BOB TWO", "EQUITY", "222"],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(2);
    const alice = result.employees.find(
      (e) => `${e.first_name} ${e.last_name}` === "ALICE ONE",
    )!;
    expect(alice.bank_name).toBe("KCB");
    expect(alice.bank_account).toBe("111");
    expect(alice.net_pay).toBe(9000); // primary sheet wins
    const bob = result.employees.find(
      (e) => `${e.first_name} ${e.last_name}` === "BOB TWO",
    )!;
    expect(bob.bank_name).toBe("EQUITY");
    expect(result.sheetsUsed).toContain("Banks");
  });

  it("does not import reference-only sheets (no identity column)", () => {
    const wb = workbookOf({
      Employees: [
        ["Name", "Basic Salary"],
        ["JANE DOE", 10000],
      ],
      Codes: [
        ["Code", "Rate"],
        ["A01", 0.16],
        ["A02", 0.08],
      ],
    });
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
    expect(result.sheetsUsed).toEqual(["Employees"]);
  });
});

describe("buildTemplateWorkbook", () => {
  it("produces a file the importer can read back", () => {
    const wb = buildTemplateWorkbook();
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].first_name).toBe("Jane");
    expect(result.employees[0].employee_id).toBe("EMP-001");
    expect(result.employees[0].basic_salary).toBe(45000);
    expect(result.employees[0].kra_pin).toBe("A001234567X");
    expect(result.employees[0].sha_number).toBe("SHA-123456");
    expect(result.employees[0].nssf_number).toBe("NSSF-123456");
    expect(result.employees[0].phone).toBe("0712345678");
  });
});

describe("workbookFromOcrText", () => {
  it("turns OCR text rows into a workbook the parser can read", () => {
    const text = `EMPLOYEE NAME  ID NO  BASIC SALARY  SHA  NSSF  NET
John Mwangi  33847994  10000  275  540  9185
Sarah Wanjiku  33847995  85000  2337.5  540  77662.5
TOTALS  95000  2612.5  1080  86847.5`;
    const wb = workbookFromOcrText(text);
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(2);
    expect(result.employees[0].first_name).toBe("John");
    expect(result.employees[0].last_name).toBe("Mwangi");
    expect(result.employees[0].id_number).toBe("33847994");
    expect(result.employees[0].basic_salary).toBe(10000);
    expect(result.employees[1].basic_salary).toBe(85000);
  });

  it("splits cells on pipes and multiple spaces (OCR table shape)", () => {
    const text = `NAME | ID NO. | BASIC SALARY | NET
Jane Doe | EMP-001 | 45000 | 40000`;
    const wb = workbookFromOcrText(text);
    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].first_name).toBe("Jane");
    expect(result.employees[0].basic_salary).toBe(45000);
  });
});

describe("employeeDedupKey", () => {
  it("prefers employee_id, then id_number, then name", () => {
    expect(employeeDedupKey({ employee_id: "EMP-1", id_number: "9" })).toBe(
      "emp-1",
    );
    expect(employeeDedupKey({ id_number: "123" })).toBe("123");
    expect(employeeDedupKey({ first_name: "John", last_name: "Doe" })).toBe(
      "john doe",
    );
    // cross-shape compatibility (cloud snake_case vs UI camelCase)
    expect(employeeDedupKey({ employee_id: "EMP-1" })).toBe(
      employeeDedupKey({ employeeId: "EMP-1" }),
    );
  });
});
