import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseEmployeeWorkbook,
  normalizePaymentMethod,
} from "@/react-app/lib/payroll-import";

function sheetOf(rows: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

describe("normalizePaymentMethod", () => {
  it("recognizes cash variants", () => {
    expect(normalizePaymentMethod("Cash")).toBe("cash");
    expect(normalizePaymentMethod("CASH PAYMENT")).toBe("cash");
    expect(normalizePaymentMethod("cash payment")).toBe("cash");
  });

  it("recognizes bank variants", () => {
    expect(normalizePaymentMethod("Bank")).toBe("bank");
    expect(normalizePaymentMethod("Bank Transfer")).toBe("bank");
    expect(normalizePaymentMethod("EFT")).toBe("bank");
    expect(normalizePaymentMethod("RTGS")).toBe("bank");
  });

  it("returns empty string for blank or unknown values", () => {
    expect(normalizePaymentMethod("")).toBe("");
    expect(normalizePaymentMethod(null)).toBe("");
    expect(normalizePaymentMethod(undefined)).toBe("");
    expect(normalizePaymentMethod("mobile money")).toBe("");
  });
});

describe("cash payment import", () => {
  it("marks employees on a CASH PAYMENTS sheet as cash-paid", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheetOf([
        ["S/NO.", "NAME", "BASIC AMOUNT", "SHA", "NSSF", "NET TOTAL"],
        [1, "EKAL HEBREWS", 10000, 300, 540, 9160],
        [2, "MOIT ANNAH", 8000, 300, 540, 4660],
      ]),
      "SALARY PAYMENT",
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetOf([
        ["S/NO.", "NAME", "BASIC AMOUNT", "SHA", "NSSF", "NET TOTAL"],
        [1, "OBADIAH EKAI EKAL", 8000, 300, 540, 7160],
      ]),
      "CASH PAYMENTS",
    );

    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(3);

    const obadiah = result.employees.find((e) =>
      `${e.first_name} ${e.last_name}`.includes("OBADIAH"),
    );
    expect(obadiah?.payment_method).toBe("cash");
    expect(obadiah?.basic_salary).toBe(8000);

    const ekal = result.employees.find((e) =>
      `${e.first_name} ${e.last_name}`.includes("EKAL"),
    );
    expect(ekal?.payment_method).toBe("");
  });

  it("maps a PAYMENT METHOD column to cash/bank", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheetOf([
        ["NAME", "BASIC SALARY", "PAYMENT METHOD", "BANK NAME"],
        ["John Mwangi", 45000, "Cash", ""],
        ["Sarah Wanjiku", 85000, "Bank Transfer", "KCB"],
      ]),
      "Payroll",
    );

    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(2);
    expect(result.employees[0].payment_method).toBe("cash");
    expect(result.employees[1].payment_method).toBe("bank");
  });

  it("merge keeps cash marking when the same person is on both sheets", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheetOf([
        ["NAME", "BASIC AMOUNT", "ID NO", "KRA PIN"],
        ["OBADIAH EKAI EKAL", 8000, "33847994", "A018406721Q"],
      ]),
      "SHA LIST",
    );
    XLSX.utils.book_append_sheet(
      wb,
      sheetOf([
        ["S/NO.", "NAME", "BASIC AMOUNT", "NET TOTAL"],
        [1, "OBADIAH EKAI EKAL", 8000, 7160],
      ]),
      "CASH PAYMENTS",
    );

    const result = parseEmployeeWorkbook(wb);
    expect(result.employees).toHaveLength(1);
    const emp = result.employees[0];
    expect(emp.payment_method).toBe("cash");
    // Cross-sheet merge still fills ID/KRA from the statutory list.
    expect(emp.id_number).toBe("33847994");
    expect(emp.kra_pin).toBe("A018406721Q");
  });

  it("row-level payment method wins over the sheet-name default", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      sheetOf([
        ["NAME", "BASIC AMOUNT", "PAYMENT MODE"],
        ["OBADIAH EKAI EKAL", 8000, "Bank Transfer"],
      ]),
      "CASH PAYMENTS",
    );

    const result = parseEmployeeWorkbook(wb);
    expect(result.employees[0].payment_method).toBe("bank");
  });
});
