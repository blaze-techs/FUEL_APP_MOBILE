/**
 * Regression guard: the app must NEVER auto-reload in the background.
 *
 * History: the app refreshed unexpectedly whenever the user left the tab and
 * returned (or right after a deploy) because the service-worker update
 * pipeline auto-reloaded on controllerchange — `reg.update()` polled every
 * 60s, the freshly deployed SW used `skipWaiting()`+`clients.claim()` to take
 * control immediately, and the page's `controllerchange` listener called
 * `window.location.reload()`. A frequent-deploy repo made this hit users all
 * the time, wiping in-progress work.
 *
 * These tests assert the fix: SW updates + version changes surface the
 * "New version available" banner instead of reloading.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("no unexpected auto-reload", () => {
  it("index.html does NOT reload on service-worker controllerchange", () => {
    const html = read("index.html");
    // The old handler called __fuelproSafeReload("sw-controllerchange"). It
    // must be gone — a new SW taking control may not refresh the page.
    expect(html).not.toMatch(
      /__fuelproSafeReload\(\s*["']sw-controllerchange["']\s*\)/,
    );
  });

  it("sw.js never calls skipWaiting() (would force a live page to be taken over)", () => {
    const sw = read("public/sw.js");
    // Match an executable statement, not the explanatory comments.
    expect(sw).not.toMatch(/^\s*self\.skipWaiting\s*\(\s*\)\s*;?\s*$/m);
  });

  it("sw.js never calls clients.claim() (would hijack open tabs mid-session)", () => {
    const sw = read("public/sw.js");
    expect(sw).not.toMatch(/^\s*self\.clients\.claim\s*\(\s*\)\s*;?\s*$/m);
  });

  it("version-change path notifies the banner instead of reloading", () => {
    const html = read("index.html");
    expect(html).toMatch(/fuelpro-sw-update/);
    // The old version-check unregistered the SW and reloaded.
    expect(html).not.toMatch(
      /__fuelproSafeReload\(\s*["']version-check-newer["']\s*\)/,
    );
  });

  it("stale-SW script self-heal reloads ONLY on a confirmed 404/410 (not any transient error)", () => {
    const html = read("index.html");
    // The self-heal must verify the chunk is really gone (HEAD probe) before
    // unregistering + reloading. A bare `scriptError -> safeReload` would turn
    // transient network blips (exactly what happens on tab leave/return) into
    // unexpected full-page refreshes.
    expect(html).toMatch(/res\.status === 404/);
    expect(html).toMatch(/NOT reloading/);
  });

  it("ad-blocker never registers a beforeunload/unload listener (would disable bfcache and reload on tab return)", () => {
    const blocker = read("src/react-app/lib/ad-blocker.ts");
    // ANY registered beforeunload/unload listener disables bfcache for the
    // whole page session: leaving the app for a second then returning
    // performs a full page reload (losing progress). The blocker must NEVER
    // call addEventListener("beforeunload"/"unload").
    expect(blocker).not.toMatch(/addEventListener\(\s*["']beforeunload["']/);
    expect(blocker).not.toMatch(/addEventListener\(\s*["']unload["']/);
    // Redirect/ad protection is provided by the sandbox + window.open
    // override + iframe hijack watchdog (documented in the comment block).
    expect(blocker).toMatch(/sandboxed without allow-top-navigation/);
  });
});

// BFCACHE ELIGIBILITY — HTTP layer.
//
// The document (the app's main resource) must NOT be served with
// Cache-Control: no-store. Per the browser bfcache eligibility rules, a
// main-resource response carrying `no-store` is ineligible for the
// back/forward cache, so briefly leaving the page (switching to another
// tab/app) forces a FULL document reload on return — the exact
// "whole app refreshes when I leave for a second" bug. `no-cache,
// must-revalidate` still forces revalidation before ANY cache reuse (a
// fresh deploy is never stale) WITHOUT disabling bfcache, so the document
// must use that instead.
describe("bfcache eligibility (no no-store on the document)", () => {
  function cfDocumentCacheControl(headersText: string): string[] {
    // Public/_headers uses a Cloudflare-style block per route:
    //   /index.html
    //     Cache-Control: ...
    // A Cache-Control line is a document route when the preceding route
    // selector (the non-indented line above it) is "/index.html" or "/".
    const out: string[] = [];
    const lines = headersText.split("\n");
    let pendingRoute = "";
    for (const line of lines) {
      const route = line.trim();
      if (route === "/index.html" || route === "/") {
        pendingRoute = route;
      } else if (route.startsWith("Cache-Control:")) {
        const cc = route.split(":")[1]?.trim() ?? "";
        if (pendingRoute) out.push(cc);
        pendingRoute = "";
      } else if (route !== "" && !line.startsWith(" ") && !line.startsWith("/*")) {
        // Any other top-level selector resets the pending route.
        pendingRoute = "";
      }
    }
    return out;
  }

  function vercelDocumentCacheControls(jsonText: string): string[] {
    // vercel.json has one headers[] entry per route; each entry has a
    // "source" that is "/index.html" or "/" and a Cache-Control header.
    const out: string[] = [];
    const entries = jsonText.match(
      /\{\s*"source":\s*"(\/index\.html|\/|[\s\S]*?)",\s*"headers":\s*\[([\s\S]*?)\]\s*\}/g,
    ) || [];
    for (const entry of entries) {
      if (!/"source":\s*"\/index\.html"|"source":\s*"\/"/.test(entry)) continue;
      const cc = /"Cache-Control",\s*"value":\s*"([^"]+)"/.exec(entry);
      if (cc) out.push(cc[1]);
    }
    return out;
  }

  it("public/_headers serves the document WITHOUT no-store (bfcache-eligible)", () => {
    const doc = cfDocumentCacheControl(read("public/_headers"));
    expect(doc.length).toBeGreaterThan(0);
    for (const cc of doc) {
      expect(cc).not.toMatch(/\bno-store\b/);
    }
  });

  it("vercel.json serves the document WITHOUT no-store (bfcache-eligible)", () => {
    const doc = vercelDocumentCacheControls(read("vercel.json"));
    expect(doc.length).toBeGreaterThan(0);
    for (const cc of doc) {
      expect(cc).not.toMatch(/\bno-store\b/);
    }
  });

  it("document routes still revalidate (no-cache/must-revalidate retained for freshness)", () => {
    const cf = cfDocumentCacheControl(read("public/_headers"));
    expect(cf.length).toBeGreaterThan(0);
    expect(
      cf.every((cc) => /\bno-cache\b/.test(cc) && /\bmust-revalidate\b/.test(cc)),
    ).toBe(true);
    const vc = vercelDocumentCacheControls(read("vercel.json"));
    expect(vc.length).toBeGreaterThan(0);
    expect(
      vc.every((cc) => /\bno-cache\b/.test(cc) && /\bmust-revalidate\b/.test(cc)),
    ).toBe(true);
  });
});
