/**
 * vel.gg proxy — shared pure helpers.
 *
 * Kept dependency-free so it can be imported by the Vercel handler
 * (`src/server/vercel-api/velgg.ts`) and unit tests. Cloudflare Pages bundles
 * each Function independently (no cross-file imports), so
 * `functions/api/velgg/[[path]].ts` inlines the same logic (keep in sync).
 */

export const VELGG_UPSTREAM = "https://vel.gg";
export const VELGG_ALLOWED_PREFIX = "bo1z";

/**
 * Only vel.gg's `/bo1z` zombie app may be proxied. A relative `bo1z[/...]`
 * path is required — rejects absolute URLs, protocol-relative URLs, and any
 * traversal (`..`, `//`) so the route can never be used as an open proxy.
 */
export function isAllowedVelggPath(rawPath: string): boolean {
  const p = rawPath.replace(/^\/+|\/+$/g, "");
  if (!p) return false;
  if (p !== VELGG_ALLOWED_PREFIX && !p.startsWith(VELGG_ALLOWED_PREFIX + "/")) {
    return false;
  }
  if (p.includes("..") || p.includes("//")) return false;
  return true;
}

/** The entry page `/bo1z` and each map page `/bo1z/<slug>` are extension-less HTML. */
export function isVelggHtmlPath(rawPath: string): boolean {
  const p = rawPath.replace(/^\/+|\/+$/g, "");
  if (p === VELGG_ALLOWED_PREFIX) return true;
  if (/^bo1z\/[a-z0-9-]+$/.test(p)) return true;
  return /\.html?$/i.test(p);
}

export function contentTypeIsHtml(ct: string | null | undefined): boolean {
  return !!ct && ct.toLowerCase().includes("text/html");
}

/** JS/JSON/HTML bodies are text and safe to rewrite; everything else streams. */
export function isVelggRewritable(ct: string | null | undefined): boolean {
  if (!ct) return false;
  const c = ct.toLowerCase();
  return (
    c.includes("text/html") ||
    c.includes("javascript") ||
    c.includes("ecmascript") ||
    c.includes("application/json")
  );
}

/**
 * Rewrite absolute vel.gg references to the same-origin proxy.
 *
 * NOTE: do NOT blanket-rewrite `/telemetry`. `play.js` does
 * `import { startTelemetry } from './telemetry.js'` — a relative module
 * specifier that CONTAINS the substring `/telemetry`, so a naive replace
 * corrupts it into `/api/velgg/__blocked_telemetry.js` and the whole ES module
 * graph fails to load (the game then hangs on "Loading", which is exactly the
 * bug we hit). The analytics module is instead served as a no-op stub
 * (VELGG_TELEMETRY_STUB) so nothing is ever sent to the third party.
 */
export function rewriteVelggBody(body: string): string {
  return body.replace(/https?:\/\/vel\.gg\//g, "/api/velgg/");
}

/**
 * A no-op replacement for vel.gg's `telemetry.js`. It keeps the two named
 * exports the game imports (`frameStats`, `startTelemetry`) so the module
 * graph resolves, but performs no network calls — the analytics beacon is
 * neutralised at the source instead of relying on a URL rewrite.
 */
export const VELGG_TELEMETRY_STUB =
  "export function frameStats(){return {};}\n" +
  "export function startTelemetry(){/* analytics disabled */}\n";

/** True for the analytics module path vel.gg ships at `/bo1z/telemetry.js`. */
export function isVelggTelemetryModule(rawPath: string): boolean {
  return /(^|\/)telemetry\.js$/i.test(rawPath.replace(/^\/+|\/+$/g, ""));
}

/** True for the analytics ingest endpoint (`/telemetry`). */
export function isVelggTelemetryEndpoint(rawPath: string): boolean {
  return /(^|\/)telemetry$/i.test(rawPath.replace(/^\/+|\/+$/g, ""));
}
