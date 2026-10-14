/**
 * Google sign-in contracts.
 *
 * Two failure modes are pinned here because both were live regressions:
 *
 *  1. Nonce pairing. GIS embeds a `nonce` claim in the ID token, so Supabase
 *     requires the matching value at signInWithIdToken ("Passed nonce and nonce
 *     in id_token should either both exist or not."). Google must receive the
 *     SHA-256 HEX and Supabase the RAW value.
 *
 *  2. Redirect origin. Signing in from a deployment/preview alias (e.g.
 *     fuel-app-mobile-leons-projects-78a92c96.vercel.app) must return to the
 *     canonical site, not strand the user on the throwaway origin.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../react-app/context/AuthContext.tsx"),
  "utf8",
);

describe("Google sign-in — nonce pairing", () => {
  it("generates a nonce pair with a SHA-256 hex hash", () => {
    expect(SRC).toMatch(/generateGoogleNonce/);
    expect(SRC).toMatch(/crypto\.subtle\.digest\(\s*"SHA-256"/);
    // hex encoding of the digest bytes
    expect(SRC).toMatch(/toString\(16\)\.padStart\(2,\s*"0"\)/);
  });

  it("passes the HASHED nonce to Google and the RAW nonce to Supabase", () => {
    // Google receives the hash …
    expect(SRC).toMatch(/nonce:\s*noncePair\.hashedNonce/);
    // … Supabase receives the raw value (never the hash).
    expect(SRC).toMatch(/signInWithIdToken/);
    expect(SRC).toMatch(/nonce:\s*noncePair\.nonce\b/);
    expect(SRC).not.toMatch(
      /nonce:\s*noncePair\.hashedNonce\s*\}\s*\)\s*;?\s*$/m,
    );
  });

  it("tolerates Web Crypto being unavailable without sending a bad nonce", () => {
    // On failure it returns null, and the callers spread conditionally, so a
    // non-hashed nonce is never sent (which would always mismatch).
    expect(SRC).toMatch(/return null;/);
    expect(SRC).toMatch(
      /\.\.\.\(noncePair \? \{ nonce: noncePair\.hashedNonce \}/,
    );
    expect(SRC).toMatch(/\.\.\.\(noncePair \? \{ nonce: noncePair\.nonce \}/);
  });
});

describe("Google sign-in — canonical redirect origin", () => {
  it("routes OAuth and password-reset returns through the resolver", () => {
    expect(SRC).toMatch(/resolveAuthRedirectOrigin\(\)/);
    // The raw origin must not be used for the OAuth return.
    expect(SRC).not.toMatch(/redirectTo:\s*window\.location\.origin \+ "\/"/);
  });

  it("maps preview/deployment aliases back to the canonical hosts", () => {
    expect(SRC).toMatch(/fuel-app-mobile\.pages\.dev/);
    expect(SRC).toMatch(/fuel-app-mobile\.vercel\.app/);
    expect(SRC).toMatch(/hostname\.endsWith\("\.vercel\.app"\)/);
    expect(SRC).toMatch(/hostname\.endsWith\("\.pages\.dev"\)/);
    // Local dev keeps its own origin.
    expect(SRC).toMatch(/hostname === "localhost"/);
  });
});
