import { describe, expect, it } from "vitest";
import { analyzeBalanceInflow } from "@/react-app/lib/mpesa-balance-analysis";
import { parseMpesaLines } from "@/react-app/lib/mpesa-statement-parser";

describe("M-PESA missing-inflow accuracy", () => {
  it("identifies a fully unparsed inflow only when the next balance row has no Paid In", () => {
    const result = analyzeBalanceInflow([
      { date: "2026-09-20", time: "09:00:00", receipt: "AAA0000001", balance: 1000, paidIn: 500 },
      { date: "2026-09-20", time: "09:05:00", receipt: "AAA0000002", balance: 1400, paidIn: 0 },
      { date: "2026-09-20", time: "09:10:00", receipt: "AAA0000003", balance: 1500, paidIn: 100 },
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

  it("does not invent a synthetic transaction for a partial mismatch", () => {
    const result = analyzeBalanceInflow([
      { date: "2026-09-20", time: "09:00:00", receipt: "AAA0000001", balance: 1000, paidIn: 0 },
      { date: "2026-09-20", time: "09:05:00", receipt: "AAA0000002", balance: 1500, paidIn: 300 },
    ]);

    expect(result.missingTransactions).toHaveLength(0);
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
