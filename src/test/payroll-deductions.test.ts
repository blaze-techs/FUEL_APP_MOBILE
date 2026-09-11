import { describe, it, expect } from "vitest";
import {
  calcNetPay,
  computeColumnValue,
  deductionAmountFor,
  normalizeCustomDeductions,
  normalizeCustomEarnings,
  normalizeDeductionTypes,
  normalizeEarningTypes,
  parseDeductionRule,
  resolveDeductionAmount,
  setDeductionAmount,
} from "@/react-app/lib/payroll-deductions";

describe("normalizeDeductionTypes", () => {
  it("returns [] for non-arrays", () => {
    expect(normalizeDeductionTypes(null)).toEqual([]);
    expect(normalizeDeductionTypes(undefined)).toEqual([]);
    expect(normalizeDeductionTypes("x")).toEqual([]);
  });

  it("keeps valid entries and drops incomplete ones", () => {
    expect(
      normalizeDeductionTypes([
        { id: "ded_1", label: "HELB Loan" },
        { id: "ded_2", label: "" }, // empty label dropped
        { label: "No ID" }, // no id dropped
        null,
      ]),
    ).toEqual([{ id: "ded_1", label: "HELB Loan" }]);
  });
});

describe("normalizeCustomDeductions", () => {
  it("returns [] for non-arrays", () => {
    expect(normalizeCustomDeductions(null)).toEqual([]);
    expect(normalizeCustomDeductions({})).toEqual([]);
  });

  it("accepts snake_case type_id and string amounts", () => {
    expect(
      normalizeCustomDeductions([
        { type_id: "ded_1", amount: "250.5" },
        { typeId: "ded_2", amount: 100 },
      ]),
    ).toEqual([
      { typeId: "ded_1", amount: 250.5 },
      { typeId: "ded_2", amount: 100 },
    ]);
  });

  it("drops entries with no typeId and coerces NaN amounts to 0", () => {
    expect(
      normalizeCustomDeductions([
        { amount: 50 }, // no typeId dropped
        { typeId: "ded_1", amount: "abc" },
      ]),
    ).toEqual([{ typeId: "ded_1", amount: 0 }]);
  });
});

describe("calcNetPay with custom deductions", () => {
  it("subtracts custom deductions in addition to sha/nssf/advance", () => {
    expect(
      calcNetPay({
        basicSalary: 45000,
        advance: 2500,
        sha: 1237.5,
        nssf: 480,
        customDeductions: [
          { typeId: "ded_helb", amount: 2000 },
          { typeId: "ded_union", amount: 300 },
        ],
      }),
    ).toBe(38482.5);
  });

  it("is unchanged when no custom deductions exist (backwards compatible)", () => {
    expect(
      calcNetPay({ basicSalary: 45000, advance: 0, sha: 1237.5, nssf: 480 }),
    ).toBe(43282.5);
  });

  it("guards NaN / Infinity inputs", () => {
    expect(
      calcNetPay({
        basicSalary: NaN,
        advance: Infinity,
        sha: 100,
        nssf: 50,
        customDeductions: [{ typeId: "ded_1", amount: NaN }],
      }),
    ).toBe(-150);
  });
});

describe("deductionAmountFor / setDeductionAmount", () => {
  it("returns 0 for an absent type", () => {
    expect(deductionAmountFor(undefined, "ded_1")).toBe(0);
    expect(deductionAmountFor([], "ded_1")).toBe(0);
  });

  it("sets a new type amount without dropping existing ones", () => {
    const next = setDeductionAmount(
      [{ typeId: "ded_1", amount: 100 }],
      "ded_2",
      250,
    );
    expect(next).toEqual([
      { typeId: "ded_1", amount: 100 },
      { typeId: "ded_2", amount: 250 },
    ]);
  });

  it("updates an existing type amount in place", () => {
    const next = setDeductionAmount(
      [
        { typeId: "ded_1", amount: 100 },
        { typeId: "ded_2", amount: 250 },
      ],
      "ded_2",
      300,
    );
    expect(next).toEqual([
      { typeId: "ded_1", amount: 100 },
      { typeId: "ded_2", amount: 300 },
    ]);
    expect(deductionAmountFor(next, "ded_2")).toBe(300);
  });
});

describe("percent/fixed resolution", () => {
  it("resolveDeductionAmount computes percent of basic and fixed amounts", () => {
    expect(
      resolveDeductionAmount(
        { typeId: "t1", amount: 10, mode: "percent" },
        10000,
      ),
    ).toBe(1000);
    expect(
      resolveDeductionAmount(
        { typeId: "t2", amount: 500, mode: "fixed" },
        10000,
      ),
    ).toBe(500);
    expect(resolveDeductionAmount({ typeId: "t3", amount: 500 }, 10000)).toBe(
      500,
    );
  });

  it("deductionAmountFor resolves when basicSalary is passed", () => {
    expect(
      deductionAmountFor(
        [{ typeId: "t1", amount: 10, mode: "percent" }],
        "t1",
        10000,
      ),
    ).toBe(1000);
    expect(deductionAmountFor([{ typeId: "t1", amount: 10 }], "t1")).toBe(10);
  });

  it("computeColumnValue picks the type's default rule", () => {
    expect(
      computeColumnValue(
        { id: "a", label: "A", calcMode: "percent", percentRate: 5 },
        10000,
      ),
    ).toBe(500);
    expect(
      computeColumnValue(
        { id: "b", label: "B", calcMode: "fixed", fixedAmount: 250 },
        10000,
      ),
    ).toBe(250);
    expect(computeColumnValue({ id: "c", label: "C" }, 10000)).toBe(0);
  });
});

describe("parseDeductionRule (describe-the-rule parser)", () => {
  it("understands percentage phrasings", () => {
    expect(parseDeductionRule("5%")).toEqual({
      calcMode: "percent",
      percentRate: 5,
    });
    expect(parseDeductionRule("10 percent of basic salary")).toEqual({
      calcMode: "percent",
      percentRate: 10,
    });
    expect(parseDeductionRule("2.5 per cent")).toEqual({
      calcMode: "percent",
      percentRate: 2.5,
    });
  });

  it("understands flat-amount phrasings", () => {
    expect(parseDeductionRule("KSh 500")).toEqual({
      calcMode: "fixed",
      fixedAmount: 500,
    });
    expect(parseDeductionRule("KES 1,000")).toEqual({
      calcMode: "fixed",
      fixedAmount: 1000,
    });
    expect(parseDeductionRule("flat 250")).toEqual({
      calcMode: "fixed",
      fixedAmount: 250,
    });
    expect(parseDeductionRule("500 per month")).toEqual({
      calcMode: "fixed",
      fixedAmount: 500,
    });
  });

  it("returns null for empty / out-of-range rules", () => {
    expect(parseDeductionRule("")).toBeNull();
    expect(parseDeductionRule("150% of salary")).toBeNull();
  });
});

describe("calcNetPay with earnings + percent deductions", () => {
  it("adds earnings and subtracts resolved deductions", () => {
    expect(
      calcNetPay({
        basicSalary: 10000,
        advance: 0,
        sha: 275,
        nssf: 540,
        customDeductions: [
          { typeId: "helb", amount: 1000, mode: "fixed" },
          { typeId: "pension", amount: 5, mode: "percent" },
        ],
        earnings: [
          { typeId: "house", amount: 2000, mode: "fixed" },
          { typeId: "transport", amount: 10, mode: "percent" },
        ],
      }),
    ).toBe(10000 + 2000 + 1000 - 275 - 540 - 1000 - 500); // 10685
  });

  it("normalizers preserve valid mode fields", () => {
    expect(
      normalizeCustomDeductions([{ typeId: "t", amount: 5, mode: "percent" }]),
    ).toEqual([{ typeId: "t", amount: 5, mode: "percent" }]);
    expect(
      normalizeDeductionTypes([
        {
          id: "d1",
          label: "HELB",
          calcMode: "percent",
          percentRate: 5,
          ruleDescription: "5% of basic",
        },
      ]),
    ).toEqual([
      {
        id: "d1",
        label: "HELB",
        calcMode: "percent",
        percentRate: 5,
        ruleDescription: "5% of basic",
      },
    ]);
    expect(normalizeEarningTypes(null)).toEqual([]);
    expect(normalizeCustomEarnings(null)).toEqual([]);
  });
});
