import { describe, expect, it } from "vitest";
import { analyzeBalanceInflow } from "@/react-app/lib/mpesa-balance-analysis";

describe("analyzeBalanceInflow — True Inflow (Balance Delta +)", () => {
  const rows = [
    {
      date: "2026-09-01",
      time: "09:00:00",
      receipt: "A",
      balance: 1000,
      paidIn: 500,
    },
    {
      date: "2026-09-01",
      time: "10:00:00",
      receipt: "B",
      balance: 1500,
      paidIn: 300,
    },
    {
      date: "2026-09-01",
      time: "11:00:00",
      receipt: "C",
      balance: 1300,
      paidIn: 0,
    },
    {
      date: "2026-09-02",
      time: "09:00:00",
      receipt: "D",
      balance: 1700,
      paidIn: 200,
    },
    {
      date: "2026-09-02",
      time: "10:00:00",
      receipt: "E",
      balance: 2200,
      paidIn: 400,
    },
  ];

  it("sums POSITIVE balance deltas as true inflow", () => {
    const a = analyzeBalanceInflow(rows as any);
    // Deltas: B-A +500, C-B -200, D-C +400, E-D +500 -> positives 500+400+500 = 1400
    expect(a.trueInflow).toBe(1400);
    expect(a.deltaCount).toBe(4);
  });

  it("reports unrecorded inflow = true inflow - recorded net", () => {
    const a = analyzeBalanceInflow(rows as any);
    // recorded net = 500+300+200+400 = 1400; trueInflow 1400 -> unrecorded 0
    expect(a.recordedNet).toBe(1400);
    expect(a.unrecordedInflow).toBe(0);
    expect(a.hasUnrecorded).toBe(false);
    // Total valid inflow = recorded net + unrecorded (0 here)
    expect(a.totalValidInflow).toBe(1400);
  });

  it("flags unrecorded inflow when balance grows beyond parsed receipts", () => {
    // Same balances but fewer/lower parsed receipts: trueInflow 1400 vs net 900
    const r2 = [
      {
        date: "2026-09-01",
        time: "09:00:00",
        receipt: "A",
        balance: 1000,
        paidIn: 200,
      },
      {
        date: "2026-09-01",
        time: "10:00:00",
        receipt: "B",
        balance: 1500,
        paidIn: 300,
      },
      {
        date: "2026-09-01",
        time: "11:00:00",
        receipt: "C",
        balance: 1300,
        paidIn: 0,
      },
      {
        date: "2026-09-02",
        time: "09:00:00",
        receipt: "D",
        balance: 1700,
        paidIn: 200,
      },
      {
        date: "2026-09-02",
        time: "10:00:00",
        receipt: "E",
        balance: 2200,
        paidIn: 200,
      },
    ];
    const a = analyzeBalanceInflow(r2 as any);
    expect(a.trueInflow).toBe(1400);
    expect(a.recordedNet).toBe(900);
    expect(a.unrecordedInflow).toBe(500);
    expect(a.hasUnrecorded).toBe(true);
    // Total valid inflow always >= recorded net (extracted inflows within range)
    expect(a.totalValidInflow).toBe(1400);
  });

  it("is stable across sort orders (sorts chronologically internally)", () => {
    const shuffled = [...rows].reverse() as any;
    const a = analyzeBalanceInflow(shuffled);
    // Sorted by datetime internally -> same as original order
    expect(a.trueInflow).toBe(1400);
    expect(a.deltaCount).toBe(4);
  });

  it("handles missing balances (skips unknown rows)", () => {
    const r3 = [
      {
        date: "2026-09-01",
        time: "09:00:00",
        receipt: "A",
        balance: 0,
        paidIn: 500,
      },
      {
        date: "2026-09-01",
        time: "10:00:00",
        receipt: "B",
        balance: 1500,
        paidIn: 300,
      },
      {
        date: "2026-09-02",
        time: "09:00:00",
        receipt: "C",
        balance: 0,
        paidIn: 0,
      },
      {
        date: "2026-09-02",
        time: "10:00:00",
        receipt: "D",
        balance: 2400,
        paidIn: 100,
      },
    ];
    const a = analyzeBalanceInflow(r3 as any);
    // Only B->? (B has no next-known) and ...->D: deltas computed only when both known
    // A(0) skipped; B(1500)->C(0) skipped; C(0)->D(2400) skipped.
    expect(a.deltaCount).toBe(0);
    expect(a.trueInflow).toBe(0);
    expect(a.recordedNet).toBe(900);
    // confidence "N/A — no balance data available"
    expect(a.confidence).toContain("N/A");
  });

  it("treats empty set as zero inflow", () => {
    const a = analyzeBalanceInflow([]);
    expect(a.trueInflow).toBe(0);
    expect(a.unrecordedInflow).toBe(0);
    expect(a.hasUnrecorded).toBe(false);
    expect(a.totalValidInflow).toBe(0);
  });

  it("total valid inflow never omits extracted inflows when balances are sparse", () => {
    // No usable balance data at all — trueInflow is 0, but the extracted
    // inflows (within the range) must STILL be counted in Total Valid Inflow.
    const sparse = [
      {
        date: "2026-09-01",
        time: "09:00:00",
        receipt: "A",
        balance: 0,
        paidIn: 400,
      },
      {
        date: "2026-09-02",
        time: "09:00:00",
        receipt: "B",
        balance: 0,
        paidIn: 250,
      },
      {
        date: "2026-09-03",
        time: "09:00:00",
        receipt: "C",
        balance: 0,
        paidIn: 100,
      },
    ];
    const a = analyzeBalanceInflow(sparse as any);
    expect(a.trueInflow).toBe(0);
    expect(a.recordedNet).toBe(750);
    expect(a.unrecordedInflow).toBe(0);
    // KEY INVARIANT: total valid inflow >= extracted inflows within the range
    expect(a.totalValidInflow).toBe(750);
  });

  it("total valid inflow is >= extracted inflows in every mixed scenario", () => {
    // Even when the range starts mid-statement (first row has no previous
    // balance to delta against), the extracted first-row inflow is counted.
    const mixed = [
      {
        date: "2026-09-05",
        time: "10:00:00",
        receipt: "F",
        balance: 5000,
        paidIn: 1000,
      },
      {
        date: "2026-09-05",
        time: "11:00:00",
        receipt: "G",
        balance: 4800,
        paidIn: 0,
      },
      {
        date: "2026-09-05",
        time: "12:00:00",
        receipt: "H",
        balance: 6200,
        paidIn: 800,
      },
      {
        date: "2026-09-05",
        time: "13:00:00",
        receipt: "I",
        balance: 6600,
        paidIn: 300,
      },
    ];
    const a = analyzeBalanceInflow(mixed as any);
    // trueInflow = positive deltas: F->G -200 (skip), G->H +1400, H->I +400 = 1800
    expect(a.trueInflow).toBe(1800);
    expect(a.recordedNet).toBe(2100);
    // no unrecorded (trueInflow < recordedNet) — but total valid must still
    // equal at least the extracted sum.
    expect(a.unrecordedInflow).toBe(0);
    expect(a.totalValidInflow).toBe(2100);
  });
});
