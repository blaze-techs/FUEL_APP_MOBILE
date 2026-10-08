/**
 * Game mirror registry — "make every game play IN the tab".
 *
 * Some providers refuse to be framed (Content-Security-Policy
 * `frame-ancestors` allowlist, or `X-Frame-Options: DENY`) even though the
 * game itself is free and ad-free. The player then fell back to "open in a new
 * tab", which is exactly the redirect the task forbids.
 *
 * Fix: re-serve the game from OUR OWN origin under `/api/game-mirror/<key>/…`
 * so a same-origin iframe is permitted (frame-ancestors 'self'). This
 * registry is the single source of truth shared by the Node (Vercel) handler
 * and the Cloudflare Pages Function (which inlines a copy — CF bundles each
 * function independently).
 *
 * `entry`        path appended to rootOrigin for the key-only request
 * `preservePath` true  -> the requested sub-path is appended to the origin
 *                        (per-app root, e.g. /apps/minecraft/app)
 *                false -> the sub-path is appended to `entry` (used by the
 *                        per-host chunk entries where `entry` is the app root)
 * `stripQuery`   query params to drop before proxying (cache-bust helpers)
 */

export interface GameMirrorConfig {
  /** Host origin the game is served from, e.g. https://parkbaron.com */
  origin: string;
  /** Extra origins rewritten to the mirror (CDNs the app loads from). */
  assetOrigins?: string[];
  /** Path used when the request is just the key (the app root). */
  entry: string;
  /**
   * true  — sub-path appended to `origin` (per-app root that also serves assets)
   * false — sub-path appended to `entry` (host root + fixed app entry)
   */
  preservePath: boolean;
  /** Query keys to strip from the upstream request. */
  stripQuery?: string[];
}

/**
 * Keyed by `/api/game-mirror/<key>`. Keys must match `/^[a-z0-9-]+$/`.
 * All origins verified frame-blocking (frame-ancestors / XFO) so the mirror
 * is the only way to keep them inside the tab.
 */
export const GAME_MIRROR: Record<string, GameMirrorConfig> = {
  parkbaron: {
    origin: "https://parkbaron.com",
    entry: "/play",
    // Vite SPA: the entry lives at /play but assets are root-relative (/assets/…).
    preservePath: true,
    stripQuery: ["cb"],
  },
  nacht: {
    origin: "https://zombies.bitcoinsapi.com",
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
  },
  // quenq app builds (WASM/emulator). Static host serves both the entry and
  // its assets under the same path, so the sub-path is preserved verbatim.
  "quenq-static": {
    origin: "https://static.quenq.com",
    assetOrigins: ["https://quenq.com"],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
  },
  // Apps whose raw build is only served from the main host (the static host
  // 404s them). Same layout: path preserved, assets at /apps/<slug>/.
  quenq: {
    origin: "https://quenq.com",
    assetOrigins: ["https://static.quenq.com"],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
  },
  // GTA III / Vice City web ports and the Reborn XP OS simulator (app roots).
  iii: {
    origin: "https://iii.quenq.com",
    assetOrigins: ["https://quenq.com", "https://static.quenq.com"],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
  },
  vc: {
    origin: "https://vc.quenq.com",
    assetOrigins: ["https://quenq.com", "https://static.quenq.com"],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
  },
  xp: {
    origin: "https://xp.quenq.com",
    assetOrigins: ["https://quenq.com", "https://static.quenq.com"],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
  },
};

/** True when `key` is a registered mirror. */
export function isKnownMirrorKey(key: string): boolean {
  return /^[a-z0-9-]+$/.test(key) && key in GAME_MIRROR;
}

/**
 * Build the upstream URL for a mirror request.
 * `sub` is the path after `/api/game-mirror/<key>/` (may be empty).
 * - empty sub  -> the app entry page (`entry`)
 * - with sub   -> `preservePath` ? origin + "/" + sub  (assets are root-relative)
 *                               : entry + "/" + sub     (assets sit under the entry)
 */
export function mirrorUpstream(
  key: string,
  sub: string,
  search: string,
): URL | null {
  const cfg = GAME_MIRROR[key];
  if (!cfg) return null;
  const cleanSub = sub.replace(/^\/+/, "");
  let target: string;
  if (!cleanSub) {
    target = cfg.entry;
  } else if (cfg.preservePath) {
    target = "/" + cleanSub;
  } else {
    target = cfg.entry.replace(/\/+$/, "") + "/" + cleanSub;
  }
  const usp = new URLSearchParams(search);
  for (const k of cfg.stripQuery ?? []) usp.delete(k);
  const base = new URL(target, cfg.origin);
  base.search = usp.toString();
  return base;
}
