import { describe, it, expect } from "vitest";
import {
  parseCrazygamesCatalog,
  fetchCrazygamesPage,
  crazygamesEmbedUrl,
  crazygamesCoverUrl,
} from "../../api/_lib/crazygames-catalog";

/* Realistic __NEXT_DATA__ blob as CrazyGames embeds in category pages.
   Top-level structure mirrors the live page:
   { "props": { "pageProps": { "games": { "pagination", "total", "items" } } },
     "page": "/c/action", "query": {}, "buildId": "..." } */
const SAMPLE_PAGE = `<html><head></head><body>
<script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">{"props":{"locale":"en-US","pageProps":{"games":{"pagination":{"page":1,"size":60},"total":719,"items":[
{"id":"53718","name":"War the Knights","slug":"war-the-knights","cover":"war-the-knights_16x9/20251104084824/war-the-knights_16x9-cover","isOriginal":false,"mobileFriendly":true,"categoryName":"Action","releaseYear":2025,"totalPlays":13795825},
{"id":"81259","name":"I Am Quadrober!","slug":"i-am-quadrober","cover":"i-am-quadrober_16x9/20260417060318/i-am-quadrober_16x9-cover","isOriginal":false,"mobileFriendly":true,"categoryName":"Action","releaseYear":2026,"totalPlays":903633},
{"id":"99999","name":"No Cover","slug":"no-cover","cover":"","mobileFriendly":false,"categoryName":"Puzzle","totalPlays":0}
]}},"__NEXT_BUILD_ID":"x"},"page":"/c/action","query":{},"buildId":"1789391964"}</script>
</body></html>`;

describe("CrazyGames catalog proxy lib", () => {
  it("parses the embedded __NEXT_DATA__ games, total + pagination", () => {
    const r = parseCrazygamesCatalog(SAMPLE_PAGE);
    expect(r.total).toBe(719);
    expect(r.page).toBe(1);
    expect(r.size).toBe(60);
    expect(r.games).toHaveLength(3);
    const war = r.games[0];
    expect(war.name).toBe("War the Knights");
    expect(war.slug).toBe("war-the-knights");
    expect(war.plays).toBe(13795825);
    expect(war.year).toBe(2025);
    expect(war.category).toBe("Action");
    expect(war.mobile).toBe(true);
    expect(war.embedUrl).toBe(
      "https://games.crazygames.com/en_US/war-the-knights/index.html",
    );
  });

  it("filters entries without a slug or name", () => {
    const html = SAMPLE_PAGE.replace(
      `{"id":"99999","name":"No Cover"`,
      `{"id":"99999",""`,
    );
    const r = parseCrazygamesCatalog(html);
    expect(r.games.some((g) => g.slug === "no-cover")).toBe(false);
  });

  it("returns an empty result on non-crazygames HTML / bad JSON", () => {
    expect(parseCrazygamesCatalog("<html>no json</html>").games).toHaveLength(
      0,
    );
    expect(
      parseCrazygamesCatalog(
        `<script id="__NEXT_DATA__" type="application/json">{bad</script>`,
      ).games,
    ).toHaveLength(0);
  });

  it("builds clean embed + cover URLs (deduplicated with client mirrors)", () => {
    expect(crazygamesEmbedUrl("moto-x3m")).toBe(
      "https://games.crazygames.com/en_US/moto-x3m/index.html",
    );
    expect(
      crazygamesCoverUrl("moto-x3m_1x1/20231122033955/moto-x3m_1x1-cover"),
    ).toBe(
      "https://imgs.crazygames.com/moto-x3m_1x1/20231122033955/moto-x3m_1x1-cover?format=auto&quality=70&metadata=none",
    );
    expect(crazygamesCoverUrl("")).toBe("");
  });

  it("fetchCrazygamesPage uses the injected fetch impl (server-side)", async () => {
    const fakeFetch = async () => new Response(SAMPLE_PAGE, { status: 200 });
    const r = await fetchCrazygamesPage(
      "action",
      1,
      fakeFetch as unknown as typeof fetch,
    );
    expect(r.ok).toBe(true);
    expect(r.data.total).toBe(719);
    expect(r.data.games[0].slug).toBe("war-the-knights");
  });

  it("fetchCrazygamesPage returns ok:false on upstream error", async () => {
    const fakeFetch = async () => new Response("nope", { status: 403 });
    const r = await fetchCrazygamesPage(
      "action",
      1,
      fakeFetch as unknown as typeof fetch,
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});
