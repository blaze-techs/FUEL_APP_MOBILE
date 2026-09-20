/**
 * Operational fuel-price verification.
 *
 * Changing an operational fuel price is high-impact, so it requires an
 * explicit, in-context confirmation immediately before the write. This is a
 * deliberate HUMAN check — a decision, not a credential: no password, no TOTP,
 * no network round-trip. Server-side RBAC/RLS and the immutable price audit
 * trail remain the real controls on what may be written.
 */

/** Confirmation copy shown before any operational fuel-price change. */
export const FUEL_PRICE_CONFIRM_MESSAGE =
  "ARE YOU SURE?\n\nYou are about to change an operational fuel price.\n\nThis change will be recorded in the price audit history.";

/**
 * Ask the user to confirm a fuel-price change.
 * Returns `true` only when they explicitly choose yes.
 */
export async function confirmFuelPriceChange(
  message: string = FUEL_PRICE_CONFIRM_MESSAGE,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  return window.confirm(message);
}

/**
 * @deprecated Misleading name — this no longer performs AAL2/2FA verification.
 * Use {@link confirmFuelPriceChange}. Retained so existing call sites keep
 * working.
 */
export const ensurePriceChangeAAL2 = confirmFuelPriceChange;
