import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FUEL_PRICE_CONFIRM_MESSAGE,
  confirmFuelPriceChange,
  ensurePriceChangeAAL2,
} from "@/react-app/lib/price-security";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Changing an operational fuel price must pass an explicit human check — a
 * plain ARE YOU SURE? decision, NOT a credential prompt. If this ever drifts
 * back to a TOTP/AAL2 flow, the app would demand an authenticator code the
 * station owner may never have enrolled, locking them out of their own prices.
 */
describe("fuel-price change confirmation", () => {
  it("asks a plain ARE YOU SURE? question", () => {
    expect(FUEL_PRICE_CONFIRM_MESSAGE).toMatch(/^ARE YOU SURE\?/);
    expect(FUEL_PRICE_CONFIRM_MESSAGE).toContain(
      "change an operational fuel price",
    );
  });

  it("returns true only when the user confirms", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await expect(confirmFuelPriceChange()).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(FUEL_PRICE_CONFIRM_MESSAGE);

    confirm.mockReturnValue(false);
    await expect(confirmFuelPriceChange()).resolves.toBe(false);
  });

  it("keeps the legacy export name working (delegates, no 2FA)", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await expect(ensurePriceChangeAAL2()).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  // Regression guard: the module must not import Supabase or touch MFA. The
  // previous AAL2 implementation called auth.mfa.*, which threw for any user
  // without an enrolled authenticator app.
  it("does NOT depend on Supabase or the MFA API", () => {
    const src = readFileSync(
      join(__dirname, "..", "react-app", "lib", "price-security.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/mfa\./);
    expect(src).not.toContain("getSupabaseClient");
    expect(src).not.toContain("challengeAndVerify");
    expect(src).not.toContain("thenticatorAssuranceLevel");
  });
});
