/**
 * Operational fuel-price verification.
 *
 * Price changes no longer require Supabase AAL2/2FA. Instead, the user must
 * explicitly confirm the high-impact action immediately before it is saved.
 * Server-side RBAC/RLS and the immutable price audit trail remain in place.
 */
export async function ensurePriceChangeAAL2(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  return window.confirm(
    "ARE YOU SURE?\n\nYou are about to change an operational fuel price.\n\nThis change will be recorded in the price audit history.",
  );
}

/** Alias with the clearer name used by new code. */
export const confirmFuelPriceChange = ensurePriceChangeAAL2;

export async function getPriceMfaStatus(): Promise<{ enabled: boolean; aal2: boolean }> {
  // Kept for backward compatibility with existing settings/status consumers.
  // AAL2 is no longer required for fuel-price mutations.
  return { enabled: false, aal2: true };
}
