import { describe, expect, it } from "vitest";
import { analyzeBalanceInflow } from "@/react-app/lib/mpesa-balance-analysis";
import { parseMpesaLines } from "@/react-app/lib/mpesa-statement-parser";

describe("M-PESA missing-inflow accuracy", () => {
  it("identifies a fully unparsed inflow only when the next balance row has no Paid In", () => {
    const result = analyzeBalanceInflow([
      {
        date: "2026-09-20",
        time: "09:00:00",
        receipt: "AAA0000001",
        balance: 1000,
        paidIn: 500,
      },
      {
        date: "2026-09-20",
        time: "09:05:00",
        receipt: "AAA0000002",
        balance: 1400,
        paidIn: 0,
      },
      {
        date: "2026-09-20",
        time: "09:10:00",
        receipt: "AAA0000003",
        balance: 1500,
        paidIn: 100,
      },
    ]);

    expect(result.missingTransactions).toHaveLength(1);
    expect(result.missingTransactions[0]).toMatchObject({
      date: "2026-09-20",
      time: "09:05:00",
      amount: 400,
      previousBalance: 1000,
      currentBalance: 1400,
      receipt: "AAA0000002",
      confidence: "high",
    });
  });

  it("surfaces only the unexplained residual of a partially-recorded row", () => {
    // Balance grew 1000 -> 1500 (delta 500) but only 300 was recorded on the
    // row, so 200 moved with no recorded transaction. The rule is
    // "(current balance - previous balance) = paid in", so the residual is a
    // missing inflow — but it must be the RESIDUAL (200), never the whole
    // delta (500), and never exceed what the balance actually shows.
    const result = analyzeBalanceInflow([
      {
        date: "2026-09-20",
        time: "09:00:00",
        receipt: "AAA0000001",
        balance: 1000,
        paidIn: 0,
      },
      {
        date: "2026-09-20",
        time: "09:05:00",
        receipt: "AAA0000002",
        balance: 1500,
        paidIn: 300,
      },
    ]);

    expect(result.missingTransactions).toHaveLength(1);
    expect(result.missingTransactions[0].amount).toBe(200);
    expect(result.missingInflowTotal).toBe(200);
    // Recorded 300 + identified 200 = the 500 the balance proves.
    expect(result.totalValidInflow).toBe(500);
    expect(result.discrepancy).toBe(0);
  });

  it("never lets the identified total exceed the balance-proven growth", () => {
    const result = analyzeBalanceInflow([
      {
        date: "2026-09-20",
        time: "09:00:00",
        receipt: "AAA0000001",
        balance: 1000,
        paidIn: 0,
      },
      {
        date: "2026-09-20",
        time: "09:05:00",
        receipt: "AAA0000002",
        balance: 1500,
        paidIn: 300,
      },
      {
        date: "2026-09-20",
        time: "09:10:00",
        receipt: "AAA0000003",
        balance: 1500,
        paidIn: 0,
      },
    ]);
    // Growth is 500 total; the sum of identified missing inflows can never
    // exceed it.
    expect(result.missingInflowTotal).toBeLessThanOrEqual(500);
    expect(result.discrepancy).toBe(0);
  });

  it("keeps unknown positive Paid In rows instead of silently dropping them", () => {
    const { inflows } = parseMpesaLines([
      "ZXA1B2C3D4 2026-09-20 10:00:00 Other Merchant Deposit Completed 750.00 0.00 1750.00 Customer Merchant",
      "10:00:00 0712***345 - JOHN KAMAU",
    ]);

    expect(inflows).toHaveLength(1);
    expect(inflows[0].paidIn).toBe(750);
    expect(inflows[0].receipt).toBe("ZXA1B2C3D4");
  });
});
