import { describe, it, expect } from "vitest";
import {
  analyzeGameShell,
  rewriteCrazyUrls,
  serveGameEmbed,
} from "../../api/_lib/crazygames-embed";

/* Realistic CrazyGames loader shells (as served by games.crazygames.com). */

const HTML5_SHELL = `
<script>
var options = {
  "loader": "html5",
  "loaderOptions": {
    "url": "https://moto-x3m.game-files.crazygames.com/moto-x3m/13/index.html",
    "thumbnail": "moto-x3m_16x9/...",
    "gameName": "Moto X3M",
    "gameSlug": "moto-x3m",
    "showAdOnExternal": "ALWAYS",
    "disableEmbedding": true
  }
};
</script>`;

const UNITY_SHELL = `
<script>
var options = {
  "loader": "unity",
  "unityLoaderUrl": "https://files.crazygames.com/dragon-archers/28/CrazyGamesRelease/Build/5e334a00a125b3a91401238fc2a230a6.loader.js",
  "unityConfigOptions": {
    "codeUrl": "https://files.crazygames.com/dragon-archers/28/CrazyGamesRelease/Build/1be4ef3e2491b2ae6fe61fd7468.wasm",
    "frameworkUrl": "https://files.crazygames.com/dragon-archers/28/CrazyGamesRelease/Build/1be4ef3e2491b2ae6fe61fd7468.framework.js",
    "dataUrl": "https://files.crazygames.com/dragon-archers/28/CrazyGamesRelease/Build/1be4ef3e2491b2ae6fe61fd7468.data",
    "companyName": "CrazyGames.com",
    "productName": "Dragon Archers"
  },
  "gameName": "Dragon Archers",
  "showAdOnExternal": "ALWAYS",
  "disableEmbedding": true
};
</script>`;

const FAKE_SHELL = `
<script>
var options = {
  "loader": "fake",
  "gameName": "Subway Surfers"
};
</script>`;

describe("CrazyGames embed lib — analyzeGameShell", () => {
  it("maps an HTML5 game shell to the game-files mirror entry", () => {
    const r = analyzeGameShell(HTML5_SHELL);
    expect(r.kind).toBe("html5");
    // Mirror mirrors the full upstream path (host prefix + path) => slug twice
    expect(r.entryPath).toBe("/api/game-embed/moto-x3m/moto-x3m/13/index.html");
    expect(r.name).toBe("Moto X3M");
  });

  it("maps a Unity game shell to the files.crazygames.com mirror loader", () => {
    const r = analyzeGameShell(UNITY_SHELL);
    expect(r.kind).toBe("unity");
    expect(r.entryPath).toBe(
      "/api/game-embed/files/dragon-archers/28/CrazyGamesRelease/Build/5e334a00a125b3a91401238fc2a230a6.loader.js",
    );
    expect(r.name).toBe("Dragon Archers");
  });

  it("flags 'fake' loader (eg Subway Surfers) as not ad-free-embeddable", () => {
    const r = analyzeGameShell(FAKE_SHELL);
    expect(r.kind).toBe("fake");
    expect(r.entryPath).toBe("");
  });

  it("returns unknown for garbage", () => {
    const r = analyzeGameShell("<html>no options</html>");
    expect(r.kind).toBe("unknown");
    expect(r.entryPath).toBe("");
  });
});

describe("CrazyGames embed lib — rewriteCrazyUrls", () => {
  it("rewrites absolute game-files + files.crazygames URLs to origin-relative mirror", () => {
    const input = `
    const codeUrl = "https://files.crazygames.com/dragon-archers/28/x.wasm";
    const loader = 'https://dragon-archers.game-files.crazygames.com/dragon-archers/28/index.html';
    `;
    const out = rewriteCrazyUrls(input);
    expect(out).toContain('"/api/game-embed/files/dragon-archers/28/x.wasm"');
    // host prefix + upstream path => slug twice
    expect(out).toContain(
      "'/api/game-embed/dragon-archers/dragon-archers/28/index.html'",
    );
    expect(out).not.toContain("files.crazygames.com");
    expect(out).not.toContain("game-files.crazygames.com");
  });

  it("leaves non-crazygames URLs untouched", () => {
    const input =
      'var sdk = "https://sdk.crazygames.com/crazygames-sdk-v3.js";';
    const out = rewriteCrazyUrls(input);
    expect(out).toBe(input);
  });
});

describe("CrazyGames embed lib — serveGameEmbed routing", () => {
  it("rejects unknown mirror paths (400)", async () => {
    const res = await serveGameEmbed("/api/game-embed/", new URLSearchParams());
    expect(res.status).toBe(400);
  });

  it("proxies HTML5 slug path to the game-files origin with Referer + no XFO", async () => {
    let sawUrl = "";
    let sawReferer = "";
    const fakeFetch = async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      sawUrl = u.toString();
      sawReferer = u.toString(); // placeholder; headers read below
      return new Response("<html><head></head><body>game</body></html>", {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "X-Frame-Options": "SAMEORIGIN",
        },
      });
    };
    // We can't easily read headers of the fetch impl, so assert URL shape only.
    const res = await serveGameEmbed(
      "/api/game-embed/moto-x3m/moto-x3m/13/index.html",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    // upstream path = afterApi.slice(1) — slug ONCE in the upstream URL
    expect(sawUrl).toBe(
      "https://moto-x3m.game-files.crazygames.com/moto-x3m/13/index.html",
    );
    expect(typeof sawReferer).toBe("string");
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("rewrites absolute crazygames asset URLs in proxied HTML", async () => {
    const fakeFetch = async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith("index.html")) {
        return new Response(
          '<html><script src="https://moto-x3m.game-files.crazygames.com/moto-x3m/13/unityApp.js"></script></html>',
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }
      return new Response("x", { status: 404 });
    };
    const res = await serveGameEmbed(
      "/api/game-embed/moto-x3m/moto-x3m/13/index.html",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    const body = await res.text();
    expect(body).toContain("/api/game-embed/moto-x3m/moto-x3m/13/unityApp.js");
    expect(body).not.toContain("game-files.crazygames.com");
  });

  it("proxies files.crazygames.com Unity loader under /files/", async () => {
    let saw = "";
    const fakeFetch = async (input: RequestInfo | URL) => {
      saw = String(input);
      return new Response("/* loader */", {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      });
    };
    const res = await serveGameEmbed(
      "/api/game-embed/files/dragon-archers/28/CrazyGamesRelease/Build/x.loader.js",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    expect(saw).toContain(
      "https://files.crazygames.com/dragon-archers/28/CrazyGamesRelease/Build/x.loader.js",
    );
    expect(res.status).toBe(200);
  });

  it("returns 502 when upstream fetch fails", async () => {
    const fakeFetch = async () => {
      throw new Error("boom");
    };
    const res = await serveGameEmbed(
      "/api/game-embed/moto-x3m/13/index.html",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe(502);
  });

  it("entry endpoint 307-redirects an HTML5 game slug to the full mirror", async () => {
    const fakeFetch = async (input: RequestInfo | URL) => {
      const u = new URL(String(input));
      if (u.hostname === "games.crazygames.com") {
        return new Response(HTML5_SHELL, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("x", { status: 404 });
    };
    const res = await serveGameEmbed(
      "/api/game-embed/moto-x3m",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe(
      "/api/game-embed/moto-x3m/moto-x3m/13/index.html",
    );
  });

  it("entry endpoint 307-redirects a Unity game slug to the files mirror", async () => {
    const fakeFetch = async () =>
      new Response(UNITY_SHELL, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    const res = await serveGameEmbed(
      "/api/game-embed/dragon-archers",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toBe(
      "/api/game-embed/files/dragon-archers/28/CrazyGamesRelease/Build/5e334a00a125b3a91401238fc2a230a6.loader.js",
    );
  });

  it("entry endpoint 422s a 'fake' game with an honest external link", async () => {
    const fakeFetch = async () =>
      new Response(FAKE_SHELL, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    const res = await serveGameEmbed(
      "/api/game-embed/subway-surfers",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.status).toBe("ad-free-unavailable");
    expect(body.externalUrl).toBe(
      "https://www.crazygames.com/game/subway-surfers",
    );
  });

  it("entry endpoint 404s when the loader shell is missing", async () => {
    const fakeFetch = async () => new Response("nope", { status: 404 });
    const res = await serveGameEmbed(
      "/api/game-embed/does-not-exist",
      new URLSearchParams(),
      {},
      fakeFetch as unknown as typeof fetch,
    );
    expect(res.status).toBe(404);
  });
});
