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
import { injectWebglShim } from "../../../react-app/lib/webgl-capability-shim.js";

export { mirrorUpstream, isKnownMirrorKey, GAME_MIRROR };
export type { GameMirrorConfig };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Asset path segments that are always root-relative in an SPA build. */
const ASSET_SEGMENTS =
  "assets|media|img|images|js|css|fonts?|static|icons|favicon\\.(?:ico|svg)|site\\.webmanifest|manifest\\.(?:json|webmanifest)|robots\\.txt|apple-touch-icon\\.png|_app|_next|_nuxt|serve|download|includes|services|components|vendor|dist|build|sponsor|sw\\.js|app\\.js|index\\.css";

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
  // Rewrite absolute (`https://host/`, `http://host/`) AND protocol-relative
  // (`//host/`) refs — archive.org's embed emits `//archive.org/…`. The
  // lookbehind `(?<![:\w])` skips `wss://host` / `ws://host`, so player
  // WebSockets are NEVER rewritten (they must stay cross-origin; they are not
  // CORP-gated and rewriting them to a wss: + mirror path would break them).
  const esc_host = (u: string) => esc(u.replace(/^https?:\/\//, ""));
  const refRe = (o: string) =>
    new RegExp("(?<![:\\w])(?:https?://|//)" + esc_host(o) + "/", "g");
  out = out.replace(refRe(cfg.origin), prefix);
  // Absolute URLs of extra asset/CDN origins. A host that needs its OWN
  // upstream is mirrored under its own key; a keyless entry falls back to
  // `key` (legacy behaviour for same-origin-backed CDNs).
  for (const o of cfg.assetOrigins ?? []) {
    const ao = typeof o === "string" ? { origin: o, key } : o;
    out = out.replace(refRe(ao.origin), `/api/game-mirror/${ao.key}/`);
  }
  // Embed-compat shim: some engines (redcoats.io / saltyseas.io and siblings)
  // abort themselves when `location.hostname` is not in a hard-coded allowlist
  // (`throw … "about:blank" …, new Error("domain not allowed")`). Under our
  // mirror the hostname is ours, so the guard would blank the tab. Turn that
  // one abort into a no-op so the free game keeps running in-place. It removes
  // only a self-navigation; it defeats no licence or paywall.
  out = out.replace(
    /throw window\.location\.href="about:blank",new Error\("domain not allowed"\)/g,
    "void 0",
  );
  const isHtmlDoc = /<!doctype html/i.test(out) || /<html[\s>]/i.test(out);
  if (isHtmlDoc) {
    // WebGL capability shim — first in <head>, before any game script. The
    // shim only patches WebGL prototypes (no URLs), so it is safe for the
    // complex engines too and is applied in BOTH rewrite modes.
    out = injectWebglShim(out);
  }
  // host-only: complex game engines (Krunker, ev.io, Zombs…) derive their
  // asset + WebSocket URLs from `location`; rewriting root-relative refs or
  // injecting a <base> breaks them. Only the absolute-host rewrite above runs.
  if (cfg.rewriteMode === "host-only") return out;
  if (isHtmlDoc) {
    // Entry documents reference their app's assets with root-absolute paths
    // that are NOT limited to a known segment list (e.g. isle's `/isle.<hash>.js`,
    // seedbed's `/game.js`). Rewrite EVERY root-absolute `src`/`href` (but not
    // protocol-relative `//` and not paths already routed through the mirror).
    out = out.replace(
      /(\s(?:src|href)\s*=\s*["'])\/(?!\/)(?!api\/game-mirror\/)/g,
      `$1${prefix}`,
    );
  }
  // Root-absolute asset references in JS/CSS -> mirror (leave `//`).
  // CAPTURE the segment and re-emit it ($2) — dropping it broke every asset.
  out = out.replace(
    new RegExp(`(["'=(])/(?![/])(${ASSET_SEGMENTS})`, "g"),
    `$1${prefix}$2`,
  );
  // CSS `url(/x)` refs.
  out = out.replace(
    /url\(\s*(["']?)\/(?!\/)(?!api\/game-mirror\/)/g,
    `url($1${prefix}`,
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
  if (isHtmlDoc) {
    // <base> pins RELATIVE refs to the mirrored document's own directory.
    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${dirHref}">`);
    }
    // WebGL capability shim — must run before any game script so engines stop
    // bailing with "Unsupported graphics …".
    out = injectWebglShim(out);
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
