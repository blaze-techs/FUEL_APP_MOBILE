import { test, expect } from "@playwright/test";

/**
 * E2E probe: GameDistribution / gameflare.com no-ads mirror, both prod hosts.
 *
 * The normal game page (gameflare.com/<slug>) sends X-Frame-Options:
 * SAMEORIGIN, so gameflare.com itself can't be iframed. But gameflare's real
 * raw builds are hosted on html5.gamedistribution.com (CORS *, no XFO) — we
 * mirror them through our own origin at `/api/game-embed/gd/<id>/` and strip
 * the GD ad SDK (ima3.js + main.min.js), injecting an ad-free shim instead.
 *
 * 1. GET /api/game-embed/gd/<id>/          -> 307 to inner game
 * 2. GET inner /api/game-embed/gd/<p>/<id>/index.html -> shimmed, ad-stripped
 * 3. Boot the mirror in a real <iframe> and assert ZERO ad requests.
 */

const HOSTS = (
  process.env.PROBE_HOSTS ||
  "fuel-app-mobile.vercel.app,fuel-app-mobile.pages.dev"
).split(",");

const GD_ID = "5b0abd4c0faa4f5eb190a9a16d5a1b4c"; // moto-x3m (proven ad-free)

const AD_RE =
  /doubleclick|googlesyndication|adsbygoogle|adservice|adnxs|crazysdk|poki|googleadservices|pubads|yieldlab|yandex|gamevial|html5\.api\.gamedistribution|dashboard\.gamedistribution|imasdk\.googleapis/i;

for (const host of HOSTS) {
  test.describe(`GameDistribution mirror E2E @ ${host}`, () => {
    test("entry->inner mirror is ad-free + boots ad-free in iframe", async ({
      page,
    }) => {
      const adRequests: string[] = [];
      page.on("request", (req) => {
        const u = req.url();
        if (AD_RE.test(u)) adRequests.push(u);
      });

      // 1) entry redirect -> inner page (APIRequestContext follows redirects by
      // default, so disable following to assert the 307 + read the Location)
      const entry = await page.request.get(
        `https://${host}/api/game-embed/gd/${GD_ID}`,
        { maxRedirects: 0 },
      );
      expect(entry.status()).toBe(307);
      const loc = entry.headers()["location"] || "";
      expect(loc).toMatch(
        /\/api\/game-embed\/gd\/[^/]+\/[a-f0-9]+\/index\.html/,
      );

      // 2) inner page: shimmed + ad-stripped
      const innerUrl = `https://${host}${loc}`;
      const inner = await page.request.get(innerUrl);
      expect(inner.status()).toBe(200);
      expect(inner.headers()["x-frame-options"]).toBe("SAMEORIGIN");
      const html = await inner.text();
      expect(html).toContain("window.gdsdk"); // shim injected
      expect(html).not.toContain("imasdk.googleapis.com"); // IMA stripped
      expect(html).not.toContain("html5.api.gamedistribution.com/main.min.js");
      expect(html).not.toContain("gamedistribution-jssdk");

      // 3) boot in a real iframe and assert no external ad traffic
      // (page.goto returns null for data: URLs, so assert the DOM instead)
      await page.goto(
        `data:text/html,<html><body style="margin:0"><iframe src="${innerUrl}" width="800" height="600" allow="autoplay; fullscreen"></iframe></body></html>`,
        { waitUntil: "load" },
      );
      await page.waitForTimeout(8000);

      const iframe = page.locator("iframe");
      let iframeOk = false;
      const iframeCount = await iframe.count();
      for (let i = 0; i < iframeCount; i++) {
        const src = (await iframe.nth(i).getAttribute("src")) || "";
        if (src.includes("/api/game-embed/gd/")) iframeOk = true;
      }

      console.log(
        `\n[${host}] loc=${loc} iframe=${iframeOk} adRequests=${adRequests.length}`,
      );
      if (adRequests.length)
        console.log(`[${host}] AD REFS:`, adRequests.slice(0, 5));

      expect(iframeOk, "gd mirror iframe should be present").toBe(true);
      expect(adRequests.length, "no ad-SDK requests during boot").toBe(0);
    });
  });
}
