/**
 * GameDistribution (html5.gamedistribution.com) ad-free embed routing.
 *
 * Reverse-engineered 2026-09-15 (verified live in headless chromium):
 *
 *   https://html5.gamedistribution.com/<gameId>/index.html  (OUTER loader)
 *     — a small JS-only shell. It creates an iframe whose `src` is the REAL
 *       inner game at `//html5.gamedistribution.com/<prefix>/<gameId>/index.html`
 *       (prefix = per-publisher segment, e.g. `rvvASMiM`).
 *   https://html5.gamedistribution.com/<prefix>/<gameId>/index.html  (INNER game)
 *     — the actual game shell: canvas + `window["GD_OPTIONS"]` + two ad scripts:
 *       `https://imasdk.googleapis.com/js/sdkloader/ima3.js` (IMA) and
 *       `https://html5.api.gamedistribution.com/main.min.js` (GD SDK w/ ads).
 *
 * Both hosts are CORS-open (*) and send NO X-Frame-Options, so a same-origin
 * mirror can iframe them directly. The challenge is the NO-ADS requirement:
 * main.min.js is the GD SDK and it injects ad deliveries. We solve by serving
 * the INNER game through our mirror with:
 *   1. ima3.js + main.min.js <script> tags STRIPPED.
 *   2. a faithful ad-free SDK shim injected that mimics what main.min.js boots:
 *        - defines `window.gdsdk` (showAd/isAdShowing/gameplayStart/gameplayStop)
 *        - fires SDK_READY then SDK_GAME_START through the game's OWN
 *          GD_OPTIONS.onEvent + content events (the exact contract the game
 *          expects before it renders + resumes audio).
 *   3. absolute protocol-relative `//html5.gamedistribution.com/...` URLs in
 *      HTML/JS rewritten back to the mirror so the runtime stays same-origin.
 *
 * Verified: Moto X3M (id 5b0abd4c0faa4f5eb190a9a16d5a1b4c) boots a 854×480
 * canvas through the shim mirror with ZERO outbound/ad requests.
 *
 * Catalog note: gameflare.com/embed/<slug>/ exposes `data-src="https://
 * html5.gamedistribution.com/<gameId>/"` for GD-hosted games (moto-x3m worked).
 * GD itself has no public catalog search API (cloudfront 403), so the app
 * catalog is curated + per-id entry routing below.
 */

export const GD_HOST = "https://html5.gamedistribution.com";
export const GD_SDK_SCRIPT =
  "https://html5.api.gamedistribution.com/main.min.js";
export const GD_IMA_SCRIPT =
  "https://imasdk.googleapis.com/js/sdkloader/ima3.js";

export const GAME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface GdResolveResult {
  /** The inner-game prefix segment (e.g. rvvASMiM) — empty if unresolvable. */
  prefix: string;
  /** gameId. */
  gameId: string;
  /** Full inner URL. */
  innerUrl: string;
}

/**
 * Parse the OUTER loader HTML and return the inner-game reference it iframes.
 * The loader assigns `gameSrc = "//html5.gamedistribution.com/<prefix>/<id>/index.html..."`
 */
export function parseGdOuterLoader(html: string): {
  prefix?: string;
  innerPath?: string;
} {
  const m = html.match(
    /gameSrc\s*=\s*["']\/\/html5\.gamedistribution\.com\/([a-zA-Z0-9_-]+)\/([a-fA-F0-9]+)\/index\.html/,
  );
  if (m) return { prefix: m?.[1], innerPath: m?.[2] };
  const m2 = html.match(
    /["']\/\/html5\.gamedistribution\.com\/([a-zA-Z0-9_-]+)\/([a-fA-F0-9]+)\/index\.html/,
  );
  if (m2) return { prefix: m2?.[1], innerPath: m2?.[2] };
  return {};
}

/**
 * The SDK-shim script injected into the INNER game shell in place of
 * main.min.js. It must exist BEFORE the game code runs, expose the surface the
 * game/CreateJS build probes for (window.gdsdk) and drive boot via the game's
 * own GD_OPTIONS.onEvent just like the real SDK does.
 */
export function gdShimScript(): string {
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

/**
 * Rewrite absolute / protocol-relative GameDistribution asset URLs inside an
 * HTML/JS payload so every resource request routes BACK through our mirror
 * (origin-relative). Keeps everything same-origin (no cross-origin framing
 * issues, no hotlink/Referer concerns, no ad SDK reachable).
 *
 *   //html5.gamedistribution.com/<prefix>/<id>/<path>  → /api/game-embed/gd/<prefix>/<id>/<path>
 *   https://html5.gamedistribution.com/...             → (same, https stripped)
 */
export function rewriteGdUrls(body: string): string {
  const re =
    /(?:https?:)?\/\/html5\.gamedistribution\.com\/([a-zA-Z0-9_-]+)\/([a-fA-F0-9]+)\/([^"')\s]+)/g;
  return body.replace(
    re,
    (_m, prefix: string, id: string, path: string) =>
      `/api/game-embed/gd/${prefix}/${id}/${path}`,
  );
}

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

/** CORS headers applied to every mirror response (permissive read + GET). */
export const GD_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/**
 * Serve a GameDistribution mirror request.
 *
 * Route shapes handled (pathSegs AFTER /api/game-embed/gd):
 *   gd/<gameId>/index.html                 → resolve prefix (outer->inner), 307
 *   gd/<gameId>/                           → same resolution, 307 to inner
 *   gd/<prefix>/<gameId>/<path...>         → proxy inner-game asset directly
 *
 * The first form is the "clean" entry from the app catalog; the second is the
 * resolved inner route (requests the browser itself issues after rewrite).
 */
export async function serveGdEmbed(
  pathSegs: string[],
  searchParams: URLSearchParams,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const cors = { ...GD_CORS, "X-Frame-Options": "SAMEORIGIN" };

  // Resolve entry: gd/<gameId>/... → discover prefix → 307 to inner.
  if (pathSegs.length >= 1 && /^[a-fA-F0-9]{32}$/.test(pathSegs[0])) {
    const gameId = pathSegs[0];
    const isEntry =
      pathSegs.length === 1 ||
      (pathSegs.length === 2 &&
        (pathSegs[1] === "index.html" || pathSegs[1] === ""));
    if (isEntry) {
      let outer = "";
      try {
        const res = await fetchImpl(`${GD_HOST}/${gameId}/index.html`, {
          headers: { "User-Agent": GAME_UA, Accept: "text/html" },
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
      return new Response(
        JSON.stringify({
          status: "unresolvable",
          gameId,
          detail: "no inner game path found in outer loader",
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // Direct inner asset: gd/<prefix>/<gameId>/<path...>
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
      const up = await fetchImpl(upstream.toString(), {
        headers: {
          "User-Agent": GAME_UA,
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
        // Always rewrite absolute GD URLs back to the mirror FIRST.
        const rewritten = rewriteGdUrls(text);
        text = rewritten;

        if (
          ctype.includes("text/html") &&
          upstreamPath.endsWith("index.html")
        ) {
          // Strip ad SDK <script src> tags (IMA + GD SDK).
          text = text.replace(
            /<script[^>]*src=["'][^"']*imasdk\.googleapis\.com[^"']*["'][^>]*>\s*<\/script>/gi,
            "",
          );
          text = text.replace(
            /<script[^>]*src=["'][^"']*api\.gamedistribution\.com[^"']*["'][^>]*>\s*<\/script>/gi,
            "",
          );
          // Some GD builds don't use a <script src> — they create the SDK node
          // in JS (`js.src = '.../main.min.js'`). Neutralize the whole
          // gamedistribution-jssdk loader IIFE so main.min.js can NEVER load.
          // (Keeps GD_OPTIONS.onEvent intact — the game still uses it.)
          const sdkLoader = text.match(
            /\(\s*function\s*\(\s*d\s*,\s*s\s*,\s*id\s*\)[\s\S]{0,800}?gamedistribution-jssdk[\s\S]{0,60}?\)\s*\)?\s*;/i,
          );
          if (sdkLoader && sdkLoader.index !== undefined) {
            text =
              text.slice(0, sdkLoader.index) +
              "/* GD ad-SDK loader stripped — ad-free shim */" +
              text.slice(sdkLoader.index + sdkLoader[0].length);
          }
          // Inject the ad-free SDk shim before the first non-ad game script.
          text = text.replace(
            /<script(?![^>]*src=["'][^"']*(imasdk|api\.gamedistribution)[^"']*["'])[^>]*>/i,
            gdShimScript() + "\n$&",
          );
        }
        if (text !== new TextDecoder("utf-8").decode(buf)) {
          body = new TextEncoder().encode(text);
        }
      }

      const headers = new Headers();
      headers.set("Content-Type", ctype || "application/octet-stream");
      headers.set("Content-Length", String(body.byteLength));
      headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);

      return new Response(body as any, { status: up.status, headers });
    } catch (e) {
      return new Response(
        `gd-embed upstream error: ${String(e).slice(0, 120)}`,
        { status: 502 },
      );
    }
  }

  return new Response("Bad gd-embed request", { status: 400 });
}
