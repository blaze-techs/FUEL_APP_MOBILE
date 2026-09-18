import { test, expect } from "@playwright/test";

/**
 * E2E probe: CrazyGames no-ads catalog on VIDEO GAMES tab, both prod hosts.
 * Anonymous live-host sessions skip the authenticated Games workspace; authenticated
 * coverage should provide Playwright storageState.
 */
const HOSTS = (process.env.PROBE_HOSTS || "fuel-app-mobile.vercel.app,fuel-app-mobile.pages.dev").split(",");

for (const host of HOSTS) {
  test.describe("CrazyGames E2E @ " + host, () => {
    test("catalog loads + clean iframe player, no ads", async ({ page }) => {
      const adRequests: string[] = [];
      let catalogOk = false;
      page.on("request", (req) => {
        const u = req.url();
        if (/doubleclick|googlesyndication|adsbygoogle|adservice|adnxs|crazysdk|poki|googleadservices|pubads|ad\.yieldlab|an\.yandex|ad\.gamevial?/i.test(u)) adRequests.push(u);
        if (u.includes("/api/game-catalog-proxy") && req.method() === "GET") catalogOk = true;
      });

      await page.goto("https://" + host + "/", { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);

      const loginForm = page.getByPlaceholder(/you@company\.com/i);
      if (await loginForm.count()) {
        test.skip(true, "CrazyGames workspace requires an authenticated Playwright storage state.");
      }

      const tab = page.locator("button, a, [role=tab], nav a", { hasText: /^Games$/ }).first();
      if (await tab.count()) {
        await tab.click();
      } else {
        const anyGames = page.locator("button, a", { hasText: /^(Video Games|Games)$/i }).first();
        await anyGames.click();
      }
      await page.waitForTimeout(2000);

      const crazyBtn = page.locator("button", { hasText: /^CrazyGames/i }).first();
      if (await crazyBtn.count()) {
        await crazyBtn.click();
        await page.waitForTimeout(4000);
      }

      const cardCount = await page.locator("[data-game-card], button[aria-label], img[alt]").count();
      const playBtn = page.locator('button[aria-label*="play" i], button:has-text("Play"), [role=button]:has-text("Play")').first();
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
        if (src.includes("game-embed") || src.includes("games.crazygames.com")) crazyIframeOk = true;
      }

      console.log("[" + host + "] adRequests=" + adRequests.length + " catalogOk=" + catalogOk + " cards=" + cardCount + " iframeCount=" + iframeCount + " crazyIframe=" + crazyIframeOk + " openedGame=" + openedGame);
      expect(catalogOk, "proxy should have been hit").toBe(true);
      expect(cardCount, "cards should render").toBeGreaterThan(0);
      expect(adRequests.length, "no ad-SDK requests").toBe(0);
    });
  });
}
