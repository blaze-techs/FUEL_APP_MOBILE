import { describe, it, expect } from "vitest";
import {
  VELGG_GAMES,
  velggEmbedUrl,
  velggCoverUrl,
  unifiedFromVelgg,
  buildUnifiedGames,
  countUnifiedBySource,
  filterUnifiedBySource,
  type UnifiedGame,
} from "@/react-app/services/GameCatalogService";
import {
  isAllowedVelggPath,
  isVelggHtmlPath,
  isVelggTelemetryModule,
  isVelggTelemetryEndpoint,
  VELGG_TELEMETRY_STUB,
  rewriteVelggBody,
} from "@/server/vercel-api/_lib/velgg-proxy";

/**
 * vel.gg (Black Ops Zombies WASM) integration contract.
 *
 * These pin the behaviour that makes the game actually boot in-app — every one
 * of them guards a bug that was fixed by hand against the live origin, so a
 * future edit that reintroduces it fails here instead of in the browser.
 */
describe("vel.gg catalog integration", () => {
  it("registers the two maps the task named (five + kino)", () => {
    const slugs = VELGG_GAMES.map((g) => g.slug);
    expect(slugs).toContain("five");
    expect(slugs).toContain("kino");
  });

  it("ships the full vel.gg Zombies lineup with unique slugs + zones", () => {
    const slugs = new Set(VELGG_GAMES.map((g) => g.slug));
    const zones = new Set(VELGG_GAMES.map((g) => g.zone));
    expect(slugs.size).toBe(VELGG_GAMES.length);
    expect(zones.size).toBe(VELGG_GAMES.length);
    // vel.gg serves exactly these 10 maps.
    expect(VELGG_GAMES.length).toBe(10);
  });

  it("embeds through the SAME-ORIGIN proxy (never vel.gg directly / a new tab)", () => {
    for (const g of VELGG_GAMES) {
      const url = velggEmbedUrl(g.slug);
      expect(url.startsWith("/api/velgg/bo1z/")).toBe(true);
      expect(url).not.toContain("vel.gg");
      expect(url).not.toContain("http");
    }
  });

  it("marks vel.gg cards as cross-origin-isolated iframe (SharedArrayBuffer)", () => {
    for (const g of VELGG_GAMES) {
      const u = unifiedFromVelgg(g);
      expect(u.kind).toBe("iframe");
      expect(u.frame).toBe("isolated");
      expect(u.source).toBe("velgg");
      expect(u.id.startsWith("velgg:")).toBe(true);
    }
  });

  it("maps each card to its real loadscreen art through the proxy", () => {
    expect(velggCoverUrl("zombie_pentagon")).toBe(
      "/api/velgg/bo1z/art/loadscreen_zombie_pentagon.webp",
    );
    for (const g of VELGG_GAMES) {
      expect(velggCoverUrl(g.zone)).toContain(g.zone);
    }
  });

  it("merges vel.gg into the unified collection + counts", () => {
    const games = buildUnifiedGames({ velgg: VELGG_GAMES } as never);
    const velgg = filterUnifiedBySource(games, "velgg");
    expect(velgg.length).toBe(VELGG_GAMES.length);
    const counts = countUnifiedBySource(games);
    expect(counts.velgg).toBe(VELGG_GAMES.length);
    expect(counts.all).toBe(games.length);
  });

  it("de-dupes vel.gg ids (a repeated build never doubles the cards)", () => {
    const games: UnifiedGame[] = buildUnifiedGames({
      velgg: [...VELGG_GAMES, ...VELGG_GAMES],
    } as never);
    expect(filterUnifiedBySource(games, "velgg").length).toBe(
      VELGG_GAMES.length,
    );
  });
});

describe("vel.gg proxy helpers", () => {
  it("allows only the /bo1z app subtree (no open proxy, no traversal)", () => {
    expect(isAllowedVelggPath("bo1z")).toBe(true);
    expect(isAllowedVelggPath("bo1z/five")).toBe(true);
    expect(isAllowedVelggPath("bo1z/kino/manifest.json")).toBe(true);
    expect(isAllowedVelggPath("")).toBe(false);
    expect(isAllowedVelggPath("other")).toBe(false);
    expect(isAllowedVelggPath("bo1z/../secret")).toBe(false);
    expect(isAllowedVelggPath("bo1z//evil")).toBe(false);
    expect(isAllowedVelggPath("https://evil.com")).toBe(false);
  });

  it("treats the landing + map pages as HTML", () => {
    expect(isVelggHtmlPath("bo1z")).toBe(true);
    expect(isVelggHtmlPath("bo1z/five")).toBe(true);
    expect(isVelggHtmlPath("bo1z/kino")).toBe(true);
    expect(isVelggHtmlPath("bo1z/play.js")).toBe(false);
    expect(isVelggHtmlPath("bo1z/manifest.json")).toBe(false);
  });

  it("recognises the analytics module + endpoint by exact path", () => {
    expect(isVelggTelemetryModule("bo1z/telemetry.js")).toBe(true);
    expect(isVelggTelemetryModule("bo1z/Telemetry.JS")).toBe(true);
    expect(isVelggTelemetryModule("bo1z/play.js")).toBe(false);
    expect(isVelggTelemetryEndpoint("bo1z/telemetry")).toBe(true);
    expect(isVelggTelemetryEndpoint("bo1z/telemetry.js")).toBe(false);
  });

  it("serves a no-op telemetry stub with the exports the game imports", () => {
    expect(VELGG_TELEMETRY_STUB).toContain("frameStats");
    expect(VELGG_TELEMETRY_STUB).toContain("startTelemetry");
    expect(VELGG_TELEMETRY_STUB).not.toContain("fetch(");
  });

  it("rewrites absolute vel.gg URLs but NEVER corrupts './telemetry.js'", () => {
    // REGRESSION: a blanket `/telemetry` replace turned the relative module
    // specifier `./telemetry.js` into `/api/velgg/__blocked_telemetry.js`,
    // which 404'd and hung the whole game on "Loading".
    const js =
      "import { startTelemetry } from './telemetry.js';\nfetch('https://vel.gg/bo1z/manifest.json');";
    const out = rewriteVelggBody(js);
    expect(out).toContain("'./telemetry.js'");
    expect(out).not.toContain("__blocked_telemetry");
    expect(out).toContain("/api/velgg/bo1z/manifest.json");
  });
});
