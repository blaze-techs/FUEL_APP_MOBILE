/**
 * Numeric input helpers that allow users to CLEAR a field (leave it empty)
 * instead of forcing "0" on every empty value.
 *
 * The problem: `parseFloat(e.target.value) || 0` turns an empty string into
 * `NaN || 0 = 0`, which React then renders as "0" in the input — the user can
 * never clear the field. These helpers let the state hold an empty string
 * while editing, and only coerce to a number when a calculation or save needs
 * a real numeric value.
 */

/**
 * Parse a string from an input event into a number, returning `null` for an
 * empty/whitespace-only string (so the caller can store `""` or `null` and
 * keep the field visually empty). Returns 0 only for genuinely-zero input.
 *
 * Use in onChange: `setPrice(parseInputNumber(e.target.value) ?? "")`
 */
export function parseInputNumber(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const num = parseFloat(trimmed);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse an integer from an input string, returning `null` for empty input.
 */
export function parseInputInt(raw: string): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const num = parseInt(trimmed, 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Convert a stored value (number | string | null | undefined) into the string
 * to display in an `<input value={...} />`. Returns "" for null/undefined/NaN
 * so the input shows empty (not "0" or "NaN") when the user clears it.
 *
 * Use: `value={inputValueToString(price)}`
 */
export function inputValueToString(
  val: number | string | null | undefined,
): string {
  if (val == null || val === "") return "";
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return "";
    return String(val);
  }
  return String(val);
}

/**
 * Safely get a number from a value that may be a string, number, null, or
 * undefined. Returns the fallback (default 0) for null/undefined/empty/NaN.
 *
 * Use when you need a real number for calculations:
 * `const total = toNumber(price) * toNumber(qty)`
 */
export function toNumber(
  val: number | string | null | undefined,
  fallback: number = 0,
): number {
  if (val == null || val === "") return fallback;
  if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
  const num = parseFloat(String(val).replace(/,/g, ""));
  return Number.isFinite(num) ? num : fallback;
}
