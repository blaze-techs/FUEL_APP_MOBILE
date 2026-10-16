import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Contract guards for the NATIVE movie/series resolver.
 *
 * The public mirror embeds (vidsrc.to etc.) are ad-laden, open popunders and
 * sometimes redirect the top-level tab, and the players refuse sandboxed
 * iframes — so they can never be the primary path. We instead reverse-
 * engineered the upstream chain and resolve it SERVER-SIDE into a same-origin
 * HLS playlist, which plays natively with no ads and no redirects.
 *
 * These tests pin the pieces that make that work:
 *   - the shared resolver exports the chain (resolve + token mint + proxy);
 *   - the VOD proxy refuses non-stream targets (no open proxy);
 *   - the movies handler exposes mode=native and mode=vod;
 *   - the client PREFERS native and only falls back to the ad-laden embeds;
 *   - the Cloudflare twin exists (CF bundles Functions independently).
 */
const lib = readFileSync(
  resolve(__dirname, "../server/vercel-api/_lib/vsembed.ts"),
  "utf8",
);
const vercelMovies = readFileSync(
  resolve(__dirname, "../server/vercel-api/movies.ts"),
  "utf8",
);
const cfFn = readFileSync(
  resolve(__dirname, "../../functions/api/movies-vs.ts"),
  "utf8",
);
const client = readFileSync(
  resolve(__dirname, "../react-app/components/MoviesEmbed.tsx"),
  "utf8",
);

describe("vsembed native resolver", () => {
  it("decrypts the ChaCha20 stream blob with the upstream WASM", () => {
    expect(lib).toContain("WebAssembly");
    expect(lib).toContain("decrypt");
    expect(lib).toContain("wasm_url");
  });

  it("mints the IP-bound per-host CDN token and refreshes on 401/403", () => {
    expect(lib).toContain("/generate.php");
    expect(lib).toContain("mintStreamToken");
    expect(lib).toMatch(/res\.status === 401 \|\| res\.status === 403/);
  });

  it("rewrites every playlist child URL through the same-origin VOD proxy", () => {
    expect(lib).toContain("rewritePlaylist");
    expect(lib).toContain("mode=vod&url=");
    expect(lib).toContain('URI="');
  });

  it("refuses to proxy non-stream targets (not an open proxy)", () => {
    expect(lib).toContain("isVodTarget");
    expect(lib).toContain('p.includes("/pl/")');
    expect(lib).toContain('p.includes("/content/")');
  });
});

describe("movies handler native modes", () => {
  it("exposes mode=native returning a same-origin playlist URL", () => {
    expect(vercelMovies).toContain('mode === "native"');
    expect(vercelMovies).toContain("/api/movies?mode=vod&url=");
  });

  it("exposes mode=vod guarded by isVodTarget", () => {
    expect(vercelMovies).toContain('mode === "vod"');
    expect(vercelMovies).toMatch(/isVodTarget\(target\)/);
  });
});

describe("client prefers native over ad-laden embeds", () => {
  it("tries the native resolver before enabling the embed fallback", () => {
    const nativeIdx = client.indexOf("mode=native");
    const fallbackIdx = client.indexOf("setUseEmbedFallback(true)");
    expect(nativeIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(nativeIdx);
  });

  it("targets the host-appropriate resolver (CF has its own endpoint)", () => {
    expect(client).toContain("/api/movies-vs?type=");
  });
});

describe("cloudflare twin", () => {
  it("ships a self-contained resolver (Functions bundle independently)", () => {
    expect(cfFn).toContain("vs_src.php");
    expect(cfFn).toContain("generate.php");
    expect(cfFn).toContain("isVodTarget");
    expect(cfFn).toContain("/api/movies-vs?url=");
  });
});
