import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseEmployeeWorkbook,
  buildTemplateWorkbook,
  employeeDedupKey,
} from "@/react-app/lib/payroll-import";

function workbookOf(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return wb;
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
