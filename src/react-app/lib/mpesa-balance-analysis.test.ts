import { describe, expect, it } from "vitest";
import { analyzeBalanceInflow } from "./mpesa-balance-analysis";

describe("analyzeBalanceInflow", () => {
  it("identifies only the positive balance residual after current Paid In", () => {
    const result = analyzeBalanceInflow(
      [
        { date: "2026-10-01", time: "10:00:00", receipt: "OPEN", balance: 1000, paidIn: 0 },
        { date: "2026-10-01", time: "10:01:00", receipt: "R1", balance: 1700, paidIn: 500 },
      ],
      { recordedNet: 500, capturedReceipts: [{ receipt: "R1", paidIn: 500, date: "2026-10-01", time: "10:01:00" }] },
    );

    expect(result.missingInflowTotal).toBe(200);
    expect(result.missingTransactions).toHaveLength(1);
    expect(result.missingTransactions[0].amount).toBe(200);
    expect(result.totalValidInflow).toBe(700);
  });

  it("does not infer a missing paid-in when the balance change equals Paid In", () => {
    const result = analyzeBalanceInflow([
      { date: "2026-10-01", time: "10:00:00", balance: 1000, paidIn: 0 },
      { date: "2026-10-01", time: "10:01:00", balance: 1500, paidIn: 500 },
    ]);

    expect(result.missingTransactions).toHaveLength(0);
    expect(result.missingInflowTotal).toBe(0);
  });

  it("never turns a falling or unchanged balance into a positive missing paid-in", () => {
    const falling = analyzeBalanceInflow([
      { date: "2026-10-01", time: "10:00:00", balance: 1000, paidIn: 0 },
      { date: "2026-10-01", time: "10:01:00", balance: 900, paidIn: 0, withdrawn: 100 },
    ]);
    const unchanged = analyzeBalanceInflow([
      { date: "2026-10-01", time: "10:00:00", balance: 1000, paidIn: 0 },
      { date: "2026-10-01", time: "10:01:00", balance: 1000, paidIn: 100 },
    ]);

    expect(falling.missingInflowTotal).toBe(0);
    expect(unchanged.missingInflowTotal).toBe(0);
  });

  it("does not count a captured receipt again when its ledger row has zero Paid In", () => {
    const result = analyzeBalanceInflow(
      [
        { date: "2026-10-01", time: "10:00:00", receipt: "OPEN", balance: 1000, paidIn: 0 },
        { date: "2026-10-01", time: "10:01:00", receipt: "R1", balance: 1500, paidIn: 0 },
      ],
      { recordedNet: 500, capturedReceipts: [{ receipt: "R1", paidIn: 500, date: "2026-10-01", time: "10:01:00" }] },
    );

    expect(result.missingInflowTotal).toBe(0);
    expect(result.missingTransactions).toHaveLength(0);
  });

  it("uses chronological order even when the caller supplies rows backwards", () => {
    const result = analyzeBalanceInflow([
      { date: "2026-10-01", time: "10:01:00", balance: 1700, paidIn: 500 },
      { date: "2026-10-01", time: "10:00:00", balance: 1000, paidIn: 0 },
    ]);

    expect(result.missingInflowTotal).toBe(200);
  });

  it("does not let duplicate captured receipt rows hide another missing amount", () => {
    const captured = { receipt: "R1", paidIn: 500, date: "2026-10-01", time: "10:01:00" };
    const result = analyzeBalanceInflow(
      [
        { date: "2026-10-01", time: "10:00:00", receipt: "OPEN", balance: 1000, paidIn: 0 },
        { date: "2026-10-01", time: "10:01:00", receipt: "R1", balance: 2000, paidIn: 0 },
      ],
      { recordedNet: 500, capturedReceipts: [captured, captured] },
    );

    expect(result.missingInflowTotal).toBe(500);
    expect(result.missingTransactions).toHaveLength(1);
  });
});
