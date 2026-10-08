import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GAME_MIRROR,
  isKnownMirrorKey,
  mirrorUpstream,
} from "@/react-app/lib/game-mirror-config";

const root = resolve(__dirname, "../..");

// Guards the generic same-origin game mirror that keeps frame-blocking game
// providers INSIDE the Video Games tab (no new tab). If the registry, the
// upstream mapping, or the route wiring drifts, games silently fall back to a
// redirect — so pin the contract here.
describe("game mirror registry", () => {
  it("registers the frame-blocking providers", () => {
    for (const key of [
      "parkbaron",
      "nacht",
      "quenq-static",
      "quenq",
      "iii",
      "vc",
      "xp",
    ]) {
      expect(isKnownMirrorKey(key)).toBe(true);
      expect(GAME_MIRROR[key].origin.startsWith("https://")).toBe(true);
    }
  });

  it("rejects unknown or malformed keys", () => {
    expect(isKnownMirrorKey("evil")).toBe(false);
    expect(isKnownMirrorKey("API")).toBe(false);
    expect(isKnownMirrorKey("a/b")).toBe(false);
    expect(isKnownMirrorKey("")).toBe(false);
  });

  it("maps a bare key to the app entry page", () => {
    expect(mirrorUpstream("parkbaron", "", "")!.toString()).toBe(
      "https://parkbaron.com/play",
    );
    expect(mirrorUpstream("nacht", "", "")!.toString()).toBe(
      "https://zombies.bitcoinsapi.com/",
    );
  });

  it("resolves assets at the ORIGIN root for Vite SPAs", () => {
    // parkbaron serves the entry at /play but assets root-relative (/assets/…)
    expect(
      mirrorUpstream("parkbaron", "assets/city.json", "")!.toString(),
    ).toBe("https://parkbaron.com/assets/city.json");
    // preservePath style (static.quenq.com): assets are absolute from root
    expect(
      mirrorUpstream(
        "quenq-static",
        "apps/3d-pinball-space-cadet/app",
        "",
      )!.toString(),
    ).toBe("https://static.quenq.com/apps/3d-pinball-space-cadet/app");
    // host root with trailing slash
    expect(mirrorUpstream("iii", "", "")!.toString()).toBe(
      "https://iii.quenq.com/",
    );
    // unknown key → null
    expect(mirrorUpstream("nope", "x", "")).toBeNull();
  });

  it("forwards the game query but strips our cache-buster", () => {
    expect(mirrorUpstream("parkbaron", "", "cb=123")!.toString()).toBe(
      "https://parkbaron.com/play",
    );
    expect(mirrorUpstream("xp", "", "part=3")!.toString()).toBe(
      "https://xp.quenq.com/?part=3",
    );
  });
});

describe("game mirror wiring", () => {
  it("the Vercel catch-all excludes the mirror route (so SAMEORIGIN wins)", () => {
    const cfg = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
    const catchAll = cfg.headers.find((h: { source: string }) =>
      h.source.startsWith("/:path("),
    );
    expect(catchAll.source).toContain("api/game-mirror");
    const gm = cfg.headers.find(
      (h: { source: string }) => h.source === "/api/game-mirror/:path*",
    );
    expect(gm).toBeTruthy();
    const xfo = gm.headers.find(
      (h: { key: string }) => h.key === "X-Frame-Options",
    );
    expect(xfo.value).toBe("SAMEORIGIN");
  });

  it("the handler is registered in the API dispatcher", () => {
    const dispatcher = readFileSync(
      resolve(root, "api/[[...path]].ts"),
      "utf8",
    );
    expect(dispatcher).toContain("game-mirror.js");
    expect(dispatcher).toContain("^/api/game-mirror");
  });

  it("ships a Cloudflare Pages Function for the same route", () => {
    const fn = readFileSync(
      resolve(root, "functions/api/game-mirror/[[path]].ts"),
      "utf8",
    );
    expect(fn).toContain("onRequestGet");
    expect(fn).toContain("/api/game-mirror/");
    expect(fn).toContain("SAMEORIGIN");
  });

  // Two rewrite regressions that silently broke every non-quenq game:
  //  (1) dropping the captured asset segment -> /api/game-mirror/assets/x.js
  //  (2) no <base> -> relative refs resolved off the key root. Both are easy
  //      to re-introduce, so pin them in BOTH handler copies.
  it("rewrites root-absolute assets WITH their segment, in both copies", () => {
    for (const rel of [
      "src/server/vercel-api/_lib/game-mirror.ts",
      "functions/api/game-mirror/[[path]].ts",
    ]) {
      const src = readFileSync(resolve(root, rel), "utf8");
      // capture group ($2) re-emitted right after the prefix
      expect(src).toMatch(/\(\$\{ASSET_SEGMENTS\}\)[\s\S]{0,40}\$2/);
    }
  });

  it("injects a directory-aware <base> for HTML documents, in both copies", () => {
    for (const rel of [
      "src/server/vercel-api/_lib/game-mirror.ts",
      "functions/api/game-mirror/[[path]].ts",
    ]) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src).toContain("<base href=");
      expect(src).toContain("upstream");
    }
  });

  // The app shell is COEP:credentialless and frames the mirror cross-origin.
  // Every mirrored response (HTML AND sub-assets) needs CORP, or the browser
  // rejects the frame with net::ERR_BLOCKED_BY_RESPONSE. Cloudflare Pages does
  // NOT apply public/_headers to Function routes, so the handler itself must
  // set it — assert that here so a refactor cannot silently drop it again.
  it("sets Cross-Origin-Resource-Policy in BOTH handler copies", () => {
    for (const rel of [
      "src/server/vercel-api/game-mirror.ts",
      "functions/api/game-mirror/[[path]].ts",
    ]) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src).toMatch(
        /Cross-Origin-Resource-Policy["']?\s*[:,]\s*["']cross-origin/,
      );
    }
  });
});
