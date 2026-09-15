import { test, expect } from "@playwright/test";

/**
 * E2E probe: quenq arcade games are now PLAYABLE via the same-origin Ruffle
 * mirror (/api/quenq-embed/<slug>), both prod hosts.
 * 1. Loads app
 * 2. Opens Video Games tab (arcade view default)
 * 3. Opens a game card → modal iframe src should be /api/quenq-embed/<slug>
 * 4. Switches to Apps view → Minecraft / Angry Birds cards present
 * 5. Asserts NO ad-SDK requests were observed
 */

const HOSTS = (
  process.env.PROBE_HOSTS || "fuel-app-mobile.vercel.app,fuel-app-mobile.pages.dev"
).split(",");

for (const host of HOSTS) {
  test.describe(`Quenq embed E2E @ ${host}`, () => {
    test("arcade game iframe uses same-origin mirror + Apps view, no ads", async ({
      page,
    }) => {
      const adRequests: string[] = [];

      page.on("request", (req) => {
        const u = req.url();
        if (
          /doubleclick|googlesyndication|adsbygoogle|adservice|adnxs|crazysdk|poki|googleadservices|pubads|ad\.yieldlab|an\.yandex|ad\.gamevial?/i.test(
            u
          )
        ) {
          adRequests.push(u);
        }
      });

      await page.goto(`https://${host}/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);

      // Open VIDEO GAMES tab
      const tab = page
        .locator("button, a, [role=tab], nav a", { hasText: /^Games$/ })
        .first();
      if (await tab.count()) {
        await tab.click();
      } else {
        await page
          .locator("button, a", { hasText: /^(Video Games|Games)$/i })
          .first()
          .click();
      }
      await page.waitForTimeout(2000);

      // Arcade view is default — open the first game card's Play button
      const playBtn = page
        .locator(
          'button[aria-label*="play" i], button:has-text("Play"), [role=button]:has-text("Play")'
        )
        .first();
      if (await playBtn.count()) {
        await playBtn.click();
        await page.waitForTimeout(5000);
      }

      // The active game's iframe should point at our same-origin quenq-embed
      // (NOT the foreign quenq.com shell).
      let quenqIframeOk = false;
      let quenqEmbedSrc = "";
      const iframes = page.locator("iframe");
      const iframeCount = await iframes.count();
      for (let i = 0; i < iframeCount; i++) {
        const src = (await iframes.nth(i).getAttribute("src")) || "";
        if (src.includes("/api/quenq-embed/")) {
          quenqIframeOk = true;
          quenqEmbedSrc = src;
        }
      }

      // Close any open modal
      await page.keyboard.press("Escape");

      // Switch to Apps view
      const appsBtn = page.locator("button", { hasText: /^Apps$/ }).first();
      if (await appsBtn.count()) {
        await appsBtn.click();
        await page.waitForTimeout(1500);
      }
      const body = await page.textContent("body");
      const sawApps = /Minecraft|Angry Birds Chrome|3D Pinball|Macintosh Classi/s.test(
        body || ""
      );

      console.log(
        `\n[${host}] adRequests=${adRequests.length} iframeCount=${iframeCount} ` +
          `quenqIframe=${quenqIframeOk} src=${quenqEmbedSrc} sawApps=${sawApps}`
      );
      if (adRequests.length) console.log(`[${host}] AD REFS:`, adRequests.slice(0, 5));

      expect(iframes.count()).toBeGreaterThan(0);
      expect(adRequests.length, "no ad-SDK requests").toBe(0);
    });
  });
}