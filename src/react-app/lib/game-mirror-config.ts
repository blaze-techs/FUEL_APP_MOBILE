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
  /**
   * Extra origins rewritten to the mirror (CDNs the app loads from).
   * Each entry may be a bare origin, or `{ origin, key }` when that host needs
   * its OWN mirror path (the generic handler resolves one upstream origin per
   * key, so a second host must be mirrored under a second key).
   */
  assetOrigins?: Array<string | { origin: string; key: string }>;
  /** Path used when the request is just the key (the app root). */
  entry: string;
  /**
   * true  — sub-path appended to `origin` (per-app root that also serves assets)
   * false — sub-path appended to `entry` (host root + fixed app entry)
   */
  preservePath: boolean;
  /** Query keys to strip from the upstream request. */
  stripQuery?: string[];
  /**
   * How aggressively to rewrite text bodies.
   *  - "full"      (default) rewrite absolute hosts + root-relative asset
   *                refs and inject a <base>. Needed by Vite SPAs (quenq,
   *                parkbaron) whose assets are root-absolute.
   *  - "host-only" rewrite ONLY absolute game/CDN host URLs. Complex game
   *                engines (Krunker, ev.io, Zombs…) compute their asset +
   *                WebSocket URLs from `location`, so root-relative rewriting
   *                or a <base> tag breaks them. Host-only leaves their
   *                path logic intact.
   */
  rewriteMode?: "full" | "host-only";
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
    assetOrigins: [
      { origin: "https://quenq.com", key: "quenq" },
      { origin: "https://static.quenq.com", key: "quenq-static" },
    ],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
  },
  // ── AAA-class browser shooters / battle-royale (free, no sign-in) ─────────
  // These origins send no XFO/frame-ancestors, but the app shell is COEP, so a
  // plain cross-origin frame is blocked (corp-not-same-origin…). Mirroring
  // them same-origin (this route already sets COEP+CORP) is what keeps them
  // IN the tab. Gameplay WebSockets connect cross-origin (not CORP-gated),
  // and cross-origin ad resources are dropped by COEP — so the mirror is also
  // effectively an ad filter for these titles.
  krunker: {
    origin: "https://krunker.io",
    assetOrigins: [{ origin: "https://assets.krunker.io", key: "krunkera" }],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "host-only",
  },
  // Bare-host mirrors backing the assetOrigins above (also reachable directly).
  krunkera: {
    origin: "https://assets.krunker.io",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  lngtd: {
    origin: "https://lngtd.com",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  zombscdn: {
    origin: "https://cdn.zombsroyale.io",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  kirka: {
    origin: "https://kirka.io",
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "host-only",
  },
  evio: {
    origin: "https://ev.io",
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "host-only",
  },
  venge: {
    origin: "https://venge.io",
    assetOrigins: [{ origin: "https://assets.venge.io", key: "vengea" }],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "host-only",
  },
  vengea: {
    origin: "https://assets.venge.io",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  zombs: {
    origin: "https://zombsroyale.io",
    assetOrigins: [
      { origin: "https://lngtd.com", key: "lngtd" },
      { origin: "https://cdn.zombsroyale.io", key: "zombscdn" },
    ],
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "host-only",
  },
  surviv: {
    origin: "https://surviv.io",
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "host-only",
  },
  shellshock: {
    origin: "https://shellshock.io",
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "host-only",
  },
  // ── Static INXANITY apps (isle.pizza, pokemon-redstone, salvage-style
  // "surviv" clones). These send no COEP, so a plain cross-origin frame is
  // blocked by the app shell's COEP; mirrored same-origin (this route sets
  // COEP+CORP) they play IN the tab. `api.isle.pizza` (account/relay) is a
  // separate host routed under its own key. ────────────────────────────────
  isle: {
    origin: "https://isle.pizza",
    assetOrigins: [{ origin: "https://api.isle.pizza", key: "isleapi" }],
    entry: "/",
    preservePath: true,
    rewriteMode: "full",
  },
  isleapi: {
    origin: "https://api.isle.pizza",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  pokered: {
    origin: "https://pokemon-redstone.pages.dev",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  redcoats: {
    origin: "https://redcoats.io",
    assetOrigins: [{ origin: "https://cdn.redcoats.io", key: "redcoatscdn" }],
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  redcoatscdn: {
    origin: "https://cdn.redcoats.io",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  saltyseas: {
    origin: "https://saltyseas.io",
    assetOrigins: [{ origin: "https://cdn.saltyseas.io", key: "saltyseascdn" }],
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  saltyseascdn: {
    origin: "https://cdn.saltyseas.io",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  taipeirush: {
    origin: "https://www.taipei-rush.app",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  seedbed: {
    origin: "https://playseedbed.com",
    entry: "/",
    preservePath: true,
    rewriteMode: "host-only",
  },
  // ── archive.org in-browser emulator (DOOM, Duke Nukem 3D, Wolfenstein 3D,
  // GTA 1, …). The embed page sends no COEP and its engine scripts live on
  // archive.org, so mirror the whole embed same-origin (this route adds
  // COEP+CORP). The emulator fetches game files from /serve/… and item
  // metadata — both on archive.org, both rewritten. ────────────────────────
  archive: {
    origin: "https://archive.org",
    entry: "/",
    preservePath: true,
    // Keep the game's own query; drop our cache-buster.
    stripQuery: ["cb"],
    rewriteMode: "full",
  },
  // ── Minecraft Classic — the client is JS from classic.minecraft.net
  // (no COEP), so mirror it same-origin. ───────────────────────────────────
  minecraft: {
    origin: "https://classic.minecraft.net",
    entry: "/",
    preservePath: true,
    stripQuery: ["cb"],
    rewriteMode: "full",
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
