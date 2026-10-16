/**
 * Reezn TV (com.rmedia.rplayer, v2.0.19) parity for the News tab.
 *
 * The APK was reverse-engineered (unzip + static analysis) to recover its
 * feature surface, then each capability was mapped onto a News sub-tab that
 * reuses FuelPro's EXISTING players and cloud keys. These tests pin that
 * mapping so a future refactor cannot silently drop a sub-tab or point one at
 * a surface the Movies player does not implement.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SUBTAB_REGISTRY } from "@/react-app/config/subtab-registry";

const NEWS = readFileSync("src/react-app/components/News.tsx", "utf8");
const MOVIES = readFileSync("src/react-app/components/MoviesEmbed.tsx", "utf8");
const LIVE = readFileSync("src/react-app/components/LiveFeedEmbed.tsx", "utf8");
const SETTINGS = readFileSync(
  "src/react-app/components/PlayerSettingsPanel.tsx",
  "utf8",
);

const newsSubTabs = () =>
  SUBTAB_REGISTRY.find((h) => h.hostTab === "news")!.subTabs.map((s) => s.id);

describe("Reezn feature parity → News sub-tabs", () => {
  it("exposes every Reezn surface as a News sub-tab", () => {
    const ids = newsSubTabs();
    for (const id of [
      "articles",
      "movies",
      "series",
      "my-list",
      "discover",
      "coming-up",
      "live-tv",
      "live-radio",
      "sports",
      "player-settings",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("renders a branch AND a SubTabBar entry for every declared sub-tab", () => {
    const ids = newsSubTabs();
    for (const id of ids) {
      // Render branch (guarded by the deep-link state var).
      expect(NEWS).toContain(`activeSubTab === "${id}"`);
      // SubTabBar entry.
      expect(NEWS).toContain(`id: "${id}"`);
    }
  });

  it("maps Movie/Series/Library surfaces onto the Movies player", () => {
    // The player must advertise the surfaces the News tab asks for.
    for (const surface of ["catalog", "library", "discover", "coming-up"]) {
      expect(MOVIES).toContain(`"${surface}"`);
    }
    // Series reuses the TV-only filter rather than a second catalog.
    expect(NEWS).toMatch(/initialType="tv"/);
    expect(NEWS).toMatch(/initialType="movie"/);
  });

  it("wires Sports to the live-sports category, not a movie surface", () => {
    expect(NEWS).toMatch(/defaultCategory="sports"/);
  });

  it("keeps one source of truth for playback preferences", () => {
    // Player Settings must reuse the EXACT cloud keys the players read.
    for (const key of [
      "movie_auto_next",
      "live_feed_subtitle_lang",
      "live_feed_autoplay",
    ]) {
      expect(SETTINGS).toContain(key);
    }
    // MoviesEmbed owns auto-next; LiveFeedEmbed owns autoplay.
    expect(MOVIES).toContain("movie_auto_next");
    expect(LIVE).toContain("live_feed_autoplay");
    // Data saver must be a real cap, not a label.
    expect(MOVIES).toContain("capLevelToPlayerSize");
    // And the autoplay preference must gate the play calls.
    expect(LIVE).toMatch(/if \(autoStart\)/);
  });

  it("falls back to the playable classics library when the streaming catalog is unreachable", () => {
    // The streamingunity proxy upstream refuses datacenter egress (403) and
    // sends no CORS, so the current-titles catalog can never load server-side.
    // The player must surface the public-domain classics library (archive.org,
    // which IS reachable) rather than a dead "Could not load the catalog" panel.
    expect(MOVIES).not.toContain('setError("Could not load the catalog.")');
    expect(MOVIES).toContain("setCatalogUnavailable(true)");
    expect(MOVIES).toContain('setView("classics")');
    // And it must say so honestly in the UI.
    expect(MOVIES).toContain("catalogUnavailable");
  });
});
