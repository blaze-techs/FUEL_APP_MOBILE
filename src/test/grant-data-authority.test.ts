import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCountryPrice, normalizeFuelType } from "@/react-app/config/pricing";

/**
 * Regression guard for the Company QR / station-access contradiction.
 *
 * A member opening a grant link saw a DIFFERENT fuel price from the owner's
 * app (published 214.03/217.86 vs live 220.08/224.95). Two defects combined:
 *
 *   1. The Vercel dispatcher collapsed EVERY failure to HTTP 502, so a
 *      definitive denial (invalid / revoked / expired / used-up grant) looked
 *      like an outage and the member page silently rendered the stale
 *      published copy.
 *   2. The published copy itself was built in the BROWSER with
 *      `state.pmsPrice`/`agoPrice` as its fallback, so it could hold a price
 *      the station no longer had.
 *
 * These are wiring checks: the runtime behaviour is covered by
 * company-grant.test.ts (outcome semantics) and
 * station-snapshot-for-grant.test.ts (live config wins over a stale scalar).
 */

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("integrations dispatcher status propagation", () => {
  const source = read("src/server/vercel-api/integrations.ts");

  it("propagates the handler's declared status instead of always 502", () => {
    expect(source).toContain("const declared = Number(");
    expect(source).toContain("declared >= 400 && declared <= 599");
    // The old unconditional collapse must be gone.
    expect(source).not.toContain("result.success ? 200 : 502");
  });

  it("still treats an undeclared failure as 502", () => {
    expect(source).toContain(": 502;");
  });
});

describe("cloudflare integrations relay", () => {
  const source = read("functions/api/integrations.ts");

  it("reads the upstream body before inspecting it", () => {
    const readAt = source.indexOf("await upstream.text()");
    const useAt = source.indexOf("isJson");
    expect(readAt).toBeGreaterThan(-1);
    expect(useAt).toBeGreaterThan(readAt);
  });

  it("never relays a non-JSON failure as a bare unexplained error", () => {
    // An opaque relay failure must still be JSON so the member page can tell
    // "outage" from "denial" instead of parsing an HTML error page.
    expect(source).toContain("Integration relay failed");
    expect(source).toContain("relayStatus");
    expect(source).toContain('"Content-Type": "application/json"');
  });

  it("preserves the upstream status for a JSON error body", () => {
    expect(source).toContain("status: upstream.status");
  });
});

describe("owner-side snapshot publication action", () => {
  const source = read("src/server/vercel-api/_lib/integrations-core.ts");

  it("is registered in the dispatcher", () => {
    expect(source).toContain('case "station-snapshot-build":');
  });

  it("is NOT a public action (it returns full station data)", () => {
    const handler = read("src/server/vercel-api/integrations.ts");
    const publicBlock = handler.slice(
      handler.indexOf("PUBLIC_ACTIONS = new Set(["),
      handler.indexOf("]);", handler.indexOf("PUBLIC_ACTIONS = new Set([")),
    );
    expect(publicBlock).not.toContain("station-snapshot-build");
  });

  it("refuses a caller who is not the station owner", () => {
    expect(source).toContain("Only the station owner can publish");
    expect(source).toContain("caller !== ownerId");
  });

  it("builds the snapshot from the authoritative rows with a full tab set", () => {
    expect(source).toContain("buildStationSnapshotForGrant(");
    expect(source).toContain("allowedTabs: []");
  });
});

describe("member portal never shows a stale copy for a denied grant", () => {
  const source = read("src/react-app/pages/StationAccess.tsx");

  it("checks the outcome state rather than truthiness", () => {
    expect(source).toContain('outcome.state === "ok"');
    expect(source).toContain('outcome.state === "denied"');
  });

  it("returns early on a denial instead of falling back to the snapshot", () => {
    const deniedAt = source.indexOf('outcome.state === "denied"');
    const fallbackAt = source.indexOf("await getStationSnapshot(sid)");
    expect(deniedAt).toBeGreaterThan(-1);
    expect(fallbackAt).toBeGreaterThan(deniedAt);
    // The denial branch must clear the snapshot and stop.
    const branch = source.slice(deniedAt, fallbackAt);
    expect(branch).toContain("setSnapshot(null)");
    expect(branch).toContain("return;");
  });
});

describe("member payload applies the owner's market plausibility guard", () => {
  const builder = read(
    "src/server/vercel-api/_lib/station-snapshot-for-grant.ts",
  );

  it("resolves the market from the station record, never the reader locale", () => {
    expect(builder).toContain("resolveStationMarketCountry(");
    expect(builder).toContain("company.companyCurrency");
    // The reader's locale/detected country must never enter this decision.
    expect(builder).not.toContain("getDetectedCountryCode");
  });

  it("uses the shared country reference band, not a local constant", () => {
    expect(builder).toContain("getCountryPrice(");
    expect(builder).toContain("normalizeFuelType(fuelType)");
    expect(builder).toContain("reference.price * 0.25");
    expect(builder).toContain("reference.price * 4");
  });

  it("marks an implausible price unknown instead of substituting one", () => {
    // Same contract as useStationFuelTypes: implausible => 0 ("not configured"),
    // never a replacement figure the owner is not shown.
    expect(builder).toContain(
      "isPlausibleForMarket(raw, stationCountry, label) ? raw : 0",
    );
  });

  // Non-vacuous: the band must actually reject a Kenya figure on a US station
  // and accept the same figure on a Kenya station.
  it("rejects a Kenya KSh price on a US station and keeps a US price", () => {
    const guard = (price: number, cc: string, fuel: string) => {
      const ref = getCountryPrice(cc, normalizeFuelType(fuel) || fuel);
      if (!ref || !Number.isFinite(ref.price) || ref.price <= 0) return true;
      return price >= ref.price * 0.25 && price <= ref.price * 4;
    };
    expect(guard(220.08, "US", "Super Petrol")).toBe(false);
    expect(guard(1.42, "US", "Super Petrol")).toBe(true);
    expect(guard(220.08, "KE", "Super Petrol")).toBe(true);
  });
});
