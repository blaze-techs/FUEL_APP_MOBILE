import { describe, it, expect } from "vitest";
import { resolveEmployeeName as employeeName } from "@/react-app/lib/payslip-security";

describe("StaffAdvanceLoans employeeName", () => {
  it("uses fullName (the shape payroll actually saves)", () => {
    expect(employeeName({ fullName: "EKAL HEBREWS" })).toBe("EKAL HEBREWS");
  });

  it("uses full_name (snake_case cloud records)", () => {
    expect(employeeName({ full_name: "Jane Mwangi" })).toBe("Jane Mwangi");
  });

  it("uses name field", () => {
    expect(employeeName({ name: "Bob Otieno" })).toBe("Bob Otieno");
  });

  it("assembles from firstName + lastName", () => {
    expect(employeeName({ firstName: "John", lastName: "Doe" })).toBe(
      "John Doe",
    );
  });

  it("assembles from first_name + last_name", () => {
    expect(employeeName({ first_name: "Achieng", last_name: "Ouma" })).toBe(
      "Achieng Ouma",
    );
  });

  it("falls back to Employee only when nothing is available", () => {
    expect(employeeName({})).toBe("Employee");
    expect(employeeName({ firstName: "", lastName: "" })).toBe("Employee");
  });
});
