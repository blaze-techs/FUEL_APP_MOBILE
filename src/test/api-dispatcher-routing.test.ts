import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guard for the nested-route 404 outage.
 *
 * The whole /api surface is served by one Vercel catch-all function,
 * api/[[...path]].ts. Vercel's generated matcher for that file only covers a
 * SINGLE path segment, so /api/system/health, /api/operations/sale,
 * /api/cron/monthly-fuel-sync, /api/mpesa/stkpush and the rest never reached
 * the dispatcher — the platform answered its own 404 first. Verified live on
 * both hosts before the fix (every nested route 404, every one-segment route
 * fine) and re-verified after.
 *
 * The fix is split across two files that must stay in sync, so both halves
 * are asserted here:
 *   1. vercel.json funnels nested /api paths to the dispatcher, capturing the
 *      tail in a `[...path]` query param.
 *   2. the dispatcher stitches that param back onto the pathname before
 *      matching its route table.
 *
 * src/test cannot import the bracket-named function (Vite cannot resolve it),
 * so the runtime behaviour is asserted by scripts/probe-api-dispatcher.mts
 * instead; these checks guard the wiring that probe depends on.
 */

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("api dispatcher nested routing", () => {
  it("funnels nested /api paths to the dispatcher in vercel.json", () => {
    const config = JSON.parse(read("vercel.json")) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };
    const rewrites = config.rewrites || [];

    const funnel = rewrites.find((r) => r.destination.includes("[[...path]]"));
    expect(
      funnel,
      "no rewrite sends nested /api paths to the dispatcher",
    ).toBeDefined();
    expect(funnel!.source).toMatch(/^\/api\//);
    expect(funnel!.source).toMatch(/\*/);
    // The tail must be captured, otherwise the dispatcher cannot rebuild the
    // path it is supposed to match.
    expect(funnel!.destination).toContain("[...path]=$1");
    // And the funnel must not swallow the function's own path — the
    // lookahead excludes it (regex-escaped as \[\[\.\.\.path\]\]).
    expect(funnel!.source).toContain("\\[\\[\\.\\.\\.path\\]\\]");
  });

  it("rebuilds the pathname from the forwarded tail before matching", () => {
    const source = read("api/[[...path]].ts");

    expect(source).toContain('url.searchParams.get("[...path]")');
    expect(source).toContain("url.pathname = `/api/");
    // Query-param recovery must happen before the route table is consulted.
    const recoverAt = source.indexOf('url.searchParams.get("[...path]")');
    const matchAt = source.indexOf("routes.find((r) => r.pattern.test");
    expect(recoverAt).toBeGreaterThan(-1);
    expect(matchAt).toBeGreaterThan(recoverAt);
  });

  it("keeps the nested route table intact", () => {
    const source = read("api/[[...path]].ts");
    for (const route of [
      "/api/system/health",
      "/api/operations/sale",
      "/api/cron/monthly-fuel-sync",
      "/api/mpesa/stkpush",
      "/api/sync/apply",
    ]) {
      expect(source, `${route} missing from the route table`).toContain(route);
    }
  });

  it("still answers unknown routes with the dispatcher's not-found marker", () => {
    const source = read("api/[[...path]].ts");
    expect(source).toContain("API route not found");
  });
});
