import { describe, it, expect } from "vitest";
import {
  parseGdOuterLoader,
  gdShimScript,
  rewriteGdUrls,
  serveGdEmbed,
} from "../../src/server/vercel-api/_lib/gamedistribution-embed";

/* Realistic GameDistribution OUTER loader (as served by
 * https://html5.gamedistribution.com/<gameId>/index.html) — JS shell whose
 * gameSrc iframes the real inner game. */
const OUTER_LOADER = `
<!DOCTYPE html><html><head><title>Loader</title></head><body>
<script src="https://html5.api.gamedistribution.com/main.min.js"></script>
<script>
  (function () {
    var data = { host: window.location.hostname, version: "1.5.18" };
    var searchPart = formatTokenURLSearch(data);
    var gameSrc = "//html5.gamedistribution.com/rvvASMiM/5b0abd4c0faa4f5eb190a9a16d5a1b4c/index.html" + searchPart;
    this._container.src = gameSrc;
  })();
</script>
</body></html>`;

/* Realistic INNER game shell (as served by
 * https://html5.gamedistribution.com/<prefix>/<gameId>/index.html) with the
 * two ad scripts + the game boot call. */
const INNER_GAME = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="assets/css/app.css" type="text/css" />
  <title>MotoX3M</title>
</head>
<body>
  <div id="content"></div>
  <div id="orientation"></div>
  <div id="loader">Loading ...</div>
  <script type="text/javascript" src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"></script>
  <script type="text/javascript" src="assets/lib/phaser.min.js"></script>
  <script type="text/javascript">
    window["GD_OPTIONS"] = {
      "gameId": "5b0abd4c0faa4f5eb190a9a16d5a1b4c",
      "onEvent": function (event) {
        switch (event.name) {
          case "AD_ERROR": console.log("AD_ERROR"); break;
          case "SDK_GAME_START": console.log("SDK_GAME_START"); break;
          case "SDK_READY": console.log("SDK_READY"); break;
        }
      }
    };
  </script>
  <script type="text/javascript">
    (function(d, s, id) {
      var js, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) return;
      js = d.createElement(s); js.id = id;
      js.src = 'https://html5.api.gamedistribution.com/main.min.js';
      fjs.parentNode.insertBefore(js, fjs);
    }(document, 'script', 'gamedistribution-jssdk'));
  </script>
  <script src="assets/lib/motox3m4.min.js"></script>
</body></html>`;

describe("GameDistribution embed lib — outer loader prefix", () => {
  it("extracts the inner-game prefix from gameSrc", () => {
    expect(parseGdOuterLoader(OUTER_LOADER)).toEqual({
      prefix: "rvvASMiM",
      innerPath: "5b0abd4c0faa4f5eb190a9a16d5a1b4c",
    });
  });

  it("extracts the prefix from a bare //html5.gamedistribution.com ref", () => {
    const html = `... <script>var u = "//html5.gamedistribution.com/abcDEF123/5b0abd4c0faa4f5eb190a9a16d5a1b4c/index.html";</script>`;
    expect(parseGdOuterLoader(html)).toEqual({
      prefix: "abcDEF123",
      innerPath: "5b0abd4c0faa4f5eb190a9a16d5a1b4c",
    });
  });

  it("returns an empty object when no inner ref exists", () => {
    expect(parseGdOuterLoader("<html>nothing here</html>")).toEqual({});
  });
});

describe("GameDistribution embed lib — shim + rewrite", () => {
  it("shim exposes gdsdk + fires SDK_READY/SDK_GAME_START", () => {
    const shim = gdShimScript();
    expect(shim).toContain("window.gdsdk");
    expect(shim).toContain("showAd");
    expect(shim).toContain("showRewardedAd");
    expect(shim).toContain('fire("SDK_READY")');
    expect(shim).toContain('fire("SDK_GAME_START")');
    // The shim drives boot through the game's own GD_OPTIONS.onEvent
    expect(shim).toContain("opts.onEvent({ name: name, data: {} })");
  });

  it("rewrites absolute GD asset URLs to the mirror", () => {
    const body =
      'src="//html5.gamedistribution.com/rvvASMiM/5b0abd4c0faa4f5eb190a9a16d5a1b4c/assets/x.png" ' +
      'href="https://html5.gamedistribution.com/rvvASMiM/5b0abd4c0faa4f5eb190a9a16d5a1b4c/other/1.png"';
    const r = rewriteGdUrls(body);
    expect(r).not.toContain("html5.gamedistribution.com");
    expect(r).toContain(
      "/api/game-embed/gd/rvvASMiM/5b0abd4c0faa4f5eb190a9a16d5a1b4c/assets/x.png",
    );
    expect(r).toContain(
      "/api/game-embed/gd/rvvASMiM/5b0abd4c0faa4f5eb190a9a16d5a1b4c/other/1.png",
    );
  });
});

describe("GameDistribution embed lib — serveGdEmbed routes", () => {
  it("resolves a bare gameId entry to the inner route via 307", async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toBe(
        "https://html5.gamedistribution.com/5b0abd4c0faa4f5eb190a9a16d5a1b4c/index.html",
      );
      return new Response(OUTER_LOADER, {
        headers: { "content-type": "text/html" },
      });
    };
    const res = await serveGdEmbed(
      ["5b0abd4c0faa4f5eb190a9a16d5a1b4c"],
      new URLSearchParams(),
      fetchImpl,
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "/api/game-embed/gd/rvvASMiM/5b0abd4c0faa4f5eb190a9a16d5a1b4c/index.html",
    );
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("serves an inner game with ad scripts stripped and shim injected", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      return new Response(INNER_GAME, {
        headers: { "content-type": "text/html" },
      });
    };
    const res = await serveGdEmbed(
      ["rvvASMiM", "5b0abd4c0faa4f5eb190a9a16d5a1b4c", "index.html"],
      new URLSearchParams(),
      fetchImpl,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    // ad SDK scripts stripped (incl. the JS-injected main.min.js loader)
    expect(text).not.toContain("imasdk.googleapis.com");
    expect(text).not.toContain("api.gamedistribution.com");
    expect(text).not.toContain("gamedistribution-jssdk");
    // SDK shim injected
    expect(text).toContain("window.gdsdk");
    expect(text).toContain('fire("SDK_READY")');
    // CORS + framing
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    // the shim is injected before the first non-ad script
    const shimIdx = text.indexOf("window.gdsdk");
    const gameScriptIdx = text.indexOf("motox3m4.min.js");
    expect(shimIdx).toBeGreaterThan(-1);
    expect(gameScriptIdx).toBeGreaterThan(shimIdx);
    expect(seen[0]).toBe(
      "https://html5.gamedistribution.com/rvvASMiM/5b0abd4c0faa4f5eb190a9a16d5a1b4c/index.html",
    );
  });

  it("returns 422 when the outer loader has no inner ref", async () => {
    const fetchImpl = async () =>
      new Response("<html>no game</html>", {
        headers: { "content-type": "text/html" },
      });
    const res = await serveGdEmbed(
      ["11111111111111111111111111111111"],
      new URLSearchParams(),
      fetchImpl,
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 when the outer loader fetch is not OK", async () => {
    const fetchImpl = async () => new Response("nf", { status: 404 });
    const res = await serveGdEmbed(
      ["11111111111111111111111111111111"],
      new URLSearchParams(),
      fetchImpl,
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for unknown GD route shapes", async () => {
    const res = await serveGdEmbed(
      ["nonsense"],
      new URLSearchParams(),
      async () => new Response("x", { status: 200 }),
    );
    expect(res.status).toBe(400);
  });
});
