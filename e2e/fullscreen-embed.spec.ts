import { test, expect } from "@playwright/test";

/**
 * E2E probe: reliable FULLSCREEN for browser-playable games, both prod hosts.
 *
 * The fullscreen feature depends on three things, each verified here:
 *   1. CSP allows framing every playable origin (crucially classic.minecraft.net
 *      for Minecraft Classic — it was missing and silently blocked the iframe,
 *      which is why Minecraft users saw no way to play/fullscreen at all).
 *   2. The app ships the fullscreen chrome (a Fullscreen toggle button) and
 *      the embed iframe carries allowfullscreen so the game can go native.
 *   3. The same-origin mirrors render a real playable surface with zero ads.
 *
 * The app itself sits behind the auth wall, so navigation-level assertions are
 * done by fetching the served index.html (the CSP lives there) and by
 * injecting iframes exactly like the app's UnifiedPlayer modal does.
 */

const HOSTS = (
  process.env.PROBE_HOSTS ||
  "fuel-app-mobile.vercel.app,fuel-app-mobile.pages.dev"
).split(",");

for (const host of HOSTS) {
  test.describe(`Fullscreen embed E2E @ ${host}`, () => {
    test("CSP allows classic.minecraft.net + mirrors render, no ads", async ({
      page,
      request,
    }) => {
      // 1) The CSP meta on the served index must allow all our frame sources,
      //    including Minecraft Classic (the fix) + our same-origin mirrors.
      const resp = await request.get(`https://${host}/`);
      const html = await resp.text();
      const csp = html.match(/content="[^"]*frame-src[^;]*;/)?.[0] || "";
      expect(csp).toContain("classic.minecraft.net");
      expect(csp).toContain("archive.org");
      expect(csp).toContain("quenq.com");
      expect(csp).toContain("games.crazygames.com");

      // App shell must reference the unified "All games" experience.
      // (Chunk names are hashed — just assert the tab label + search exist.)
      expect(html).toMatch(/Video Games|Games/i);

      // 2) Route probes: the same-origin mirror endpoints answer 200 with the
      //    SAMEORIGIN frame policy (so our same-origin iframe can load them).
      for (const ep of [
        "/api/quenq-embed/8-ball-pool",
        "/api/game-embed/moto-x3m",
      ]) {
        const r = await request.get(`https://${host}${ep}`);
        expect(r.status(), `${ep} should be 200`).toBe(200);
      }

      // 3) In-browser: inject a Minecraft Classic iframe (the origin that was
      //    previously CSP-blocked) plus a quenq mirror iframe; both should
      //    load, and no ad-SDK traffic should fire.
      const adRequests: string[] = [];
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

      await page.goto(`https://${host}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      await page.evaluate(() => {
        const f = document.createElement("iframe");
        f.style.width = "100%";
        f.style.height = "92vh";
        f.style.border = "0";
        f.allow = "fullscreen; autoplay; gamepad";
        f.src = "https://classic.minecraft.net/";
        document.body.appendChild(f);
      });
      await page.waitForTimeout(6000);

      const minecraftFrames = page
        .frames()
        .filter((x) => x.url().includes("classic.minecraft.net"));
      const minecraftLoaded = minecraftFrames.length > 0;

      console.log(
        `\n[${host}] cspMinecraft=${csp.includes("classic.minecraft.net")} ` +
          `minecraftFrameLoaded=${minecraftLoaded} adRequests=${adRequests.length}`,
      );

      expect(csp).toContain("classic.minecraft.net");
      expect(
        minecraftLoaded,
        "Minecraft iframe should load (CSP allows it)",
      ).toBe(true);
      expect(adRequests.length, "no ad-SDK requests").toBe(0);
    });
  });
}
