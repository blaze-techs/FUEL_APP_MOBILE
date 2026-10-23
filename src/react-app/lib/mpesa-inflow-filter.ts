/**
 * Pure filtering for the M-PESA inflow table.
 *
 * Extracted from MPESAAnalyzer so the behaviour is verifiable without
 * rendering, and so the memoised render path has exactly one implementation.
 * The analyzer previously rebuilt this closure on EVERY render — each
 * keystroke, panel toggle and realtime push re-scanned the whole record set
 * synchronously, which is what made the tab lag once a statement had been
 * imported.
 */

export interface InflowFilterable {
  details: string;
  receipt: string;
  date: string;
  time: string;
  paidIn: number;
  balance: number;
}

/**
 * Match a row against the search box across every column the user can see.
 *
 * Returns the SAME array reference when there is no query, so a caller's
 * memo stays stable and an empty search box never invalidates downstream
 * work or collapses an expanded view.
 */
export function filterInflows<T extends InflowFilterable>(
  rows: readonly T[],
  searchTerm: string,
): readonly T[] {
  // A whitespace-only query is treated as "no query" — searching for " "
  // would otherwise match every row containing a space.
  const q = (searchTerm || "").trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      (r.details || "").toLowerCase().includes(q) ||
      (r.receipt || "").toLowerCase().includes(q) ||
      (r.date || "").toLowerCase().includes(q) ||
      (r.time || "").toLowerCase().includes(q) ||
      String(r.paidIn).includes(q) ||
      String(r.balance).includes(q),
  );
}

/**
 * Signature of the inputs that define the current view.
 *
 * Used as the reset key for the windowed list: a change here means a NEW list
 * and the window must start small again, whereas the underlying data merely
 * growing must not collapse a view the user has already expanded.
 */
export function inflowViewKey(
  searchTerm: string,
  rangeFiltered: readonly unknown[] | null,
): string {
  return `${(searchTerm || "").trim().toLowerCase()}|${rangeFiltered ? rangeFiltered.length : -1}`;
}
