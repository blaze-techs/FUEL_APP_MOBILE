/**
 * Number-input helpers that let a user CLEAR a field (show nothing) instead
 * of forcing a "0" into an empty input.
 *
 * Problem being fixed: number inputs commonly used
 *   onChange={e => setX(parseFloat(e.target.value) || 0)}
 * `parseFloat("")` is `NaN`, `NaN || 0` is `0` → the field immediately
 * re-renders "0" and the user can never clear it. These helpers keep the
 * field empty while the user is editing and only coerce to a number on
 * submit/blur.
 */

/**
 * Parse a number-input string into a number, returning 0 ONLY for genuinely
 * empty/whitespace input on a "required" read. Use this when you need a
 * number for a calculation but the field itself is bound to a string state.
 */
export function parseNumberInput(raw: string): number {
  if (raw == null) return 0;
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format a number for display in a controlled number input. Returns "" for
 * 0/undefined/null so an empty field stays empty (the user can clear it),
 * unless `showZero` is true (e.g. a tax rate that genuinely means 0%).
 */
export function formatNumberInput(
  value: number | undefined | null,
  showZero = false,
): string {
  if (value == null) return "";
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  if (value === 0) return showZero ? "0" : "";
  // Drop trailing ".0" so "5" not "5.0"; keep meaningful decimals.
  return String(value);
}

/**
 * Coerce a possibly-string value to a number for storage, treating "" as 0.
 * Safe to use directly in setState when the field state is a string you want
 * to keep as a string for editing, but you also need the numeric value.
 */
export function toNumberOrZero(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return parseNumberInput(value);
  return 0;
}
