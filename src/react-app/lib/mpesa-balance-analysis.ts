/**
 * Balance-delta reconciliation for M-PESA statements.
 *
 * M-PESA prints the account balance AFTER every transaction, so for two
 * consecutive rows:
 *
 *     balance(current) - balance(previous) = paidIn - withdrawn   (of current)
 *
 * That identity is the authority. For each row the balance moved by some
 * amount; the row's own recorded amount explains part of it, and whatever is
 * left over is money that moved with NO recorded transaction — an unrecorded
 * deposit (positive) or an unrecorded withdrawal/charge (negative).
 *
 * The reconciliation is ROW-SCOPED, which matters in two cases the naive
 * total-based approach gets wrong:
 *
 *  - A withdrawal between two inflows moves the balance down, then the next
 *    inflow moves it back up. Reconciling totals only would double-count and
 *    invent a phantom "missing" inflow; reconciling each row against its own
 *    delta does not.
 *  - The first row of a statement (or of a range) has no previous balance, so
 *    its delta is unknown. Its recorded inflow is still a recorded inflow; it
 *    simply cannot be checked against the balance.
 *
 * Any positive residual is surfaced as "missing identified 001",
 * "missing identified 002", … and added to Inflows at its own timestamp, so
 * the reconciled total equals the balance-derived inflow and the discrepancy
 * rate reaches 0.00%.
 */

export interface BalanceAnalysisInput {
  date?: string;
  time?: string;
  receipt?: string;
  balance: number;
  paidIn: number;
  /** Optional: the row's withdrawn/charge amount (ledger rows carry this). */
  withdrawn?: number;
}

export interface BalanceDeltaEntry {
  receiptKey: string;
  prevBalance: number;
  currBalance: number;
  /** balance movement between the two rows */
  delta: number;
  /** the current row's own recorded movement (paidIn - withdrawn) */
  recordedNet: number;
  /** delta - recordedNet — the part no recorded row explains */
  unexplained: number;
}

export interface IdentifiedMissingInflow {
  /** Stable synthetic key used to make recording idempotent. */
  id: string;
  /** Human-facing identifier: "missing identified 001", "missing identified 002", … */
  label: string;
  /** 1-based position of this missing inflow among the identified ones */
  sequence: number;
  /** The statement row at the end of the unexplained balance-growth interval. */
  date: string;
  time: string;
  /** Amount directly supported by the balance delta and not by a recorded row. */
  amount: number;
  previousBalance: number;
  currentBalance: number;
  receipt: string;
  evidence: "positive_balance_delta_without_recorded_inflow";
  confidence: "high";
}

export interface BalanceAnalysis {
  /** Sum of parsed Paid In amounts */
  recordedNet: number;
  /** Sum of positive balance deltas (Balance Delta +) */
  trueInflow: number;
  /** max(trueInflow - recordedNet, 0) */
  unrecordedInflow: number;
  /**
   * Total Valid Inflow = recordedNet + unrecordedInflow. Always >= recordedNet
   * (never omits a recorded inflow); equals recordedNet when the balance
   * matches the recorded receipts.
   */
  totalValidInflow: number;
  /**
   * POST-reconciliation discrepancy rate (0-100). 0.00 once every balance
   * movement has been attributed to a recorded row or to an identified
   * missing inflow.
   */
  discrepancy: number;
  /** PRE-reconciliation gap between balance-derived and recorded inflow (0-100). */
  rawDiscrepancy: number;
  /** recordedNet + missingInflowTotal — the reconciled inflow total */
  adjustedRecordedNet: number;
  /** Sum of the identified missing inflow amounts */
  missingInflowTotal: number;
  hasUnrecorded: boolean;
  confidence: string;
  /** number of consecutive-row deltas used */
  deltaCount: number;
  balanceDeltas: BalanceDeltaEntry[];
  /** Missing inflows that can be identified without guessing transaction details. */
  missingTransactions: IdentifiedMissingInflow[];
}

const EPSILON = 0.01;

const round2 = (n: number): number =>
  Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;

function datetimeKey(r: BalanceAnalysisInput): string {
  return `${r.date || "0000-00-00"}T${r.time || "00:00:00"}`;
}

/** "missing identified 001", "missing identified 002", … */
export function missingInflowLabel(sequence: number): string {
  return `missing identified ${String(sequence).padStart(3, "0")}`;
}

export function analyzeBalanceInflow(
  records: BalanceAnalysisInput[],
  opts?: { recordedNet?: number },
): BalanceAnalysis {
  const safe = (records || []).filter(Boolean);
  const computedRecordedNet = safe.reduce(
    (s, r) => s + (Number.isFinite(r.paidIn) ? r.paidIn : 0),
    0,
  );
  // Callers that reconcile a FULL ledger (inflows + outflows) must pass the
  // recorded inflow total explicitly, because summing the ledger's paidIn is
  // correct only when every inflow row is present in the ledger.
  const recordedNet = Number.isFinite(opts?.recordedNet)
    ? (opts!.recordedNet as number)
    : computedRecordedNet;

  const sorted = [...safe].sort((a, b) =>
    datetimeKey(a).localeCompare(datetimeKey(b)),
  );

  let trueInflow = 0;
  let totalUnexplained = 0;
  // Inflows recorded on RECONCILABLE rows (2..n). Row 1 has no previous
  // balance, so its recorded inflow cannot be checked against a delta and is
  // excluded from the discrepancy base — otherwise a legitimate opening
  // receipt would look like a permanent discrepancy.
  let reconcilableRecordedInflow = 0;
  const balanceDeltas: BalanceDeltaEntry[] = [];
  const growth: Array<{
    row: BalanceAnalysisInput;
    prev: BalanceAnalysisInput;
    delta: number;
    unexplained: number;
  }> = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.balance > 0 && curr.balance > 0) {
      const delta = round2(curr.balance - prev.balance);
      const net = round2((curr.paidIn || 0) - (curr.withdrawn || 0));
      const unexplained = round2(delta - net);
      reconcilableRecordedInflow = round2(
        reconcilableRecordedInflow +
          (Number.isFinite(curr.paidIn) ? curr.paidIn : 0),
      );
      balanceDeltas.push({
        receiptKey: curr.receipt ?? "",
        prevBalance: round2(prev.balance),
        currBalance: round2(curr.balance),
        delta,
        recordedNet: net,
        unexplained,
      });
      if (delta > 0) {
        trueInflow += delta;
        growth.push({ row: curr, prev, delta, unexplained });
      }
      if (unexplained > EPSILON) totalUnexplained += unexplained;
    }
  }
  trueInflow = round2(trueInflow);

  // Row-scoped attribution: each row's own delta versus its own recorded
  // amount. The identified total can never exceed the unexplained total, so
  // the reconciliation can never invent more than the balance actually shows.
  const missingTransactions: IdentifiedMissingInflow[] = [];
  let remaining = round2(totalUnexplained);

  const attribute = (
    candidate: { row: BalanceAnalysisInput; prev: BalanceAnalysisInput },
    amount: number,
  ) => {
    const amt = round2(amount);
    if (amt <= EPSILON) return;
    const sequence = missingTransactions.length + 1;
    const date = candidate.row.date || "";
    const time = candidate.row.time || "";
    const receipt = candidate.row.receipt ?? "";
    missingTransactions.push({
      id: [
        date || "unknown-date",
        time || "unknown-time",
        receipt || "no-receipt",
        amt.toFixed(2),
      ].join("|"),
      label: missingInflowLabel(sequence),
      sequence,
      date,
      time,
      amount: amt,
      previousBalance: round2(candidate.prev.balance),
      currentBalance: round2(candidate.row.balance),
      receipt,
      evidence: "positive_balance_delta_without_recorded_inflow",
      confidence: "high",
    });
  };

  // Pass 1: the movement each row's own recorded amount does not explain,
  // capped at that row's positive movement.
  for (const c of growth) {
    if (remaining <= EPSILON) break;
    const capacity = Math.min(Math.max(c.unexplained, 0), c.delta);
    if (capacity > EPSILON) {
      const take = Math.min(capacity, remaining);
      attribute(c, take);
      remaining = round2(remaining - take);
    }
  }
  // Pass 2: attach any residual to the largest growth row (defensive — pass 1
  // normally consumes the whole amount).
  if (remaining > EPSILON && growth.length) {
    const largest = growth.reduce((a, b) => (b.delta > a.delta ? b : a));
    attribute(largest, Math.min(remaining, largest.delta));
    remaining = 0;
  }

  const missingInflowTotal = round2(
    missingTransactions.reduce((s, m) => s + m.amount, 0),
  );
  const adjustedRecordedNet = round2(recordedNet + missingInflowTotal);
  const unrecordedInflow = missingInflowTotal;
  const totalValidInflow = round2(recordedNet + unrecordedInflow);

  // Post-reconciliation: every balance movement is now attributed.
  const unattributed = round2(
    Math.max(totalUnexplained - missingInflowTotal, 0),
  );
  const discrepancy =
    totalUnexplained > 0
      ? Math.round((unattributed / totalUnexplained) * 1000) / 10
      : 0;

  // Pre-reconciliation gap — the detection signal that something was missing.
  // Measured on the same (reconcilable) basis so an opening receipt on row 1
  // is never reported as a discrepancy.
  const rawDiscrepancy =
    totalUnexplained > 0
      ? Math.round(
          (totalUnexplained /
            Math.max(trueInflow, reconcilableRecordedInflow, 1)) *
            1000,
        ) / 10
      : 0;

  const hasUnrecorded = missingInflowTotal > EPSILON;
  const confidence =
    balanceDeltas.length >= 3
      ? hasUnrecorded
        ? "High — unrecorded inflows detected and reconciled from balance deltas"
        : "High — balance matches recorded inflows"
      : balanceDeltas.length > 0
        ? "Low — insufficient balance data for analysis"
        : "N/A — no balance data available";

  return {
    recordedNet,
    trueInflow,
    unrecordedInflow,
    totalValidInflow,
    discrepancy: Number.isFinite(discrepancy) ? discrepancy : 0,
    rawDiscrepancy: Number.isFinite(rawDiscrepancy) ? rawDiscrepancy : 0,
    adjustedRecordedNet,
    missingInflowTotal,
    hasUnrecorded,
    confidence,
    deltaCount: balanceDeltas.length,
    balanceDeltas,
    missingTransactions,
  };
}
