import { getSupabaseClient } from "@/supabase/client";

export async function ensurePriceChangeAAL2(): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error(error.message);
  if (data.currentLevel === "aal2") return true;
  if (data.nextLevel !== "aal2") throw new Error("Fuel price changes are locked until 2FA is enrolled. Open Settings → Security and enable an authenticator app first.");
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw new Error(factors.error.message);
  const factor = factors.data.totp.find((f) => f.status === "verified") ?? factors.data.phone.find((f) => f.status === "verified");
  if (!factor) throw new Error("Fuel price changes are locked until a verified 2FA factor is enrolled.");
  const code = window.prompt("2FA verification required. Enter the 6-digit code from your authenticator app.");
  if (!code || !/^\d{6}$/.test(code.trim())) return false;
  const result = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
  if (result.error) throw new Error("2FA verification failed: " + result.error.message);
  return true;
}

export async function getPriceMfaStatus(): Promise<{ enabled: boolean; aal2: boolean }> {
  const supabase = getSupabaseClient();
  const [{ data: aal }, { data: factors }] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
  return {
    enabled: Boolean(factors?.totp.some((f) => f.status === "verified") || factors?.phone.some((f) => f.status === "verified")),
    aal2: aal?.currentLevel === "aal2",
  };
}
