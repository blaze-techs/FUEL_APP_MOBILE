/**
 * Balance-delta "True Inflow" detection for M-PESA statements.
 *
 * True Inflow (Balance Delta +) = sum of POSITIVE balance deltas between
 * consecutive rows that carry a known (> 0) balance. This method naturally
 * captures "unrecorded inflows" — money that arrived and grew the balance but
 * was not captured as an individual parsed row (e.g. deposits the receipt
 * parser could not classify). It is the method recommended in the Balance
 * Analysis panel for financial reporting.
 */

export interface BalanceAnalysisInput {
  date?: string;
  time?: string;
  receipt?: string;
  balance: number;
  paidIn: number;
}

export interface BalanceDeltaEntry {
  receiptKey: string;
  prevBalance: number;
  currBalance: number;
  delta: number;
}

export interface BalanceAnalysis {
  /** Sum of all parsed Paid In amounts */
  recordedNet: number;
  /** Sum of positive balance deltas (Balance Delta +) */
  trueInflow: number;
  /** max(trueInflow - recordedNet, 0) */
  unrecordedInflow: number;
  /** |true - recorded| / recorded as a 0-100 percentage (0 when no recorded) */
  discrepancy: number;
  hasUnrecorded: boolean;
  confidence: string;
  /** number of consecutive-row deltas used */
  deltaCount: number;
  balanceDeltas: BalanceDeltaEntry[];
}

function datetimeKey(r: BalanceAnalysisInput): string {
  return `${r.date || "0000-00-00"}T${r.time || "00:00:00"}`;
}

export function analyzeBalanceInflow(
  records: BalanceAnalysisInput[],
): BalanceAnalysis {
  const recordedNet = records.reduce(
    (s, r) => s + (Number.isFinite(r.paidIn) ? r.paidIn : 0),
    0,
  );
  const sorted = [...records].sort((a, b) =>
    datetimeKey(a).localeCompare(datetimeKey(b)),
  );

  let trueInflow = 0;
  const balanceDeltas: BalanceDeltaEntry[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.balance > 0 && curr.balance > 0) {
      const delta = curr.balance - prev.balance;
      balanceDeltas.push({
        receiptKey: curr.receipt ?? "",
        prevBalance: prev.balance,
        currBalance: curr.balance,
        delta: Math.round(delta * 100) / 100,
      });
      if (delta > 0) {
        trueInflow += delta;
      }
    }
  }

  trueInflow = Math.round(trueInflow * 100) / 100;
  const unrecordedInflow = Math.max(trueInflow - recordedNet, 0);
  const safeRecorded =
    Number.isFinite(recordedNet) && recordedNet > 0 ? recordedNet : 0;
  const safeTrue = Number.isFinite(trueInflow) ? trueInflow : 0;
  const discrepancy =
    safeRecorded > 0
      ? Math.min(Math.abs(safeTrue - safeRecorded) / safeRecorded, 1)
      : 0;

  const hasUnrecorded = unrecordedInflow > 0.01;
  const confidence =
    balanceDeltas.length >= 3
      ? hasUnrecorded
        ? "Medium — unrecorded inflows detected via balance deltas"
        : "High — balance matches recorded inflows"
      : balanceDeltas.length > 0
        ? "Low — insufficient balance data for analysis"
        : "N/A — no balance data available";

  return {
    recordedNet,
    trueInflow,
    unrecordedInflow: Math.round(unrecordedInflow * 100) / 100,
    discrepancy: Number.isFinite(discrepancy)
      ? Math.round(discrepancy * 1000) / 10
      : 0,
    hasUnrecorded,
    confidence,
    deltaCount: balanceDeltas.length,
    balanceDeltas,
  };
}
