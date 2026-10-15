import { describe, expect, it } from "vitest";
import {
  analyzeBalanceInflow,
  MISSING_RECEIPT_PREFIX,
  isUnrecordedRow,
} from "@/react-app/lib/mpesa-balance-analysis";

/**
 * The contract under test (in order):
 *   1. Recorded Net (Paid In) = sum of the extracted Paid In amounts.
 *   2. Unrecorded Inflow (per row) = (current balance − previous balance −
 *      current Paid In), counted ONLY when greater than zero.
 *   3. True Inflow (Balance Delta +) = Recorded Net + Unrecorded Inflow.
 * When there is no unrecorded inflow, True Inflow === Recorded Net.
 */
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

  it("counts an unrecorded inflow only when (balance − prev − paidIn) > 0", () => {
    const a = analyzeBalanceInflow(rows as any);
    // B−A 500 −300 = 200 → unrecorded
    // C−B −200 −0   → not counted (negative)
    // D−C 400 −200 = 200 → unrecorded
    // E−D 500 −400 = 100 → unrecorded
    expect(a.unrecordedInflow).toBe(500);
    expect(a.missingTransactions.map((m) => m.amount)).toEqual([200, 200, 100]);
  });

  it("Recorded Net (Paid In) is the sum of the extracted Paid In amounts", () => {
    const a = analyzeBalanceInflow(rows as any);
    expect(a.recordedNet).toBe(1400);
    expect(a.deltaCount).toBe(4);
  });

  it("True Inflow equals Recorded Net + Unrecorded Inflow", () => {
    const a = analyzeBalanceInflow(rows as any);
    expect(a.trueInflow).toBe(1900);
    expect(a.trueInflow).toBe(a.recordedNet + a.unrecordedInflow);
    expect(a.totalValidInflow).toBe(1900);
    expect(a.hasUnrecorded).toBe(true);
  });

  it("is stable across sort orders (sorts chronologically internally)", () => {
    const shuffled = [...rows].reverse() as any;
    const a = analyzeBalanceInflow(shuffled);
    expect(a.trueInflow).toBe(1900);
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
    // No consecutive pair has two known balances → nothing to reconcile.
    expect(a.deltaCount).toBe(0);
    expect(a.unrecordedInflow).toBe(0);
    // No unrecorded inflow ⇒ True Inflow === Recorded Net.
    expect(a.trueInflow).toBe(900);
    expect(a.recordedNet).toBe(900);
    expect(a.confidence).toContain("N/A");
  });

  it("treats empty set as zero inflow", () => {
    const a = analyzeBalanceInflow([]);
    expect(a.trueInflow).toBe(0);
    expect(a.recordedNet).toBe(0);
    expect(a.unrecordedInflow).toBe(0);
    expect(a.hasUnrecorded).toBe(false);
    expect(a.totalValidInflow).toBe(0);
  });

  it("when there is no unrecorded inflow, True Inflow === Recorded Net", () => {
    // Every balance movement is fully explained by the recorded Paid In, so the
    // identity must collapse to the recorded net.
    const clean = [
      {
        date: "2026-09-01",
        time: "09:00:00",
        receipt: "A",
        balance: 1000,
        paidIn: 0,
      },
      {
        date: "2026-09-01",
        time: "10:00:00",
        receipt: "B",
        balance: 1500,
        paidIn: 500,
      },
      {
        date: "2026-09-01",
        time: "11:00:00",
        receipt: "C",
        balance: 2000,
        paidIn: 500,
      },
    ];
    const a = analyzeBalanceInflow(clean as any);
    expect(a.unrecordedInflow).toBe(0);
    expect(a.trueInflow).toBe(a.recordedNet);
    expect(a.trueInflow).toBe(1000);
  });

  it("never counts an already-recorded receipt as an unrecorded inflow", () => {
    // The row's own Paid In is subtracted, so money inside Recorded Net can
    // never appear a second time in Unrecorded Inflow.
    const a = analyzeBalanceInflow(rows as any);
    const unrecordedTotal = a.missingTransactions.reduce(
      (s, m) => s + m.amount,
      0,
    );
    expect(a.unrecordedInflow).toBe(unrecordedTotal);
    // Each unrecorded entry is strictly positive.
    for (const m of a.missingTransactions) expect(m.amount).toBeGreaterThan(0);
  });

  it("reports the exact residual and balance pair for each unrecorded row", () => {
    const a = analyzeBalanceInflow(rows as any);
    const b = a.missingTransactions[0];
    expect(b.previousBalance).toBe(1000);
    expect(b.currentBalance).toBe(1500);
    expect(b.amount).toBe(200);
    expect(b.receipt).toBe("B");
  });

  it("total valid inflow is >= extracted inflows in every mixed scenario", () => {
    // Range starts mid-statement (first row has no previous balance to delta
    // against) — the extracted inflows must still all be counted.
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
    // G−F −200 −0 → no; H−G 1400 −800 = 600 → unrecorded;
    // I−H 400 −300 = 100 → unrecorded.
    expect(a.recordedNet).toBe(2100);
    expect(a.unrecordedInflow).toBe(700);
    expect(a.trueInflow).toBe(2800);
    expect(a.totalValidInflow).toBe(2800);
    expect(a.totalValidInflow).toBeGreaterThanOrEqual(a.recordedNet);
  });

  it("surfaces each unrecorded row at its own timestamp for reporting", () => {
    const a = analyzeBalanceInflow(rows as any);
    expect(a.missingTransactions.map((m) => m.date)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-02",
    ]);
    expect(a.missingTransactions.map((m) => m.time)).toEqual([
      "10:00:00",
      "09:00:00",
      "10:00:00",
    ]);
  });

  it("identifiers are stable so re-recording is idempotent", () => {
    const first = analyzeBalanceInflow(rows as any).missingTransactions;
    const second = analyzeBalanceInflow(rows as any).missingTransactions;
    expect(first.map((m) => m.id)).toEqual(second.map((m) => m.id));
  });

  it("identifies a synthetic unrecorded row by its receipt marker", () => {
    // The component tags synthesised unrecorded-inflow rows with this prefix so
    // they are never counted as recorded money.
    expect(
      isUnrecordedRow(`${MISSING_RECEIPT_PREFIX}2026-09-01|10:00:00|B|200.00`),
    ).toBe(true);
    expect(isUnrecordedRow("UJE48AXQFY")).toBe(false);
    expect(isUnrecordedRow("")).toBe(false);
    expect(isUnrecordedRow(undefined)).toBe(false);
    expect(isUnrecordedRow(null)).toBe(false);
  });

  it("a recorded receipt carrying its own Paid In never creates an unrecorded row", () => {
    // The reported real case: a captured 4,000 receipt whose balance grew
    // 3,978 (deposit 4,000 − charge 22). The row's own Paid In covers the
    // growth, so nothing is unrecorded and True Inflow === Recorded Net.
    const real = [
      {
        date: "2026-10-14",
        time: "07:00:00",
        receipt: "PREV",
        balance: 16854.75,
        paidIn: 0,
      },
      {
        date: "2026-10-14",
        time: "07:13:48",
        receipt: "UJE48AXQFY",
        balance: 20832.75,
        paidIn: 4000,
      },
    ];
    const a = analyzeBalanceInflow(real as any);
    // delta 3978 − paidIn 4000 = −22 → not an unrecorded inflow
    expect(a.unrecordedInflow).toBe(0);
    expect(a.missingTransactions).toHaveLength(0);
    expect(a.recordedNet).toBe(4000);
    expect(a.trueInflow).toBe(4000);
    expect(a.trueInflow).toBe(a.recordedNet);
  });

  it("restores the identity after a refresh (recorded rows only, re-derived)", () => {
    // Simulates what the analyzer persists (recorded rows only) and then
    // re-derives on restore: the three figures must keep their relationship.
    const recorded = rows.filter((r) => !isUnrecordedRow((r as any).receipt));
    const first = analyzeBalanceInflow(recorded as any);
    const second = analyzeBalanceInflow(recorded as any);
    expect(second.recordedNet).toBe(first.recordedNet);
    expect(second.unrecordedInflow).toBe(first.unrecordedInflow);
    expect(second.trueInflow).toBe(
      second.recordedNet + second.unrecordedInflow,
    );
  });
});
