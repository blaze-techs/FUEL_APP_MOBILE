import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..");

/**
 * Authenticated server routes (/api/gemini-ocr, /api/claude) reject a missing
 * token with 401. MPESAAnalyzer sent no Authorization header at all, so every
 * AI chunk failed. These tests pin the single resolver AND the call sites that
 * must use it.
 */
describe("access token resolution", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("prefers the AuthContext token", async () => {
    localStorage.setItem("fuelpro_token", "direct-token");
    const { getAccessToken, authHeaders } =
      await import("../react-app/lib/auth-token");
    expect(getAccessToken()).toBe("direct-token");
    expect(authHeaders()).toEqual({ Authorization: "Bearer direct-token" });
  });

  it("falls back to the persisted Supabase session token", async () => {
    localStorage.setItem(
      "sb-ojjscjwatikixlpshmub-auth-token",
      JSON.stringify({ access_token: "supabase-session-token" }),
    );
    const { getAccessToken } = await import("../react-app/lib/auth-token");
    expect(getAccessToken()).toBe("supabase-session-token");
  });

  it("returns null / no header when signed out", async () => {
    const { getAccessToken, authHeaders } =
      await import("../react-app/lib/auth-token");
    expect(getAccessToken()).toBeNull();
    expect(authHeaders()).toEqual({});
  });

  it("ignores unrelated and malformed storage entries", async () => {
    localStorage.setItem("sb-other-key", "not-a-session");
    localStorage.setItem("sb-broken-auth-token", "{not json");
    localStorage.setItem("unrelated", "value");
    const { getAccessToken } = await import("../react-app/lib/auth-token");
    expect(getAccessToken()).toBeNull();
  });

  it("ignores a blank token rather than sending a malformed header", async () => {
    localStorage.setItem("fuelpro_token", "   ");
    const { getAccessToken } = await import("../react-app/lib/auth-token");
    expect(getAccessToken()).toBeNull();
  });

  it("MPESAAnalyzer sends the Authorization header to the Gemini proxy", () => {
    const source = readFileSync(
      resolve(root, "src/react-app/components/MPESAAnalyzer.tsx"),
      "utf8",
    );
    // The AI chunk fetch must spread authHeaders() — without it every chunk
    // is rejected 401 and the whole extraction silently fails.
    expect(source).toMatch(/authHeaders\(\)/);
    expect(source).toMatch(/\/api\/gemini-ocr|getGeminiUrl/);
  });

  it("no module re-implements token lookup inline", () => {
    // One resolver only. A second copy is how MPESAAnalyzer drifted and lost
    // its header in the first place.
    const callSites = [
      "src/react-app/lib/gemini-vision-ocr.ts",
      "src/react-app/lib/ocr-service.ts",
    ];
    for (const rel of callSites) {
      const source = readFileSync(resolve(root, rel), "utf8");
      expect(
        source.includes('localStorage.getItem("fuelpro_token")'),
        `${rel} must use getAccessToken(), not an inline lookup`,
      ).toBe(false);
    }
  });
});
