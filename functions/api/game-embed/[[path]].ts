/**
 * Game Embed Proxy — Cloudflare Pages Function
 *
 * Same purpose as /api/game-embed.ts (Vercel Edge): serves the raw, ad-free
 * CrazyGames game build THROUGH our own origin so the "VIDEO GAMES" tab can
 * iframe it — the "unblock embedding" piece for crazygames.com.
 *
 * WHY: games.crazygames.com/en_US/<slug>/index.html is iframe-OK but injects
 * ~70 Google/GPT ad requests at runtime (GameFrame wrapper) — hard NO-ADS
 * violation. The real game lives at <slug>.game-files.crazygames.com/... (HTML5)
 * or files.crazygames.com (Unity) and is AD-FREE (0 ad requests in a headless
 * browser), but hotlink-protects (403 without Referer) + sends
 * X-Frame-Options: SAMEORIGIN.
 *
 * Mirror routes (same origin as the app):
 *   /api/game-embed/<slug>/<build>/<file> → <slug>.game-files.crazygames.com/<slug>/<build>/<file>
 *   /api/game-embed/files/<path>          → files.crazygames.com/<path>
 *   /api/game-embed/raw?u=<url>           → pass-through for loose URLs
 *
 * NOTE: Cloudflare Pages Functions bundle each file independently (no
 * cross-file imports from api/_lib), so the mirror logic is inlined here. Keep
 * in sync with api/_lib/crazygames-embed.ts + api/game-embed.ts.
 */

interface Env {}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function rewriteCrazyUrls(body: string): string {
  const re = /https?:\/\/([a-z0-9-]+)\.game-files\.crazygames\.com\//g;
  let out = body.replace(
    re,
    (_m: string, slug: string) => `/api/game-embed/${slug}/`,
  );
  out = out.replace(
    /https?:\/\/files\.crazygames\.com\//g,
    "/api/game-embed/files/",
  );
  return out;
}

function needsRewrite(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/json")
  );
}

/* ========================================================================
 * GameDistribution (gameflare raw source) mirror — ad-free, SDK-shimmed.
 * Inlined here so Cloudflare Pages Functions stay self-contained (no
 * cross-file imports from api/_lib). Keep in sync with api/_lib/
 * gamedistribution-embed.ts.
 * ===================================================================== */

const GD_HOST = "https://html5.gamedistribution.com";

function parseGdOuterLoader(html: string): { prefix?: string } {
  const m = html.match(
    /gameSrc\s*=\s*["']\/\/html5\.gamedistribution\.com\/([a-zA-Z0-9_-]+)\/([a-fA-F0-9]+)\/index\.html/,
  );
  if (m) return { prefix: m[1] };
  const m2 = html.match(
    /["']\/\/html5\.gamedistribution\.com\/([a-zA-Z0-9_-]+)\/([a-fA-F0-9]+)\/index\.html/,
  );
  if (m2) return { prefix: m2[1] };
  return {};
}

function gdShimScript(): string {
  return `
<script type="text/javascript">
(function () {
  var hasFn = function (o, k) { return o && (typeof o[k] === "function"); };
  var opts = (window["GD_OPTIONS"] && hasFn(window["GD_OPTIONS"], "onEvent"))
    ? window["GD_OPTIONS"] : null;
  function fire(name) {
    if (opts) { try { opts.onEvent({ name: name, data: {} }); } catch (e) {} }
    var c = document.getElementById("content");
    if (c) { try { c.dispatchEvent(new Event(name)); } catch (e) {} }
    try { document.dispatchEvent(new Event(name)); } catch (e) {}
  }
  window.gdsdk = {
    _adFreeShim: true,
    showAd: function () { return Promise.resolve({}); },
    isAdShowing: function () { return false; },
    showRewardedAd: function () {
      return Promise.resolve({ reward: true, completed: true });
    },
    gameplayStart: function () {},
    gameplayStop: function () {},
    happyTime: function () {},
    preloadAd: function () {},
  };
  setTimeout(function () { fire("SDK_READY"); }, 40);
  setTimeout(function () { fire("SDK_GAME_START"); }, 250);
})();
</script>
`;
}

function rewriteGdUrls(body: string): string {
  const re =
    /(?:https?:)?\/\/html5\.gamedistribution\.com\/([a-zA-Z0-9_-]+)\/([a-fA-F0-9]+)\/([^"')\s]+)/g;
  return body.replace(
    re,
    (_m, prefix: string, id: string, path: string) =>
      `/api/game-embed/gd/${prefix}/${id}/${path}`,
  );
}

async function serveGdEmbed(
  pathSegs: string[],
  searchParams: URLSearchParams,
): Promise<Response> {
  const cors: Record<string, string> = {
    ...CORS,
    "X-Frame-Options": "SAMEORIGIN",
  };

  if (pathSegs.length >= 1 && /^[a-fA-F0-9]{32}$/.test(pathSegs[0])) {
    const gameId = pathSegs[0];
    const isEntry =
      pathSegs.length === 1 ||
      (pathSegs.length === 2 &&
        (pathSegs[1] === "index.html" || pathSegs[1] === ""));
    if (isEntry) {
      let outer = "";
      try {
        const res = await fetch(`${GD_HOST}/${gameId}/index.html`, {
          headers: { "User-Agent": UA, Accept: "text/html" },
          redirect: "follow",
        });
        if (!res.ok) {
          return new Response(
            JSON.stringify({ error: "gd game not found", gameId }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
        }
        outer = await res.text();
      } catch (e) {
        return new Response(
          JSON.stringify({ error: String(e).slice(0, 120), gameId }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
      const { prefix } = parseGdOuterLoader(outer);
      if (prefix) {
        return new Response(null, {
          status: 307,
          headers: {
            Location: `/api/game-embed/gd/${prefix}/${gameId}/index.html`,
            "Cache-Control": "no-store",
            ...cors,
          },
        });
      }
      return new Response(JSON.stringify({ status: "unresolvable", gameId }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (
    pathSegs.length >= 3 &&
    /^[a-zA-Z0-9_-]+$/.test(pathSegs[0]) &&
    /^[a-fA-F0-9]{32}$/.test(pathSegs[1])
  ) {
    const [prefix, gameId, ...rest] = pathSegs;
    const upstreamPath = `/${prefix}/${gameId}/${rest.join("/")}`;
    const upstream = new URL(`${GD_HOST}${upstreamPath}`);
    const usp = new URLSearchParams();
    for (const k of Array.from(searchParams.keys()))
      if (k !== "u") usp.set(k, searchParams.get(k) || "");
    upstream.search = usp.toString();

    try {
      const up = await fetch(upstream.toString(), {
        headers: {
          "User-Agent": UA,
          Accept: upstreamPath.endsWith("index.html")
            ? "text/html,application/xhtml+xml"
            : "*/*",
          "Accept-Encoding": "identity",
        },
        redirect: "follow",
      });
      const ctype = up.headers.get("content-type") || "";
      const buf = new Uint8Array(await up.arrayBuffer());
      let body: Uint8Array = buf;

      if (needsRewrite(ctype)) {
        let text = new TextDecoder("utf-8").decode(buf);
        text = rewriteGdUrls(text);
        if (
          ctype.includes("text/html") &&
          upstreamPath.endsWith("index.html")
        ) {
          text = text.replace(
            /<script[^>]*src=["'][^"']*imasdk\.googleapis\.com[^"']*["'][^>]*>\s*<\/script>/gi,
            "",
          );
          text = text.replace(
            /<script[^>]*src=["'][^"']*api\.gamedistribution\.com[^"']*["'][^>]*>\s*<\/script>/gi,
            "",
          );
          // Some GD builds don't use a <script src> — they create the SDK node
          // in JS (`js.src = '.../main.min.js'`). Neutralize the loader IIFE so
          // main.min.js can NEVER load. (Keeps GD_OPTIONS.onEvent intact.)
          const sdkLoaderMatch = text.match(
            /\(\s*function\s*\(\s*d\s*,\s*s\s*,\s*id\s*\)[\s\S]{0,800}?gamedistribution-jssdk[\s\S]{0,60}?\)\s*\)?\s*;/i,
          );
          if (sdkLoaderMatch && sdkLoaderMatch.index !== undefined) {
            text =
              text.slice(0, sdkLoaderMatch.index) +
              "/* GD ad-SDK loader stripped — ad-free shim */" +
              text.slice(sdkLoaderMatch.index + sdkLoaderMatch[0].length);
          }
          text = text.replace(
            /<script(?![^>]*src=["'][^"']*(imasdk|api\.gamedistribution)[^"']*["'])[^>]*>/i,
            gdShimScript() + "\n$&",
          );
        }
        const orig = new TextDecoder("utf-8").decode(buf);
        if (text !== orig) body = new TextEncoder().encode(text);
      }

      const headers = new Headers();
      headers.set("Content-Type", ctype || "application/octet-stream");
      headers.set("Content-Length", String(body.byteLength));
      headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);

      return new Response(body, { status: up.status, headers });
    } catch (e) {
      return new Response(
        `gd-embed upstream error: ${String(e).slice(0, 120)}`,
        {
          status: 502,
        },
      );
    }
  }

  return new Response("Bad gd-embed request", { status: 400 });
}

async function serveGameEmbed(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // [api, game-embed, key, ...]
  const afterApi = parts.slice(2); // drop "api", "game-embed"

  // GameDistribution (gameflare raw source) mirror
  if (afterApi[0] === "gd") {
    return serveGdEmbed(afterApi.slice(1), url.searchParams);
  }

  // ENTRY endpoint: /api/game-embed/<slug> — fetch loader, resolve ad-free
  // game-files build, 307-redirect iframe to the full mirror path. Keeps the
  // catalog lightweight (no per-game fetch at catalog build time).
  if (afterApi.length === 1 && /^[a-z0-9-]+$/.test(afterApi[0])) {
    const slug = afterApi[0];
    let shell = "";
    try {
      const loaderRes = await fetch(
        `https://games.crazygames.com/en_US/${encodeURIComponent(slug)}/index.html`,
        {
          headers: { "User-Agent": UA, Accept: "text/html" },
          redirect: "follow",
        },
      );
      if (!loaderRes.ok) {
        return new Response(JSON.stringify({ error: "game not found", slug }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      shell = await loaderRes.text();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: String(e).slice(0, 120), slug }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const loaderKind = shell.match(/"loader":\s*"([a-z0-9]+)"/)?.[1];
    const gameName = shell.match(/"gameName":\s*"([^"]*)"/)?.[1];
    let entryPath = "";
    if (loaderKind === "html5") {
      const url = shell.match(
        /"loaderOptions":\s*\{\s*"url":\s*"([^"]+)"/,
      )?.[1];
      if (url) {
        const m = url.match(
          /^https:\/\/([^.]+)\.game-files\.crazygames\.com\/([^/]+)\/(\d+)\/([^/]+)$/,
        );
        if (m) {
          const s = m[1];
          if (s === m[2]) {
            entryPath = `/api/game-embed/${s}/${s}/${m[3]}/${m[4]}`;
          }
        }
        if (!entryPath)
          entryPath = `/api/game-embed/raw?u=${encodeURIComponent(url)}`;
      }
    } else if (loaderKind === "unity" || loaderKind === "unity6") {
      const loaderUrl = shell.match(/"unityLoaderUrl":\s*"([^"]+)"/)?.[1];
      if (loaderUrl) {
        const u = new URL(loaderUrl);
        if (u.hostname === "files.crazygames.com") {
          entryPath = `/api/game-embed/files${u.pathname}${u.search}`;
        } else {
          entryPath = `/api/game-embed/raw?u=${encodeURIComponent(loaderUrl)}`;
        }
      }
    }
    if (entryPath) {
      return new Response(null, {
        status: 307,
        headers: {
          Location: entryPath,
          "Cache-Control": "no-store",
          // Same-origin framing is allowed; must override any platform default
          // (e.g. Vercel-style X-Frame-Options: DENY) on the redirect itself.
          "X-Frame-Options": "SAMEORIGIN",
        },
      });
    }
    return new Response(
      JSON.stringify({
        status: "ad-free-unavailable",
        slug,
        name: gameName || slug,
        externalUrl: `https://www.crazygames.com/game/${slug}`,
      }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  let upstream: URL | null = null;
  if (afterApi[0] === "raw") {
    const u = url.searchParams.get("u");
    if (u) {
      try {
        const parsed = new URL(u);
        if (
          parsed.hostname.endsWith(".game-files.crazygames.com") ||
          parsed.hostname === "files.crazygames.com"
        ) {
          upstream = parsed;
        }
      } catch {
        upstream = null;
      }
    }
  } else if (afterApi[0] === "files") {
    upstream = new URL(
      `https://files.crazygames.com/${afterApi.slice(1).join("/")}`,
    );
  } else if (afterApi.length >= 1 && /^[a-z0-9-]+$/.test(afterApi[0])) {
    const slug = afterApi[0];
    // Mirror path = hostKey + FULL upstream path (slug is the first path
    // segment of HTML5 game-files URLs): /api/game-embed/{slug}/{slug}/{build}/…
    //   → https://{slug}.game-files.crazygames.com/{slug}/{build}/…
    const rest = afterApi.slice(1);
    upstream = new URL(
      `https://${slug}.game-files.crazygames.com/${rest.join("/")}`,
    );
  }

  if (!upstream) {
    return new Response("Bad game-embed request", { status: 400 });
  }

  const usp = new URLSearchParams();
  for (const k of Array.from(url.searchParams.keys())) {
    if (k !== "u") usp.set(k, url.searchParams.get(k) || "");
  }
  upstream.search = usp.toString();

  try {
    const up = await fetch(upstream.toString(), {
      headers: {
        Referer: "https://games.crazygames.com/",
        "User-Agent": UA,
        Accept: upstream.pathname.endsWith("index.html")
          ? "text/html,application/xhtml+xml"
          : "*/*",
        "Accept-Encoding": "identity",
      },
      redirect: "follow",
    });

    const ctype = up.headers.get("content-type") || "";
    const buf = new Uint8Array(await up.arrayBuffer());

    let body: Uint8Array = buf;
    if (needsRewrite(ctype)) {
      const text = new TextDecoder("utf-8").decode(buf);
      const rewritten = rewriteCrazyUrls(text);
      if (rewritten !== text) body = new TextEncoder().encode(rewritten);
    }

    return new Response(body, {
      status: up.status,
      headers: {
        "Content-Type": ctype || "application/octet-stream",
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        ...CORS,
      },
    });
  } catch (e) {
    return new Response(
      `game-embed upstream error: ${String(e).slice(0, 120)}`,
      {
        status: 502,
      },
    );
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) =>
  serveGameEmbed(context.request);

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS });
