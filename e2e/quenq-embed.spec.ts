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
    // Ruffle must fetch + compile its WASM bundle before it attaches a
    // canvas, and under Mobile Chrome emulation on a cold CI runner that is
    // slow and variable. Give real headroom and POLL for the canvas instead
    // of sampling once, so a slow-but-working host is never reported as a
    // failure. The per-attempt work is also wrapped, because a frame that is
    // mid-navigation makes locator calls throw rather than return 0.
    test.setTimeout(180_000);

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

      // Poll for the canvas instead of sleeping a fixed 20s and then waiting
      // once. A frame that is still navigating makes locator calls THROW (not
      // return 0), and Ruffle's WASM compile time varies with runner speed, so
      // each attempt is time-bounded and guarded, and the frame is re-resolved
      // because it can be replaced while the player boots.
      let canvas = 0;
      let hasRuffle = false;
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        try {
          const frame = page.frames().find((x) => x !== page.mainFrame());
          if (frame) {
            await frame
              .locator("canvas")
              .first()
              .waitFor({ state: "attached", timeout: 10_000 });
            canvas = await frame.locator("canvas").count();
            hasRuffle = await frame.evaluate(
              () => typeof (window as any).RufflePlayer !== "undefined",
            );
            if (canvas > 0) break;
          }
        } catch {
          /* frame still booting or mid-navigation — keep polling */
        }
        await page.waitForTimeout(1_000);
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
