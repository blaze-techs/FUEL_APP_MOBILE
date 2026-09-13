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
});
