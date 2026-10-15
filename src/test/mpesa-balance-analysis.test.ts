import { describe, expect, it } from "vitest";
import { parseMpesaLines } from "@/react-app/lib/mpesa-statement-parser";
import {
  analyzeBalanceInflow,
  missingInflowLabel,
} from "@/react-app/lib/mpesa-balance-analysis";

const row = (
  date: string,
  time: string,
  balance: number,
  paidIn: number,
  withdrawn = 0,
  receipt = "",
) => ({ date, time, balance, paidIn, withdrawn, receipt });

describe("analyzeBalanceInflow — row-scoped balance reconciliation", () => {
  it("labels identified missing inflows 'missing identified 001…'", () => {
    expect(missingInflowLabel(1)).toBe("missing identified 001");
    expect(missingInflowLabel(2)).toBe("missing identified 002");
    expect(missingInflowLabel(12)).toBe("missing identified 012");
  });

  it("finds an unrecorded paid-in that has no parsed row", () => {
    // Row 2's balance grew 4000 with NO recorded row at that timestamp.
    const rows = [
      row("2026-09-01", "09:00:00", 1000, 500, 0, "A"),
      row("2026-09-01", "12:00:00", 5000, 0, 0, ""),
      row("2026-09-02", "09:00:00", 5300, 300, 0, "C"),
    ];
    const a = analyzeBalanceInflow(rows, { recordedNet: 800 });
    expect(a.missingTransactions).toHaveLength(1);
    expect(a.missingTransactions[0].label).toBe("missing identified 001");
    expect(a.missingTransactions[0].amount).toBe(4000);
    expect(a.missingTransactions[0].date).toBe("2026-09-01");
    expect(a.missingTransactions[0].time).toBe("12:00:00");
    expect(a.missingTransactions[0].previousBalance).toBe(1000);
    expect(a.missingTransactions[0].currentBalance).toBe(5000);
    expect(a.unrecordedInflow).toBe(4000);
    expect(a.totalValidInflow).toBe(4800);
    expect(a.discrepancy).toBe(0);
  });

  it("does NOT invent a missing inflow when a withdrawal then an inflow cancel out", () => {
    // 5000 -> 3000 (withdrew 2000, recorded) -> 5000 (received 2000, recorded)
    const rows = [
      row("2026-09-01", "09:00:00", 5000, 0, 0, "OPEN"),
      row("2026-09-01", "10:00:00", 3000, 0, 2000, "W1"),
      row("2026-09-01", "11:00:00", 5000, 2000, 0, "R1"),
    ];
    const a = analyzeBalanceInflow(rows, { recordedNet: 2000 });
    expect(a.missingTransactions).toHaveLength(0);
    expect(a.unrecordedInflow).toBe(0);
    expect(a.totalValidInflow).toBe(2000);
    expect(a.discrepancy).toBe(0);
    expect(a.trueInflow).toBe(2000);
  });

  it("reaches 0.00% discrepancy after reconciliation when money is missing", () => {
    const rows = [
      row("2026-09-01", "09:00:00", 1000, 200, 0, "A"), // opening (no prev)
      row("2026-09-01", "10:00:00", 1500, 300, 0, "B"), // +500 vs 300 -> 200 missing
      row("2026-09-01", "12:00:00", 1900, 0, 0, ""), // +400 vs 0  -> 400 missing
      row("2026-09-01", "13:00:00", 2100, 200, 0, "D"), // +200 vs 200 -> ok
    ];
    const a = analyzeBalanceInflow(rows, { recordedNet: 700 });
    // 200 (B) + 400 (C) = 600 of balance growth no recorded row explains.
    expect(a.missingInflowTotal).toBe(600);
    expect(a.discrepancy).toBe(0);
    expect(a.rawDiscrepancy).toBeGreaterThan(0);
    // Reconciled total = every recorded inflow + every identified missing one.
    expect(a.adjustedRecordedNet).toBe(1300);
    expect(a.totalValidInflow).toBe(1300);
    // The reconcilable basis balances exactly: recorded deltas + missing = inflow.
    expect(a.trueInflow).toBe(1100);
  });

  it("never lets the identified total exceed what the balance actually shows", () => {
    // No positive movement at all -> nothing can be missing.
    const rows = [
      row("2026-09-01", "09:00:00", 5000, 0, 0, "A"),
      row("2026-09-01", "10:00:00", 4500, 0, 500, "B"),
      row("2026-09-01", "11:00:00", 4000, 0, 500, "C"),
    ];
    const a = analyzeBalanceInflow(rows, { recordedNet: 0 });
    expect(a.missingTransactions).toHaveLength(0);
    expect(a.trueInflow).toBe(0);
    expect(a.unrecordedInflow).toBe(0);
    expect(a.discrepancy).toBe(0);
  });

  it("counts a first-row recorded inflow without needing a previous balance", () => {
    // Row 1 has a printed opening balance, so row 2's delta is reconcilable.
    // The FIRST row's own inflow is still counted in the recorded total even
    // though no earlier row exists to check it against.
    const rows = [
      row("2026-09-01", "08:00:00", 500, 1000, 0, "FIRST"),
      row("2026-09-01", "09:00:00", 1000, 500, 0, "B"),
    ];
    const a = analyzeBalanceInflow(rows, { recordedNet: 1500 });
    expect(a.recordedNet).toBe(1500);
    expect(a.trueInflow).toBe(500); // B: 500 -> 1000
    expect(a.missingTransactions).toHaveLength(0);
    expect(a.discrepancy).toBe(0);
    expect(a.totalValidInflow).toBe(1500);
  });

  it("does not treat an un-reconcilable opening receipt as a discrepancy", () => {
    // Row 1's balance is unknown (0), so row 2 cannot be reconciled. Nothing
    // is unexplained, so the discrepancy stays 0.00% and the recorded inflow
    // is still fully counted.
    const rows = [
      row("2026-09-01", "08:00:00", 0, 1000, 0, "FIRST"),
      row("2026-09-01", "09:00:00", 1500, 500, 0, "B"),
    ];
    const a = analyzeBalanceInflow(rows, { recordedNet: 1500 });
    expect(a.trueInflow).toBe(0);
    expect(a.missingTransactions).toHaveLength(0);
    expect(a.discrepancy).toBe(0);
    expect(a.rawDiscrepancy).toBe(0);
    expect(a.totalValidInflow).toBe(1500);
  });

  it("identifies multiple separate unrecorded paid-ins in sequence", () => {
    const rows = [
      row("2026-09-01", "09:00:00", 1000, 0, 0, "OPEN"),
      row("2026-09-01", "10:00:00", 1500, 0, 0, ""), // +500 missing 001
      row("2026-09-01", "11:00:00", 1500, 0, 0, "SAME"),
      row("2026-09-01", "12:00:00", 2300, 0, 0, ""), // +800 missing 002
    ];
    const a = analyzeBalanceInflow(rows, { recordedNet: 0 });
    expect(a.missingTransactions.map((m) => m.label)).toEqual([
      "missing identified 001",
      "missing identified 002",
    ]);
    expect(a.missingTransactions.map((m) => m.amount)).toEqual([500, 800]);
    expect(a.missingInflowTotal).toBe(1300);
    expect(a.discrepancy).toBe(0);
    expect(a.totalValidInflow).toBe(1300);
  });

  it("is stable across sort orders", () => {
    const rows = [
      row("2026-09-01", "09:00:00", 1000, 500, 0, "A"),
      row("2026-09-01", "12:00:00", 5000, 0, 0, ""),
      row("2026-09-02", "09:00:00", 5300, 300, 0, "C"),
    ];
    const a = analyzeBalanceInflow([...rows].reverse(), { recordedNet: 800 });
    expect(a.missingInflowTotal).toBe(4000);
    expect(a.discrepancy).toBe(0);
  });

  it("treats an empty set as zero", () => {
    const a = analyzeBalanceInflow([]);
    expect(a.trueInflow).toBe(0);
    expect(a.unrecordedInflow).toBe(0);
    expect(a.hasUnrecorded).toBe(false);
    expect(a.totalValidInflow).toBe(0);
    expect(a.discrepancy).toBe(0);
  });

  it("defaults recordedNet from the rows when not supplied", () => {
    const rows = [
      row("2026-09-01", "09:00:00", 1000, 500, 0, "A"),
      row("2026-09-01", "10:00:00", 1800, 0, 0, ""), // +800 unrecorded
    ];
    const a = analyzeBalanceInflow(rows);
    expect(a.recordedNet).toBe(500);
    expect(a.missingInflowTotal).toBe(800);
    expect(a.totalValidInflow).toBe(1300);
    expect(a.discrepancy).toBe(0);
  });
});

describe("parser ledger + reconciliation integration", () => {
  it("detects an unrecorded deposit end-to-end from raw statement rows", () => {
    const rows = [
      "TI00000001 2025-09-06 Merchant Payment from Completed 100.00 0.00 100.00 Customer 578590-",
      "18:00:00 0746***921 - isaac alemu aleper Merchant PUBLICAN",
      "Payment ENERGY",
      // balance jumps 100 -> 4150 with only 50.00 recorded -> 4000 unrecorded
      "TI00000003 2025-09-06 Merchant Payment from Completed 50.00 0.00 4150.00 Customer 578590-",
      "18:10:00 0723***798 - Longorot Simon Merchant PUBLICAN",
      "Lopatio Payment ENERGY",
    ];
    const res = parseMpesaLines(rows);
    expect(res.inflows).toHaveLength(2);
    // The ledger carries both rows with their printed balances.
    expect(res.ledger).toHaveLength(2);

    const st = analyzeBalanceInflow(res.ledger, {
      recordedNet: res.inflows.reduce((s, r) => s + r.paidIn, 0),
    });
    expect(st.recordedNet).toBe(150);
    expect(st.missingInflowTotal).toBe(4000);
    expect(st.missingTransactions[0].label).toBe("missing identified 001");
    expect(st.missingTransactions[0].amount).toBe(4000);
    expect(st.unrecordedInflow).toBe(4000);
    expect(st.totalValidInflow).toBe(4150);
    expect(st.discrepancy).toBe(0);
    expect(st.rawDiscrepancy).toBeGreaterThan(0);
  });

  it("reconciles to 0.00% when a withdrawal sits between two inflows", () => {
    const rows = [
      "TI00000001 2025-09-06 Merchant Payment from Completed 500.00 0.00 500.00 Customer 578590-",
      "18:00:00 0746***921 - isaac aleper Merchant PUBLICAN",
      "Payment ENERGY",
      "TI00000002 2025-09-06 Withdrawal Charge Completed 0.00 200.00 300.00 OD Payment 804080-Boost",
      "18:05:00 Transfer Biashara",
      "TI00000003 2025-09-06 Merchant Payment from Completed 300.00 0.00 600.00 Customer 578590-",
      "18:10:00 0723***798 - Longorot Simon Merchant PUBLICAN",
      "Lopatio Payment ENERGY",
    ];
    const res = parseMpesaLines(rows);
    const st = analyzeBalanceInflow(res.ledger, {
      recordedNet: res.inflows.reduce((s, r) => s + r.paidIn, 0),
    });
    // 500 -> 300 (withdrew 200) -> 600 (received 300): fully explained.
    expect(st.missingTransactions).toHaveLength(0);
    expect(st.unrecordedInflow).toBe(0);
    expect(st.discrepancy).toBe(0);
    expect(st.totalValidInflow).toBe(st.recordedNet);
  });

  it("reconciled total includes the identified missing inflow (operating revenue must match the range filter)", () => {
    // Receipts total 800, but the balance grew by an extra 4000 at a row that
    // carried NO recorded amount. The range filter renders the reconciled
    // total (recorded + unrecorded), so "operating revenue" must use the SAME
    // figure — otherwise it is silently LOWER than the filtered result.
    const ledger = [
      row("2026-09-01", "09:00:00", 1000, 500, 0, "A"),
      row("2026-09-01", "12:00:00", 5000, 0, 0, ""), // unrecorded +4000
      row("2026-09-02", "09:00:00", 5300, 300, 0, "C"),
    ];
    const recordedNet = 800;
    const a = analyzeBalanceInflow(ledger, { recordedNet });

    expect(a.recordedNet).toBe(800);
    expect(a.unrecordedInflow).toBe(4000);
    // The reconciled total = recorded + unrecorded. This is the value BOTH
    // "Operating Revenue" and the Range Filter's "Filtered Result" must show.
    expect(a.totalValidInflow).toBe(4800);
    // The old operating revenue showed only `recordedNet` (800) — strictly
    // less than the filtered result (4800). That gap is the bug.
    expect(a.totalValidInflow).toBeGreaterThan(a.recordedNet);
  });

  it("never credits the same balance movement twice (no duplicate missing inflows)", () => {
    // Regression: a row that both grew the balance AND carried a withdrawal
    // has unexplained = delta - net > delta. The old Pass 1 capped at delta,
    // leaving a residual that Pass 2 dumped onto the single largest growth
    // row — which had ALREADY been credited — so the same movement appeared
    // twice (seen live as identical "missing identified 028" / "…048").
    const ledger = [
      row("2026-09-01", "09:00:00", 1000, 0, 0, "OPEN"),
      // +1000 balance while also withdrawing 500 => 1500 unrecorded in
      row("2026-09-01", "10:00:00", 2000, 0, 500, "B"),
      // clean +3000 growth (the "largest" row the old Pass 2 targeted)
      row("2026-09-01", "11:00:00", 5000, 0, 0, "C"),
    ];
    const a = analyzeBalanceInflow(ledger, { recordedNet: 0 });

    // One entry per row — no row is credited more than once.
    const ids = a.missingTransactions.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const receipts = a.missingTransactions.map((m) => m.receipt);
    expect(new Set(receipts).size).toBe(receipts.length);

    // The identified total can never exceed what the balance actually shows,
    // so the reconciliation can never invent more than the movement proves.
    // (Row B proves 1500 = +1000 growth with a 500 withdrawal; row C proves
    // 3000. Total 4500, and nothing is double-counted.)
    expect(a.missingInflowTotal).toBe(4500);
    expect(a.discrepancy).toBe(0);
    expect(
      a.missingTransactions.map((m) => m.amount).sort((x, y) => x - y),
    ).toEqual([1500, 3000]);
  });
});
