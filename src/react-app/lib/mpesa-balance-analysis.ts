/**
 * Balance-delta "True Inflow" detection for M-PESA statements.
 *
 * Three figures, computed in this order:
 *
 *   1. Recorded Net (Paid In)
 *        = the sum of the Paid In amounts extracted from the statement records.
 *
 *   2. Unrecorded Inflow  (per row)
 *        = (Current balance − Previous balance − Current Paid In)
 *      counted ONLY when that value is greater than zero. A positive value
 *      means the row carries balance growth the recorded Paid In does NOT
 *      account for, i.e. an unrecorded inflow transaction. Because the row's
 *      own Paid In is subtracted, money already in "Recorded Net (Paid In)" is
 *      never counted a second time.
 *
 *   3. True Inflow (Balance Delta +)
 *        = Recorded Net (Paid In) + Unrecorded Inflow.
 *      By construction it equals the recorded net whenever there is no
 *      unrecorded inflow.
 *
 * The same identity drives the Range Filter's "Total Valid Inflow": it always
 * includes every extracted inflow within the range and tops up only the balance
 * growth the parser did not capture, so it is never lower than the extracted
 * sum.
 */

export interface BalanceAnalysisInput {
  date?: string;
  time?: string;
  receipt?: string;
  balance: number;
  paidIn: number;
  /** Recorded withdrawal on this row, used only to index the ledger. */
  withdrawn?: number;
}

export interface BalanceDeltaEntry {
  receiptKey: string;
  prevBalance: number;
  currBalance: number;
  /** Printed balance movement: current − previous. */
  delta: number;
  /** Paid In recorded on the current row. */
  paidIn: number;
  /** Balance movement the recorded Paid In does not account for. */
  residual: number;
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

/**
 * Marker prefix for a synthetic balance-reconciliation row. Such a row is the
 * "Unrecorded Inflow" — it is NOT a recorded statement line and must never be
 * counted as Recorded Net (Paid In), nor persisted back as recorded money.
 */
export const MISSING_RECEIPT_PREFIX = "MISSING-";

/** True when a receipt identifies a synthetic unrecorded-inflow row. */
export function isUnrecordedRow(receipt?: string | null): boolean {
  return String(receipt || "").startsWith(MISSING_RECEIPT_PREFIX);
}

export function analyzeBalanceInflow(
  records: BalanceAnalysisInput[],
): BalanceAnalysis {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // ===== 1. RECORDED NET (PAID IN) =====
  // The sum of the Paid In amounts extracted from the M-PESA statement records.
  const recordedNet = round2(
    records.reduce((s, r) => s + (Number.isFinite(r.paidIn) ? r.paidIn : 0), 0),
  );
  const sorted = [...records].sort((a, b) =>
    datetimeKey(a).localeCompare(datetimeKey(b)),
  );

  const balanceDeltas: BalanceDeltaEntry[] = [];
  const missingTransactions: IdentifiedMissingInflow[] = [];
  const EPSILON = 0.01;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.balance > 0 && curr.balance > 0) {
      const delta = round2(curr.balance - prev.balance);
      const currentPaidIn = Number.isFinite(curr.paidIn) ? curr.paidIn : 0;
      // ===== 2. UNRECORDED INFLOW (per row) =====
      // (Current balance − Previous balance − Current Paid In). When this is
      // greater than zero, the row carries balance growth the recorded Paid In
      // does NOT account for — an unrecorded inflow transaction. It is
      // necessarily money the "Recorded Net (Paid In)" total did not include.
      const residual = round2(delta - currentPaidIn);
      balanceDeltas.push({
        receiptKey: curr.receipt ?? "",
        prevBalance: round2(prev.balance),
        currBalance: round2(curr.balance),
        delta,
        paidIn: round2(currentPaidIn),
        residual,
      });
      if (residual > EPSILON) {
        const id = [
          curr.date || "unknown-date",
          curr.time || "unknown-time",
          curr.receipt || "no-receipt",
          residual.toFixed(2),
        ].join("|");
        missingTransactions.push({
          id,
          date: curr.date || "",
          time: curr.time || "",
          amount: residual,
          previousBalance: round2(prev.balance),
          currentBalance: round2(curr.balance),
          receipt: curr.receipt ?? "",
          evidence: "positive_balance_delta_without_parsed_inflow",
          confidence: "high",
        });
      }
    }
  }

  // The identified unrecorded inflow is exactly the sum of the per-row
  // residuals that were greater than zero.
  const unrecordedInflow = round2(
    missingTransactions.reduce((s, m) => s + m.amount, 0),
  );
  // ===== 3. TRUE INFLOW (BALANCE DELTA +) =====
  // True Inflow = Recorded Net (Paid In) + Unrecorded Inflow. By construction
  // it equals the recorded net whenever there is no unrecorded inflow.
  const trueInflow = round2(recordedNet + unrecordedInflow);
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
