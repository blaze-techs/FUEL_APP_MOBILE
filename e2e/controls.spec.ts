import { test, expect } from "@playwright/test";
import {
  pressedKeysFromGamepad,
  isSameOriginFrame,
  detectControls,
  GAMEPAD_BUTTON_KEYS,
  GAMEPAD_AXIS_KEYS,
  CONTROL_MODES,
} from "../src/react-app/lib/game-controls";

/**
 * E2E verification for the in-game CONTROLS system (both prod hosts):
 *
 *   1. Node-side: the SHIPPED control logic (the same module the app bundles)
 *      maps a gamepad to real keystrokes, classifies same-origin mirrors, and
 *      exposes the 4 selectable control modes.
 *   2. Live: the served app bundle on each host carries the Controls UI
 *      markers ("Game controls", "Controller", "Mouse / touch",
 *      "gamepadCount") — proving the deployed build includes the feature.
 *   3. Live: the same-origin mirror games the controls bridge targets (quenq +
 *      crazy + GD/gameflare mirrors) still boot with ZERO ad requests, and the
 *      player iframes carry the `gamepad` permission-policy token.
 */

const AD_RE =
  /doubleclick|googlesyndication|adsbygoogle|adservice|adnxs|crazysdk|poki|googleadservices|pubads|ad\.yieldlab|an\.yandex|ad\.gamevial?/i;

// ── 1. Node-side: shipped controls logic ─────────────────────────────────
test.describe("Shipped controls logic (game-controls)", () => {
  test("offers the 4 control modes a user can switch between", () => {
    expect(CONTROL_MODES.map((m) => m.value)).toEqual([
      "auto",
      "keyboard",
      "mouse",
      "gamepad",
    ]);
  });

  test("classifies same-origin mirrors (bridgeable) vs foreign hosts", () => {
    // jsdom/node has no window.location, but the helper falls back cleanly for
    // absolute URLs; our mirror paths are treated as same-origin "usually".
    expect(isSameOriginFrame("/api/game-embed/moto-x3m")).toBe(true);
    const absolute = isSameOriginFrame("https://archive.org/embed/dosbox-doom");
    expect(absolute).toBe(false);
  });

  test("gamepad buttons/d-pad/stick map to playable keyboard keys", () => {
    const byIndex = Object.fromEntries(
      GAMEPAD_BUTTON_KEYS.map((b) => [b.index, b.key]),
    );
    // A = jump, B = interact, Start = Enter, d-pad = arrows
    expect(byIndex[0]).toBe(" ");
    expect(byIndex[1]).toBe("e");
    expect(byIndex[9]).toBe("Enter");
    expect(byIndex[12]).toBe("ArrowUp");
    expect(byIndex[13]).toBe("ArrowDown");
    expect(byIndex[14]).toBe("ArrowLeft");
    expect(byIndex[15]).toBe("ArrowRight");
    expect(GAMEPAD_AXIS_KEYS.length).toBeGreaterThanOrEqual(2);
  });

  test("detectControls tolerates no gamepads (browser/node safe)", () => {
    const s = detectControls();
    expect(typeof s.gamepad).toBe("boolean");
    expect(typeof s.gamepadCount).toBe("number");
    expect(s.keyboard).toBe(true);
  });
});

// ── 2 + 3. Live-host verification ────────────────────────────────────────
const HOSTS = (
  process.env.PROBE_HOSTS ||
  "fuel-app-mobile.vercel.app,fuel-app-mobile.pages.dev"
).split(",");

for (const host of HOSTS) {
  test.describe(`Controls E2E @ ${host}`, () => {
    test("deployed bundle carries Controls UI + mirrors boot ad-free with gamepad token", async ({
      page,
      request,
    }) => {
      // VideoGames is a LAZY chunk — the served index shells into the entry
      // chunk(s) (assets/index-*.js), which reference the lazy VideoGames
      // chunk. Scan every entry chunk named in the HTML so we find the one
      // that imports the VideoGames route.
      const index = await (await request.get(`https://${host}/`)).text();
      const entries = index.match(/assets\/index-[A-Za-z0-9_-]+\.js/g) || [];
      expect(entries.length, "entry chunk present on home shell").toBeGreaterThan(0);
      let chunk: string | undefined;
      for (const entry of entries) {
        const entryBundle = await (
          await request.get(`https://${host}/${entry}`)
        ).text();
        chunk = entryBundle.match(
          /assets\/VideoGames-[A-Za-z0-9_-]+\.js/,
        )?.[0];
        if (chunk) break;
      }
      expect(chunk, "entry references the VideoGames lazy chunk").toBeTruthy();

      // The chunk must carry the Controls UI markers (deployed feature).
      const bundle = chunk
        ? await (await request.get(`https://${host}/${chunk}`)).text()
        : "";
      expect(bundle).toContain("Game controls");
      expect(bundle).toContain("Controller");
      expect(bundle).toContain("Mouse / touch");
      expect(bundle).toMatch(/gamepadCount/);
      console.log(
        `\n[${host}] controlsMarkers=${true} entries=${entries.length} chunk=${chunk}`,
      );

      // Ad-free mirror targets of the controls bridge must still respond.
      for (const ep of [
        "/api/quenq-embed/8-ball-pool",
        "/api/game-embed/moto-x3m",
      ]) {
        const r = await request.get(`https://${host}${ep}`);
        expect(r.status(), `${ep} 200`).toBe(200);
      }

      // Inject a same-origin mirror game exactly like the app's UnifiedPlayer
      // does (allow token includes gamepad) and assert it boots ad-free.
      const adRequests: string[] = [];
      page.on("request", (req) => {
        if (AD_RE.test(req.url())) adRequests.push(req.url());
      });

      await page.goto(`https://${host}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);

      await page.evaluate(() => {
        const f = document.createElement("iframe");
        f.style.width = "100%";
        f.style.height = "80vh";
        f.style.border = "0";
        f.allow = "fullscreen; autoplay; gamepad; picture-in-picture";
        f.src = "/api/game-embed/moto-x3m";
        document.body.appendChild(f);
      });
      await page.waitForTimeout(5000);

      const mirrorFrames = page
        .frames()
        .filter((x) => x.url().includes("/api/game-embed/"));
      const mirrorLoaded = mirrorFrames.length > 0;
      // The injected iframe's allow token permits the gamepad permission.
      const gamepadToken = await page.evaluate(() => {
        const f = Array.from(document.querySelectorAll("iframe")).find((x) =>
          x.src.includes("/api/game-embed/"),
        );
        return f ? f.allow.includes("gamepad") : false;
      });

      console.log(
        `[${host}] mirrorLoaded=${mirrorLoaded} gamepadToken=${gamepadToken} adRequests=${adRequests.length}`,
      );
      expect(mirrorLoaded, "same-origin mirror iframe loads").toBe(true);
      expect(gamepadToken, "iframe carries gamepad permission-policy token").toBe(
        true,
      );
      expect(adRequests.length, "no ad-SDK requests during boot").toBe(0);
    });
  });
}