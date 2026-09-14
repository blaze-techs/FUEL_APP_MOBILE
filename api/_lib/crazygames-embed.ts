/**
 * CrazyGames ad-free embed routing — shared by the Vercel route
 * (/api/game-embed) and the Cloudflare Pages function
 * (functions/api/game-embed). Dependency-free so vitest can import it.
 *
 * Reverse-engineered 2026-09-15 (verified live in a headless browser):
 *   games.crazygames.com/en_US/<slug>/index.html is IFRAME-OK (no XFO) but
 *   INJECTS 70+ Google/GPT ad requests at runtime via its GameFrame wrapper —
 *   a hard NO-ADS violation. The REAL game build lives at:
 *     https://<slug>.game-files.crazygames.com/<slug>/<build>/index.html   (HTML5)
 *     https://files.crazygames.com/<slug>/<build>/...                      (Unity)
 *   The raw game build is AD-FREE (0 ad requests observed) but is
 *   hotlink-protected: it 403s unless the request carries a Referer from
 *   games.crazygames.com, and it sends X-Frame-Options: SAMEORIGIN so it can't
 *   be iframed directly.
 *
 * So we serve a MIRROR at our own origin:
 *     /api/game-embed/<slug>/<rest...>
 *   → proxy to https://<slug>.game-files.crazygames.com/<slug>/<rest...>
 *     and /api/game-embed/files/<rest...> → https://files.crazygames.com/<rest...>
 *   adding the Referer, stripping X-Frame-Options, adding CORS, and rewriting
 *   absolute https://*.crazygames.com<script / stylesheet href refs> back to
 *   the mirror so Unity's config object (absolute URLs) stays on the proxy.
 *
 * This yields a genuinely ad-free, iframe-able CrazyGames game. Verified for
 * war-the-knights, moto-x3m, 8-ball-billiards-classic (HTML5) and
 * dragon-archers (Unity6) — all 0 ad requests + canvas renders in-iframe.
 */

export const CRAZYGAMES_GAMES = "https://games.crazygames.com/en_US";
export const CRAZYGAMES_RAW_HTML5 = "https://game-files.crazygames.com";
export const CRAZYGAMES_RAW_UNITY = "https://files.crazygames.com";

export const GAME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Reasonable byte cap for proxied game assets (256 MB). */
export const MAX_PROXY_BYTES = 256 * 1024 * 1024;

export interface AnalyzeGameResult {
  /** Type of game found in the loader shell. */
  kind: "html5" | "unity" | "fake" | "unknown";
  /** Mirrored entry URL (relative to our origin root, e.g. /api/game-embed/...). */
  entryPath: string;
  /** Scraped game title. */
  name?: string;
}

/**
 * Parse a CrazyGames loader shell (games.crazygames.com/en_US/<slug>/index.html)
 * and derive the mirror entry path for its raw, ad-free game build.
 *
 * HTML5: loaderOptions.url = https://<slug>.game-files.crazygames.com/<slug>/<b>/index.html
 *        → mirror /api/game-embed/<slug>/<b>/index.html
 * Unity: unityLoaderUrl = https://files.crazygames.com/<slug>/<b>/...loader.js
 *        → mirror /api/game-embed/files/<slug>/<b>/...loader.js
 * fake:  no game-files URL (eg Subway Surfers) — cannot embed ad-free.
 */
export function analyzeGameShell(html: string): AnalyzeGameResult {
  const loader = html.match(/"loader":\s*"([a-z0-9]+)"/);
  const kind0 = loader ? loader[1] : "unknown";

  const gameName = html.match(/"gameName":\s*"([^"]*)"/)?.[1];

  if (kind0 === "html5") {
    const url = html.match(/"loaderOptions":\s*\{\s*"url":\s*"([^"]+)"/)?.[1];
    if (url) {
      const u = new URL(url);
      // https://<slug>.game-files.crazygames.com/<slug>/<build>/index.html
      const m = u.hostname.match(/^([^.]+)\.game-files\.crazygames\.com$/);
      const hmm = u.pathname.match(/^\/([^/]+)\/(\d+)\/([^/]+)$/);
      const title = gameName || hmm?.[1] || "";
      if (m && hmm) {
        const slug = m[1];
        const build = hmm[2];
        const file = hmm[3];
        if (slug === hmm[1]) {
          // Mirror path mirrors the FULL upstream path (host prefix + path),
          // so the slug appears twice: /api/game-embed/{slug}/{slug}/{build}/…
          return {
            kind: "html5",
            entryPath: `/api/game-embed/${slug}/${slug}/${build}/${file}`,
            name: title,
          };
        }
      }
      // Fallback: encode the full raw URL as query
      return {
        kind: "html5",
        entryPath: `/api/game-embed/raw?u=${encodeURIComponent(url)}`,
        name: title,
      };
    }
  }

  if (kind0 === "unity" || kind0 === "unity6") {
    const loaderUrl = html.match(/"unityLoaderUrl":\s*"([^"]+)"/)?.[1];
    if (loaderUrl) {
      const u = new URL(loaderUrl);
      // https://files.crazygames.com/<slug>/<build>/...loader.js
      const m = u.pathname.match(/^\/([^/]+)\/(\d+)\/(.*loader\.js)$/);
      const slug = m ? m[1] : "";
      if (m) {
        return {
          kind: "unity",
          entryPath: `/api/game-embed/files${u.pathname}${u.search}`,
          name: gameName || slug,
        };
      }
      return {
        kind: "unity",
        entryPath: `/api/game-embed/raw?u=${encodeURIComponent(loaderUrl)}`,
        name: gameName,
      };
    }
  }

  return {
    kind: kind0 === "fake" ? "fake" : "unknown",
    entryPath: "",
    name: gameName,
  };
}

/** HTML/JS/CSS responses need absolute *.crazygames.com URL rewriting to the mirror. */
export function needsRewrite(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/x-javascript") ||
    contentType.includes("application/json")
  );
}

/**
 * Rewrite absolute CrazyGames asset URLs inside an HTML/JS/CSS payload so they
 * route BACK through our mirror (origin-relative) — the browser can't reach the
 * raw origin without the Referer we add, and we want everything same-origin.
 *
 * https://<slug>.game-files.crazygames.com/<path> → /api/game-embed/<slug>/<path>
 * https://files.crazygames.com/<path>             → /api/game-embed/files/<path>
 */
export function rewriteCrazyUrls(body: string): string {
  const re = /https?:\/\/([a-z0-9-]+)\.game-files\.crazygames\.com\//g;
  let out = body.replace(re, (_m, slug) => `/api/game-embed/${slug}/`);
  const files = /https?:\/\/files\.crazygames\.com\//g;
  out = out.replace(files, "/api/game-embed/files/");
  return out;
}

/**
 * Serve a game-embed mirror request (/api/game-embed/<slug>/<rest> or
 * /api/game-embed/files/<rest> or /api/game-embed/raw?u=...).
 * Returns a Response with no XFO + permissive CORS.
 */
export async function serveGameEmbed(
  pathname: string,
  searchParams: URLSearchParams,
  _env: unknown = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  // pathname looks like /api/game-embed/<hostKey>/<rest...> (hostKey = slug,
  // "files", or "raw"). Robustly drop the leading "api" + "game-embed" segments.
  const parts = pathname.split("/").filter(Boolean);
  let i = 0;
  if (parts[i] === "api") i++;
  if (parts[i] === "game-embed") i++;
  const afterApi = parts.slice(i);

  // ENTRY endpoint: /api/game-embed/<slug> (no build/file). Fetch the game's
  // loader shell (games.crazygames.com) server-side, resolve the raw ad-free
  // game build, and 307-redirect the iframe to the full mirror path. This keeps
  // the catalog lightweight (no per-game fetch at catalog build time).
  if (afterApi.length === 1 && /^[a-z0-9-]+$/.test(afterApi[0])) {
    const slug = afterApi[0];
    const loaderRes = await fetchImpl(
      `${CRAZYGAMES_GAMES}/${encodeURIComponent(slug)}/index.html`,
      {
        headers: {
          "User-Agent": GAME_UA,
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      },
    );
    if (!loaderRes.ok) {
      return new Response(JSON.stringify({ error: "game not found", slug }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const shell = await loaderRes.text();
    const result = analyzeGameShell(shell);
    if (result.kind === "html5" || result.kind === "unity") {
      return new Response(null, {
        status: 307,
        headers: {
          Location: result.entryPath,
          "Cache-Control": "no-store",
        },
      });
    }
    // "fake" / unknown: no ad-free game-files build — hand the player an honest
    // external link (opening CrazyGames' own site, where the game lives).
    return new Response(
      JSON.stringify({
        status: "ad-free-unavailable",
        slug,
        name: result.name || slug,
        externalUrl: `https://www.crazygames.com/game/${slug}`,
      }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  let upstream: URL | null = null;
  if (afterApi[0] === "raw") {
    const u = searchParams.get("u");
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
      `${CRAZYGAMES_RAW_UNITY}/${afterApi.slice(1).join("/")}`,
    );
  } else if (afterApi.length >= 1 && /^[a-z0-9-]+$/.test(afterApi[0])) {
    const slug = afterApi[0];
    // Mirror path = hostKey + FULL upstream path. The HTML5 game-files URLs
    // already contain the slug as the first path segment, so afterApi =
    // [hostKey, slug, build, file, ...] and the upstream path is afterApi.slice(1).
    const rest = afterApi.slice(1);
    upstream = new URL(
      `https://${slug}.game-files.crazygames.com/${rest.join("/")}`,
    );
  }

  if (!upstream) {
    return new Response("Bad game-embed request", { status: 400 });
  }

  const usp = new URLSearchParams();
  for (const k of Array.from(searchParams.keys()))
    if (k !== "u") usp.set(k, searchParams.get(k) || "");
  upstream.search = usp.toString();

  try {
    const up = await fetchImpl(upstream.toString(), {
      headers: {
        Referer: "https://games.crazygames.com/",
        "User-Agent": GAME_UA,
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
    const isText = needsRewrite(ctype);
    if (isText) {
      // Rewrite absolute crazygames URLs to our mirror (origin-relative)
      const text = new TextDecoder("utf-8").decode(buf);
      const rewritten = rewriteCrazyUrls(text);
      if (rewritten !== text) {
        body = new TextEncoder().encode(rewritten);
      }
    }

    const headers = new Headers();
    headers.set("Content-Type", ctype || "application/octet-stream");
    headers.set("Content-Length", String(body.byteLength));
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    // Strip any upstream XFO/CSP so the game can be iframed on our site.
    headers.set("X-Frame-Options", "");
    // NOTE: do not copy upstream Content-Security-Policy.

    return new Response(body, { status: up.status, headers });
  } catch {
    return new Response("game-embed upstream error", { status: 502 });
  }
}
