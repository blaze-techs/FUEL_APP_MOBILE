import { test, expect } from "@playwright/test";

/**
 * E2E probe: quenq arcade games are PLAYABLE via the same-origin Ruffle
 * mirror (/api/quenq-embed/<slug>) on both prod hosts.
 *
 * Verification model (matched to the actual fix):
 * - The app frames /api/quenq-embed/<slug> with the SAME origin as the app
 *   host (so X-Frame-Options: SAMEORIGIN is satisfied).
 * - Here we emulate exactly that: load a same-origin parent page, inject an
 *   iframe at /api/quenq-embed/<slug>, and assert Ruffle attaches a real
 *   canvas (proving a playable game) with NO ad-SDK requests.
 *
 * The app-side wiring (gameEmbedUrl → /api/quenq-embed/<slug>, Apps view)
 * is covered by the vitest suite; browser-level app navigation lives behind
 * the auth wall and is exercised manually.
 */

const HOSTS = (
  process.env.PROBE_HOSTS ||
  "fuel-app-mobile.vercel.app,fuel-app-mobile.pages.dev"
).split(",");

for (const host of HOSTS) {
  test.describe(`Quenq embed E2E @ ${host}`, () => {
    test("same-origin Ruffle iframe renders a game canvas, no ads", async ({
      page,
    }) => {
      const adRequests: string[] = [];
      const httpFailures: string[] = [];

      page.on("request", (req) => {
        const u = req.url();
        if (
          /doubleclick|googlesyndication|adsbygoogle|adservice|adnxs|crazysdk|poki|googleadservices|pubads|ad\.yieldlab|an\.yandex|ad\.gamevial?/i.test(
            u,
          )
        ) {
          adRequests.push(u);
        }
      });
      page.on("response", (r) => {
        if (r.status() >= 400) {
          httpFailures.push(`${r.status()} ${r.url()}`);
        }
      });

      // Parent = same origin as the app host (what the app itself does).
      await page.goto(`https://${host}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      // Inject the same-origin quenq-embed iframe (mirrors GamePlayer modal).
      await page.evaluate(() => {
        const f = document.createElement("iframe");
        f.style.width = "100%";
        f.style.height = "92vh";
        f.style.border = "0";
        f.allow = "fullscreen; autoplay; gamepad";
        f.src = "/api/quenq-embed/8-ball-pool";
        document.body.appendChild(f);
      });

      await page.waitForTimeout(20000);

      const frame = page.frames().find((x) => x !== page.mainFrame());
      let canvas = 0;
      let hasRuffle = false;
      if (frame) {
        canvas = await frame.locator("canvas").count();
        hasRuffle = await frame.evaluate(
          () => typeof (window as any).RufflePlayer !== "undefined",
        );
      }

      console.log(
        `\n[${host}] canvas=${canvas} ruffle=${hasRuffle} ` +
          `adRequests=${adRequests.length} httpFailures=${httpFailures.length}`,
      );
      if (adRequests.length)
        console.log(`[${host}] AD REFS:`, adRequests.slice(0, 5));
      if (httpFailures.length)
        console.log(`[${host}] HTTP FAILURES:`, httpFailures.slice(0, 5));

      expect(
        canvas,
        "Ruffle should attach a canvas (game is playable)",
      ).toBeGreaterThan(0);
      expect(hasRuffle, "Ruffle should be loaded").toBe(true);
      expect(adRequests.length, "no ad-SDK requests").toBe(0);
    });
  });
}
