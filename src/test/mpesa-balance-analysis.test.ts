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
  });
});
