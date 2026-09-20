import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guards for the Movies ad-free proxy chain.
 *
 * The player resolves its stream by fetching a metadata API and then injecting
 * a sealed source-resolver script with document.write. Three defects previously
 * broke playback end-to-end ("this media is unavailable"):
 *
 *  1. The metadata host rotated from data.vidsrcme.ru to data.vidsrc.sh, which
 *     the proxy allowlist did not recognize, so every metadata request 403'd.
 *  2. Root-relative proxy targets were encoded WITHOUT the player host, so the
 *     handler parsed them as host=<first-segment> and rejected them.
 *  3. The static rewriter only matched double-quoted src/href attributes, so
 *     the player's single-quoted injected script was fetched from our own
 *     origin (404) and no source could ever resolve.
 */
const VERCEL = resolve(__dirname, "../server/vercel-api/movie-embed.ts");
const CF = resolve(__dirname, "../../functions/api/movie-embed.ts");

const vercelSrc = readFileSync(VERCEL, "utf8");
const cfSrc = readFileSync(CF, "utf8");

describe("movie-embed proxy: metadata host allowlist", () => {
  it.each([
    ["vercel", vercelSrc],
    ["cloudflare", cfSrc],
  ])("%s passes the live metadata host through to the browser", (_n, src) => {
    // The metadata API sends ACAO:* so the browser can fetch it directly;
    // proxying it server-side is what produced the 403. Backslashes are
    // doubled here because the hook lives inside a TS template literal.
    expect(src).toContain(String.raw`data\\.vidsrc\\.sh`);
  });

  it("retains the legacy metadata host for backward compatibility", () => {
    expect(vercelSrc).toContain(String.raw`data\\.vidsrcme\\.ru`);
  });
});

describe("movie-embed proxy: root-relative target handling", () => {
  it.each([
    ["vercel", vercelSrc],
    ["cloudflare", cfSrc],
  ])("%s encodes root-relative targets without a host prefix", (_n, src) => {
    // Handler pins bare paths to PLAYER_HOST; encoding a host into the target
    // made the handler parse host=<first-segment> and answer 400.
    expect(src).not.toContain(
      'encodeURIComponent("cloudorchestranova.com" + path)',
    );
    expect(src).toContain("encodeURIComponent(path)");
  });

  it.each([
    ["vercel", vercelSrc],
    ["cloudflare", cfSrc],
  ])("%s normalizes legacy host-qualified targets", (_n, src) => {
    // Old-style links (still in caches) arrive as "embed/player/..." which
    // URL() parses as host="embed"; normalize before validation.
    expect(src).toContain("normP");
  });
});

describe("movie-embed proxy: markup rewriting", () => {
  it.each([
    ["vercel", vercelSrc],
    ["cloudflare", cfSrc],
  ])("%s rewrites single- and double-quoted src/href", (_n, src) => {
    // Matcher is /(src|href)=(['"])(\/[^'"]*)\2/ — the player injects its
    // sealed resolver script with SINGLE quotes inside a double-quoted JS
    // string, which a double-quote-only matcher missed.
    expect(src).toContain(`(src|href)=`);
    expect(src).toContain(`(['"])`);
  });
});

describe("movie-embed proxy: player hooks", () => {
  it.each([
    ["vercel", vercelSrc],
    ["cloudflare", cfSrc],
  ])("%s hooks document.write for late-injected scripts", (_n, src) => {
    expect(src).toContain("document.write");
  });
});

describe("movie-embed proxy: Cloudflare delegates the blocked gate", () => {
  it("routes through the Vercel function whose egress passes the gate", () => {
    // vsembed.ru answers 403 to Cloudflare's egress (bot challenge). The
    // Cloudflare endpoint must delegate rather than always answering 502.
    expect(cfSrc).toContain("MOVIE_EMBED_VERCEL_ORIGIN");
    expect(cfSrc).toContain('url.searchParams.get("via") !== "vercel"');
  });
});
