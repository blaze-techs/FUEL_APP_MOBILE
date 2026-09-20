/**
 * Balance-delta "True Inflow" detection for M-PESA statements.
 *
 * True Inflow (Balance Delta +) = sum of POSITIVE balance deltas between
 * consecutive rows that carry a known (> 0) balance. This method naturally
 * captures "unrecorded inflows" — money that arrived and grew the balance but
 * was not captured as an individual parsed row (e.g. deposits the receipt
 * parser could not classify). It is the method recommended in the Balance
 * Analysis panel for financial reporting.
 *
 * Total Valid Inflow = recorded net (extracted Paid In) + unrecorded inflow.
 * This is the figure used for the Range Filter's "Total Valid Inflow": it
 * always includes every extracted inflow within the range AND tops up any
 * balance growth that the parser did not capture as a row — so it is never
 * lower than the extracted sum.
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

export interface IdentifiedMissingInflow {
  /** Stable synthetic key used to make recording idempotent. */
  id: string;
  /** The statement row at the end of the unexplained balance-growth interval. */
  date: string;
  time: string;
  /** Amount that is directly supported by the balance delta and not by a parsed Paid In. */
  amount: number;
  previousBalance: number;
  currentBalance: number;
  receipt: string;
  evidence: "positive_balance_delta_without_parsed_inflow";
  confidence: "high";
}

export interface BalanceAnalysis {
  /** Sum of all parsed Paid In amounts */
  recordedNet: number;
  /** Sum of positive balance deltas (Balance Delta +) */
  trueInflow: number;
  /** max(trueInflow - recordedNet, 0) */
  unrecordedInflow: number;
  /**
   * Total Valid Inflow = recordedNet + unrecordedInflow. Always >= recordedNet
   * (never omits an extracted inflow); equals recordedNet when the balance
   * matches the recorded receipts.
   */
  totalValidInflow: number;
  /** |true - recorded| / recorded as a 0-100 percentage (0 when no recorded) */
  discrepancy: number;
  hasUnrecorded: boolean;
  confidence: string;
  /** number of consecutive-row deltas used */
  deltaCount: number;
  balanceDeltas: BalanceDeltaEntry[];
  /** Missing inflows that can be identified without guessing transaction details. */
  missingTransactions: IdentifiedMissingInflow[];
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
  const missingTransactions: IdentifiedMissingInflow[] = [];
  const EPSILON = 0.01;

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

        // Only auto-identify a missing transaction when the current statement
        // row contains NO parsed Paid In. This is intentionally conservative:
        // a partial mismatch (delta > paidIn) can be caused by the statement
        // range starting mid-stream or by an earlier row's opening balance,
        // so recording it as a synthetic transaction would invent data.
        const currentPaidIn = Number.isFinite(curr.paidIn) ? curr.paidIn : 0;
        if (currentPaidIn <= EPSILON) {
          const amount = Math.round(delta * 100) / 100;
          if (amount > EPSILON) {
            const id = [
              curr.date || "unknown-date",
              curr.time || "unknown-time",
              curr.receipt || "no-receipt",
              amount.toFixed(2),
            ].join("|");
            missingTransactions.push({
              id,
              date: curr.date || "",
              time: curr.time || "",
              amount,
              previousBalance: Math.round(prev.balance * 100) / 100,
              currentBalance: Math.round(curr.balance * 100) / 100,
              receipt: curr.receipt ?? "",
              evidence: "positive_balance_delta_without_parsed_inflow",
              confidence: "high",
            });
          }
        }
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

  const safeRecordedNet = Number.isFinite(recordedNet) ? recordedNet : 0;
  const safeUnrecorded = Number.isFinite(unrecordedInflow)
    ? unrecordedInflow
    : 0;
  const totalValidInflow =
    Math.round((safeRecordedNet + safeUnrecorded) * 100) / 100;

  return {
    recordedNet,
    trueInflow,
    unrecordedInflow: Math.round(unrecordedInflow * 100) / 100,
    totalValidInflow,
    discrepancy: Number.isFinite(discrepancy)
      ? Math.round(discrepancy * 1000) / 10
      : 0,
    hasUnrecorded,
    confidence,
    deltaCount: balanceDeltas.length,
    balanceDeltas,
    missingTransactions,
  };
}
