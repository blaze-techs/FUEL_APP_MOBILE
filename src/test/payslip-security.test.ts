import { describe, it, expect } from "vitest";
import {
  code128CModules,
  computePayslipDocHash,
  buildPayslipVerifyPayload,
  numericDocCode,
  canonicalPayslipString,
  sha256Hex,
  resolveAuthorizingOfficer,
  type PayslipSecurityInput,
} from "@/react-app/lib/payslip-security";

const CODE128_PATTERNS: string[] = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

const input: PayslipSecurityInput = {
  organizationName: "Test Fuel Station",
  employeeId: "EMP-001",
  employeeName: "Jane Doe",
  period: "JULY-2025",
  gross: 39700,
  deductions: 3876.75,
  nett: 35823.25,
  currency: "KES",
};

function runLengths(modules: number[]): string {
  const runs: number[] = [];
  let val = modules[0];
  let count = 0;
  for (const m of modules) {
    if (m === val) count++;
    else {
      runs.push(count);
      val = m;
      count = 1;
    }
  }
  runs.push(count);
  return runs.join("");
}

describe("payslip security features", () => {
  it("sha256Hex returns a deterministic 64-char hex digest", async () => {
    const a = await sha256Hex("hello");
    expect(await sha256Hex("hello")).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("doc hash is deterministic and changes when any figure changes", async () => {
    const h1 = await computePayslipDocHash(input);
    expect(await computePayslipDocHash({ ...input })).toBe(h1);
    expect(await computePayslipDocHash({ ...input, nett: 1 })).not.toBe(h1);
  });

  it("QR payload binds org, employee, period, nett and hash prefix", async () => {
    const hash = await computePayslipDocHash(input);
    const payload = buildPayslipVerifyPayload(input, hash);
    expect(payload).toContain("FP-PAYSLIP");
    expect(payload).toContain("TEST FUEL STATION");
    expect(payload).toContain("EMP-001");
    expect(payload).toContain("JULY-2025");
    expect(payload).toContain("KES35823.25");
    expect(payload).toContain(`H:${hash.slice(0, 16).toUpperCase()}`);
  });

  it("canonical string is stable and order-sensitive", () => {
    const s1 = canonicalPayslipString(input);
    expect(s1).toContain("35823.25");
    expect(s1).not.toBe(canonicalPayslipString({ ...input, nett: 0 }));
  });

  it("numericDocCode yields even-length digits derived from the hash", async () => {
    const code = numericDocCode(await computePayslipDocHash(input));
    expect(code).toMatch(/^\d+$/);
    expect(code.length % 2).toBe(0);
    expect(code.length).toBeGreaterThanOrEqual(14);
  });

  it("resolveAuthorizingOfficer picks the highest-priority role by name", () => {
    const staff = [
      { employeeId: "E1", fullName: "Cashier One", role: "Pump Attendant" },
      { employeeId: "E2", fullName: "John Manager", role: "Station Manager" },
      { employeeId: "E3", fullName: "Mary Payroll", role: "Payroll Manager" },
      { employeeId: "E4", fullName: "Alice HR", role: "HR Officer" },
      { employeeId: "E5", fullName: "Bob Accounts", role: "Accountant" },
    ];
    // Payroll Manager outranks everyone regardless of array order.
    expect(resolveAuthorizingOfficer(staff)?.fullName).toBe("Mary Payroll");
    // Without a payroll manager, HR wins over accountant/manager.
    expect(
      resolveAuthorizingOfficer(staff.filter((e) => e.employeeId !== "E3"))
        ?.fullName,
    ).toBe("Alice HR");
    // Without HR, accountant wins.
    expect(
      resolveAuthorizingOfficer(
        staff.filter((e) => !["E3", "E4"].includes(e.employeeId)),
      )?.fullName,
    ).toBe("Bob Accounts");
    // Only a plain manager present → the manager is the officer.
    expect(
      resolveAuthorizingOfficer([
        { employeeId: "E2", fullName: "John Manager", role: "Station Manager" },
      ])?.fullName,
    ).toBe("John Manager");
    // Excluding the payslip's own employee.
    expect(
      resolveAuthorizingOfficer(
        [{ employeeId: "E2", fullName: "John Manager", role: "Manager" }],
        "E2",
      ),
    ).toBeNull();
    // No authorizing role → null.
    expect(
      resolveAuthorizingOfficer([
        { employeeId: "E1", fullName: "Cashier One", role: "Pump Attendant" },
      ]),
    ).toBeNull();
  });

  it("Code 128C module stream decodes back to the input with valid checksum", () => {
    const digits = "0123456789";
    const modules = code128CModules(digits);
    // Strip the 10-module quiet zones; each symbol is 11 modules, stop is 13.
    const core = modules.slice(10, -10);
    expect(core.length % 11).toBe(2); // stop adds the 2-module final bar
    const symbolCount = (core.length - 13) / 11;
    const values: number[] = [];
    for (let s = 0; s < symbolCount; s++) {
      const chunk = core.slice(s * 11, s * 11 + 11);
      values.push(CODE128_PATTERNS.indexOf(runLengths(chunk)));
    }
    const stopChunk = core.slice(symbolCount * 11, symbolCount * 11 + 13);
    values.push(CODE128_PATTERNS.indexOf(runLengths(stopChunk)));
    expect(values.every((v) => v >= 0)).toBe(true);
    expect(values[0]).toBe(105); // Start C
    expect(values[values.length - 1]).toBe(106); // Stop
    const data = values.slice(1, -2);
    expect(data).toEqual([1, 23, 45, 67, 89]);
    const checksum = values[values.length - 2];
    const weighted = 105 + data.reduce((acc, v, idx) => acc + v * (idx + 1), 0);
    expect(weighted % 103).toBe(checksum);
  });
});
