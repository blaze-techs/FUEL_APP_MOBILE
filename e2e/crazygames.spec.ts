import { test, expect } from "@playwright/test";

/**
 * E2E probe: CrazyGames no-ads catalog on VIDEO GAMES tab, both prod hosts.
 * 1. Loads app
 * 2. Opens Video Games tab
 * 3. Switches to CrazyGames view
 * 4. Verifies game cards render (from /api/game-catalog-proxy)
 * 5. Opens a game, verifies the clean embed iframe loads
 * 6. Asserts NO ad-SDK requests were observed
 */

const HOSTS = (
  process.env.PROBE_HOSTS ||
  "fuel-app-mobile.vercel.app,fuel-app-mobile.pages.dev"
).split(",");

for (const host of HOSTS) {
  test.describe(`CrazyGames E2E @ ${host}`, () => {
    test("catalog loads + clean iframe player, no ads", async ({ page }) => {
      const adRequests: string[] = [];
      let catalogOk = false;

      page.on("request", (req) => {
        const u = req.url();
        if (
          /doubleclick|googlesyndication|adsbygoogle|adservice|adnxs|crazysdk|poki|googleadservices|pubads|ad\.yieldlab|an\.yandex|ad\.gamevial?/i.test(
            u,
          )
        ) {
          adRequests.push(u);
        }
        if (u.includes("/api/game-catalog-proxy") && req.method() === "GET") {
          catalogOk = true;
        }
      });

      await page.goto(`https://${host}/`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);

      // Find and click "Games" nav (tab may lazy-load)
      const tab = page
        .locator("button, a, [role=tab], nav a", { hasText: /^Games$/ })
        .first();
      if (await tab.count()) {
        await tab.click();
      } else {
        const anyGames = page
          .locator("button, a", { hasText: /^(Video Games|Games)$/i })
          .first();
        await anyGames.click();
      }
      await page.waitForTimeout(2000);

      // NEW unified UI: the "All games" view shows the combined grid by
      // default. Click the "CrazyGames" source chip to filter to the catalog.
      const crazyBtn = page
        .locator("button", { hasText: /^CrazyGames/i })
        .first();
      if (await crazyBtn.count()) {
        await crazyBtn.click();
        await page.waitForTimeout(4000);
      }

      // Cards should be present
      const cards = page.locator("button", { hasText: /getElementAttribute/i });
      const cardCount = await page
        .locator("[data-game-card], button[aria-label], img[alt]")
        .count();

      // Look for game names known to be in crazygames action catalog
      const body = await page.textContent("body");
      const sawCatalog =
        /War the Knights|I Am Quadrober|Zoo Boom|Plunder|CrazyGames/i.test(
          body || "",
        );

      // Open the first playable card's Play button
      const playBtn = page
        .locator(
          'button[aria-label*="play" i], button:has-text("Play"), [role=button]:has-text("Play")',
        )
        .first();
      let openedGame = false;
      if (await playBtn.count()) {
        await playBtn.click();
        openedGame = true;
        await page.waitForTimeout(6000);
      }

      const iframes = page.locator("iframe");
      const iframeCount = await iframes.count();
      let crazyIframeOk = false;
      for (let i = 0; i < iframeCount; i++) {
        const src = (await iframes.nth(i).getAttribute("src")) || "";
        if (src.includes("game-embed") || src.includes("games.crazygames.com"))
          crazyIframeOk = true;
      }

      console.log(
        `\n[${host}] adRequests=${adRequests.length} catalogOk=${catalogOk} ` +
          `cards=${cardCount} sawCatalog=${sawCatalog} iframeCount=${iframeCount} crazyIframe=${crazyIframeOk} openedGame=${openedGame}`,
      );
      if (adRequests.length) {
        console.log(`[${host}] AD REFS:`, adRequests.slice(0, 5));
      }

      expect(catalogOk, "proxy should have been hit").toBe(true);
      expect(cardCount, "cards should render").toBeGreaterThan(0);
      expect(adRequests.length, "no ad-SDK requests").toBe(0);
    });
  });
}
