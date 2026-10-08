/**
 * Generic same-origin game mirror — shared helpers.
 *
 * See `src/react-app/lib/game-mirror-config.ts` for the registry that decides
 * per-game origin/entry. This module holds the HTML/JS/CSS rewrite that keeps
 * an app's root-relative asset references pointing back through the mirror.
 *
 * The Cloudflare Pages Function inlines a copy (CF bundles each function
 * independently, no cross-file imports) — keep the two in sync.
 */

import {
  GAME_MIRROR,
  mirrorUpstream,
  isKnownMirrorKey,
} from "../../../react-app/lib/game-mirror-config.js";
import type { GameMirrorConfig } from "../../../react-app/lib/game-mirror-config.js";

export { mirrorUpstream, isKnownMirrorKey, GAME_MIRROR };
export type { GameMirrorConfig };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Asset path segments that are always root-relative in a Vite SPA build. */
const ASSET_SEGMENTS =
  "assets|media|img|images|js|css|fonts?|static|icons|favicon\\.(?:ico|svg)|site\\.webmanifest|manifest\\.json|robots\\.txt|apple-touch-icon\\.png";

/**
 * Rewrite a text payload so every resource the app loads routes back through
 * `/api/game-mirror/<key>/…` (same-origin). Covers absolute host URLs, extra
 * image CDN origins, and root-absolute asset refs.
 */
export function rewriteMirrorBody(
  text: string,
  key: string,
  cfg: GameMirrorConfig,
  upstream?: URL,
): string {
  const prefix = `/api/game-mirror/${key}/`;
  let out = text;
  // Absolute URLs of the game origin (protocol-agnostic — some games emit
  // `http://host/...` which must also route back through the mirror).
  const host = (u: string) => esc(u.replace(/^https?:\/\//, ""));
  out = out.replace(
    new RegExp("https?://" + host(cfg.origin) + "/", "g"),
    prefix,
  );
  // Absolute URLs of extra asset/CDN origins. A host that needs its OWN
  // upstream is mirrored under its own key; a keyless entry falls back to
  // `key` (legacy behaviour for same-origin-backed CDNs).
  for (const o of cfg.assetOrigins ?? []) {
    const ao = typeof o === "string" ? { origin: o, key } : o;
    out = out.replace(
      new RegExp("https?://" + host(ao.origin) + "/", "g"),
      `/api/game-mirror/${ao.key}/`,
    );
  }
  // host-only: complex game engines (Krunker, ev.io, Zombs…) derive their
  // asset + WebSocket URLs from `location`; rewriting root-relative refs or
  // injecting a <base> breaks them. Only the absolute-host rewrite above runs.
  if (cfg.rewriteMode === "host-only") return out;
  // Root-absolute asset references -> mirror (leave protocol-relative `//`).
  // CAPTURE the segment and re-emit it ($2) — dropping it broke every asset.
  out = out.replace(
    new RegExp(`(["'=(])/(?![/])(${ASSET_SEGMENTS})`, "g"),
    `$1${prefix}$2`,
  );
  // Some app entries self-redirect to the provider site when framed at the
  // very top (e.g. vc.quenq.com -> quenq.com). Neutralise that specific
  // same-tab redirect so the mirror stays in the tab, and route any remaining
  // top-window redirect to the provider's own mirrored page.
  out = out.replace(
    /window\.location\.replace\(\s*(['"])https?:\/\/[^'"]*quenq\.com\1\s*\)/g,
    "void 0",
  );
  // HTML: pin a <base> to the mirrored DOCUMENT's own directory so RELATIVE
  // refs (assets/x.js) resolve under the mirror even when the request URL has
  // no trailing slash (else the base is `/api/game-mirror/` and assets 400).
  const rip = upstream ? upstream.pathname.replace(/[^/]*$/, "") : "/";
  const dirHref = `${prefix}${rip.replace(/^\/+/, "")}`.replace(/\/?$/, "/");
  const isHtmlDoc = /<!doctype html/i.test(out) || /<html[\s>]/i.test(out);
  if (isHtmlDoc && /<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${dirHref}">`);
  }
  return out;
}

/** Content types worth rewriting (text-ish). */
export function mirrorRewritable(contentType: string | null): boolean {
  if (!contentType) return false;
  return /text\/html|javascript|ecmascript|application\/json|text\/css|image\/svg|\+json|text\/plain/.test(
    contentType,
  );
}

/** Is `key` a registered mirror? */
export function isMirrorKey(key: string): boolean {
  return isKnownMirrorKey(key);
}

/** Registry accessor (used by the handler for origin/entry lookup). */
export function mirrorConfig(key: string): GameMirrorConfig | undefined {
  return GAME_MIRROR[key];
}
