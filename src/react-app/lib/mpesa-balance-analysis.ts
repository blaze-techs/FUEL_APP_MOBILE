/**
 * Balance-delta reconciliation for M-PESA statements.
 *
 * M-PESA prints the account balance AFTER every transaction, so for two
 * consecutive rows:
 *
 *     unrecorded paid-in = max(balance(current) - balance(previous) - paidIn(current), 0)
 *
 * The statement's balance column is the authority. Rows are processed in
 * chronological order (previous row first, current row second). Only positive
 * residuals on rows where the balance increased can support an inferred
 * unrecorded paid-in; negative/zero residuals are clamped to zero.
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
 * Positive residuals are returned as balance-derived evidence. The UI may show
 * them as clearly labelled inferred rows in Inflows, but must not persist them
 * as source statement transactions or count them twice in recorded Paid In.
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
  opts?: {
    recordedNet?: number;
    /**
     * Receipts that were captured as inflows elsewhere (e.g. the parser's
     * inflow list when `records` is the ledger). A captured receipt is recorded
     * money, so a ledger row carrying no positive paid-in for that receipt must
     * not be reported as a "missing identified" unrecorded inflow.
     */
    capturedReceipts?: Array<{
      receipt?: string;
      paidIn: number;
      date?: string;
      time?: string;
    }>;
  },
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
  // A receipt that was ALREADY captured as an inflow is recorded money, even
  // when its ledger row carries no positive paid-in — the parser records the
  // amount on the inflow row and can leave the ledger row at 0 when a charge
  // prints beside the deposit (or the amount sits on another sub-row of the
  // same block). Crediting it against that row's own residual stops a captured
  // receipt from ALSO being reported as "missing identified NNN". Live report:
  // receipt UJE48AXQFY, "Payment from 254711***988 - JOSEPH EBEI, 4,000.00"
  // (07:13:48) was counted as an inflow AND as missing identified 002.
  const capturedByReceipt = new Map<string, number>();
  const capturedByTime = new Map<string, number>();
  const seenCaptured = new Set<string>();
  const timeKey = (d?: string, t?: string) => (d || "") + "T" + (t || "");
  const addCaptured = (
    receipt: string | undefined,
    paid: number,
    date?: string,
    time?: string,
  ) => {
    if (!(paid > EPSILON)) return;
    const key = (receipt || "").trim().toUpperCase();
    const tk = timeKey(date, time);
    // A receipt is transaction-unique. Deduplicate repeated parser rows so the
    // same captured payment cannot be counted twice in the balance analysis.
    const fingerprint = key
      ? "receipt:" + key
      : tk !== "T"
        ? "time:" + tk + ":" + round2(paid).toFixed(2)
        : "unkeyed:" + round2(paid).toFixed(2);
    if (seenCaptured.has(fingerprint)) return;
    seenCaptured.add(fingerprint);
    if (key) {
      capturedByReceipt.set(key, Math.max(capturedByReceipt.get(key) || 0, round2(paid)));
    }
    // Fallback index for a ledger row whose receipt is empty/garbled.
    if (tk !== "T") {
      capturedByTime.set(tk, round2((capturedByTime.get(tk) || 0) + paid));
    }
  };
  const consumedReceiptKeys = new Set<string>();
  const consumedTimeKeys = new Set<string>();
  const capturedFor = (row: BalanceAnalysisInput): number => {
    const key = (row.receipt || "").trim().toUpperCase();
    const byReceipt = key ? capturedByReceipt.get(key) : undefined;
    if (byReceipt !== undefined) {
      if (consumedReceiptKeys.has(key)) return 0;
      consumedReceiptKeys.add(key);
      return byReceipt;
    }
    const tk = timeKey(row.date, row.time);
    if (tk === "T" || consumedTimeKeys.has(tk)) return 0;
    consumedTimeKeys.add(tk);
    return capturedByTime.get(tk) || 0;
  };
  // Only a row that actually GREW the balance can prove an unrecorded paid-in.
  // A row whose balance is unchanged (X -> X) or fell proves nothing: any
  // recorded withdrawal on it is either reflected in another row's balance or
  // is a duplicate ledger entry, so attributing a positive residual there
  // produced phantom rows such as "72,964.06 -> 72,964.06 = +12,000.00"
  // (which must be 0.00). Each attributable row carries its own residual as
  // its capacity, so one row is credited exactly once and the identified total
  // reproduces `totalUnexplained` exactly.
  const attributable: Array<{
    row: BalanceAnalysisInput;
    prev: BalanceAnalysisInput;
    capacity: number;
  }> = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    // Zero is a valid opening/current balance. Requiring both balances to
    // be strictly positive skipped deposits that followed a zero-balance row.
    if (
      Number.isFinite(prev.balance) &&
      Number.isFinite(curr.balance) &&
      prev.balance >= 0 &&
      curr.balance >= 0
    ) {
      const delta = round2(curr.balance - prev.balance);
      const currentPaidIn = Number.isFinite(curr.paidIn) ? curr.paidIn : 0;
      const net = round2(currentPaidIn);
      const unexplained = round2(delta - currentPaidIn);
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
      if (delta > EPSILON) {
        trueInflow += delta;
        const growth = round2(Math.max(unexplained, 0));
        // If the row itself carried no paid-in but its receipt was captured as
        // an inflow elsewhere, that receipt already explains part of the
        // growth — it is recorded money, not an unrecorded inflow. When the
        // row DID carry a paid-in it is already netted in `unexplained`, so no
        // extra credit is applied (otherwise a genuine additional deposit on
        // the same receipt would be wrongly suppressed).
        const rowPaidIn = Number.isFinite(curr.paidIn) ? curr.paidIn : 0;
        const captured = rowPaidIn > EPSILON ? 0 : capturedFor(curr);
        const alreadyRecorded = round2(Math.min(captured, growth));
        const capacity = round2(growth - alreadyRecorded);
        if (capacity > EPSILON) {
          totalUnexplained = round2(totalUnexplained + capacity);
          attributable.push({ row: curr, prev, capacity });
        }
      }
    }
  }
  trueInflow = round2(trueInflow);

  const missingTransactions: IdentifiedMissingInflow[] = [];

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

  // One entry per row, capped at that row's own residual. Summing the
  // capacities reproduces `totalUnexplained` exactly, so the identified total
  // can never exceed (or fall short of) what the balance proves.
  for (const c of attributable) {
    attribute(c, c.capacity);
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
  // A comparison is reconciled only when the independently computed balance
  // movement and the parsed Paid In total agree within one cent. A statement
  // whose movement is under-recorded must NOT be labelled "balance matches"
  // merely because the positive-only missing-inflow estimate was consumed.
  const discrepancyAmount = Math.abs(round2(trueInflow - recordedNet));
  const isReconciled = discrepancyAmount <= EPSILON;
  const confidence =
    balanceDeltas.length >= 3
      ? isReconciled
        ? "High — balance matches recorded inflows"
        : hasUnrecorded
          ? "High — unrecorded inflows detected and reconciled from balance deltas"
          : "Medium — balance movement does not match recorded inflows"
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
