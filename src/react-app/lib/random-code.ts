/**
 * Bias-free random codes for shareable capability links.
 *
 * A capability link is a URL that IS the credential: whoever holds it gets the
 * content, with no login. Two things follow, and both are why this lives in one
 * place instead of being re-implemented per feature:
 *
 *  1. The code must be UNGUESSABLE. `Math.random()` is not suitable — it is not
 *     cryptographically strong, and its output can be predicted from a few
 *     observed values.
 *  2. The characters must be UNIFORMLY distributed. Taking `byte % 62` directly
 *     skews the alphabet: 256 = 4×62 + 8, so the first 8 characters would be
 *     ~33% more likely than the rest. Rejection sampling (discard bytes >= 248)
 *     removes that bias.
 *
 * Used by the payslip short link and the customer account link.
 */

const BASE62_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Largest multiple of 62 that fits in a byte; bytes at or above it are rejected. */
const REJECT_FROM = 248; // 248 = 4 * 62

/**
 * A crypto-random base62 string.
 *
 * 12 chars ≈ 71.6 bits — brute-forcing a live link is infeasible, which is what
 * makes a capability URL safe to hand to someone with no login.
 */
export function randomBase62(length = 12): string {
  const target = Math.max(1, Math.trunc(length) || 12);
  const out: string[] = [];
  // Bounded so a broken/absent RNG can never spin forever.
  for (let attempt = 0; attempt < 64 && out.length < target; attempt++) {
    const buf = crypto.getRandomValues(new Uint8Array(target * 2));
    for (const b of buf) {
      if (b < REJECT_FROM) {
        out.push(BASE62_CHARS[b % 62]);
        if (out.length === target) break;
      }
    }
  }
  return out.join("");
}

/** Whether a string is a well-formed capability code (shape only, not validity). */
export function isCapabilityCode(value: unknown, min = 10, max = 16): boolean {
  return (
    typeof value === "string" &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9]+$/.test(value)
  );
}

export { BASE62_CHARS };
