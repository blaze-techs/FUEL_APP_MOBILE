import { describe, it, expect } from "vitest";
import {
  INXANITY_GAMES,
  unifiedFromInxanity,
  buildUnifiedGames,
  filterUnifiedBySource,
  countUnifiedBySource,
  SOURCE_LABEL,
  SOURCE_FILTERS,
} from "@/react-app/services/GameCatalogService";

// Guards the reverse-engineered inxanitylabs.com integration. Their /games
// page is a curated free-browser-games catalog; we mirror it 1:1. These
// assertions pin the verified facts so the catalog cannot silently drift into
// claiming a game plays when its origin is dead or it forbids framing.
describe("INXANITY Labs reverse-engineered catalog", () => {
  it("mirrors their full 11-title catalog with unique slugs", () => {
    expect(INXANITY_GAMES).toHaveLength(11);
    const slugs = INXANITY_GAMES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every entry has an https cover, a playable url, a blurb and tags", () => {
    for (const g of INXANITY_GAMES) {
      // Playable url is either an https provider page (frameable as-is) or our
      // same-origin mirror route (for providers that forbid framing).
      expect(
        g.url.startsWith("https://") || g.url.startsWith("/api/game-mirror/"),
      ).toBe(true);
      expect(g.coverUrl.startsWith("https://www.inxanitylabs.com/")).toBe(true);
      expect(g.blurb.length).toBeGreaterThan(10);
      expect(g.tags.length).toBeGreaterThan(0);
      expect(["iframe", "external"]).toContain(g.mode);
    }
  });

  it("embeds every playable title in-app (mirror or direct)", () => {
    const embeddable = INXANITY_GAMES.filter((g) => g.mode === "iframe").map(
      (g) => g.slug,
    );
    // Frameable origins verified LIVE (no X-Frame-Options/frame-ancestors) PLUS
    // the mirror-backed providers that used to force a new tab.
    for (const slug of [
      "lego-island",
      "pokemon-redstone",
      "taipei-rush",
      "redcoats",
      "salty-seas",
      "sandstorm",
      "seedbed",
      "counter-strike",
      "park-baron",
      "nacht-der-untoten",
    ]) {
      expect(embeddable).toContain(slug);
    }
  });

  it("mirror-backed titles play through our own origin, never the raw provider", () => {
    // Park Baron + Nacht der Untoten sent X-Frame-Options; they now route
    // through /api/game-mirror so the iframe is same-origin.
    const park = INXANITY_GAMES.find((g) => g.slug === "park-baron")!;
    const nacht = INXANITY_GAMES.find((g) => g.slug === "nacht-der-untoten")!;
    expect(park.url).toBe("/api/game-mirror/parkbaron/");
    expect(nacht.url).toBe("/api/game-mirror/nacht/");
  });

  it("only the archived GTA V port opens in a new tab", () => {
    const external = INXANITY_GAMES.filter((g) => g.mode === "external").map(
      (g) => g.slug,
    );
    // GTA V is the archived (non-playable) snapshot — the only genuine
    // new-tab entry left.
    expect(external).toEqual(["gta-v"]);
  });

  it("GTA V entry is the archive snapshot, never the dead live origin", () => {
    const gta = INXANITY_GAMES.find((g) => g.slug === "gta-v");
    expect(gta).toBeDefined();
    expect(gta!.url).toContain("web.archive.org");
    expect(gta!.url.startsWith("https://playgta5.com")).toBe(false);
    expect(gta!.mode).toBe("external");
    expect(gta!.note?.toLowerCase()).toContain("rockstar");
  });

  it("unifiedFromInxanity maps source, kind and merged note", () => {
    const lego = INXANITY_GAMES.find((g) => g.slug === "lego-island")!;
    const u = unifiedFromInxanity(lego);
    expect(u.id).toBe("inxanity:lego-island");
    expect(u.source).toBe("inxanity");
    expect(u.sourceLabel).toBe(SOURCE_LABEL.inxanity);
    expect(u.kind).toBe("iframe");
    expect(u.playUrl).toBe(lego.url);
    expect(u.coverUrl).toBe(lego.coverUrl);
    // note merges the about text + the legal disclaimer
    expect(u.note).toContain("1997");
    expect(u.note?.toLowerCase()).toContain("lego");
  });

  it("only the cloud/archived entries map to kind:external with a hint", () => {
    // Every mirror-backed provider now maps to an inline iframe; only the
    // archived GTA V snapshot still leaves the app.
    const gta = INXANITY_GAMES.find((g) => g.slug === "gta-v")!;
    const u = unifiedFromInxanity(gta);
    expect(u.kind).toBe("external");
    expect(u.platform?.toLowerCase()).toContain("new tab");
    const park = INXANITY_GAMES.find((g) => g.slug === "park-baron")!;
    expect(unifiedFromInxanity(park).kind).toBe("iframe");
  });

  it("is wired into the unified collection + source filter + counts", () => {
    const all = buildUnifiedGames({});
    const inx = filterUnifiedBySource(all, "inxanity");
    expect(inx).toHaveLength(INXANITY_GAMES.length);
    expect(inx.every((g) => g.source === "inxanity")).toBe(true);
    expect(countUnifiedBySource(all).inxanity).toBe(INXANITY_GAMES.length);
    expect(SOURCE_FILTERS.some((f) => f.value === "inxanity")).toBe(true);
  });

  it("no duplicate ids across the whole unified collection", () => {
    const all = buildUnifiedGames({});
    const ids = all.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
