import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The grant snapshot builder is pulled into the Vercel serverless bundle by a
 * dynamic `import()`. Vercel compiles that bundle as ESM and resolves
 * specifiers the way Node does — an extensionless relative import is NOT
 * resolvable, so the whole module graph fails to load.
 *
 * That failure mode is invisible at build time: `tsc` and Vite both resolve
 * extensionless specifiers happily, the deploy reports success, and the only
 * symptom is the endpoint returning a blanket HTTP 500 at runtime — which the
 * member UI then reads as "this link is not valid", i.e. a healthy grant being
 * denied. This exact bug shipped once: `react-app/config/pricing.ts` imported
 * `./worldPaymentConfigs` without the extension, so every `company-grant-data`
 * call 500'd and every member saw "Access no longer available".
 *
 * These assertions pin the extension contract for the whole server-reachable
 * chain so the blunt symptom never comes back unnoticed.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// The module graph the grant endpoint loads at runtime, plus the config chain
// `pricing.ts` / `world-country-utils.ts` pull in.
const SERVER_REACHABLE_FILES = [
  "src/server/vercel-api/_lib/station-snapshot-for-grant.ts",
  "src/react-app/config/pricing.ts",
  "src/react-app/config/worldPaymentConfigs.ts",
  "src/react-app/lib/world-country-utils.ts",
];

/** Relative specifiers, e.g. `./x`, `../y/z`. */
const RELATIVE_IMPORT_RE = /(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g;

function relativeImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(RELATIVE_IMPORT_RE)) found.push(m[1]);
  return found;
}

describe("serverless module resolution contract", () => {
  for (const rel of SERVER_REACHABLE_FILES) {
    it(`${rel} uses extensioned relative imports`, () => {
      const abs = path.join(REPO_ROOT, rel);
      const source = fs.readFileSync(abs, "utf8");
      const specifiers = relativeImports(source);
      const extensionless = specifiers.filter((s) => !s.endsWith(".js"));
      expect(
        extensionless,
        `${rel} has relative imports Node's ESM resolver cannot load. ` +
          `Append ".js" — the server bundler does not resolve extensions, ` +
          `and the failure surfaces only as a runtime 500.`,
      ).toEqual([]);
    });
  }

  it("actually scans the extensionless imports it is meant to catch", () => {
    // Several of the files above are leaves, so a per-file `length > 0` would
    // be wrong. Assert the regex is alive across the chain as a whole instead:
    // if it ever stops matching, every other assertion here passes vacuously.
    const total = SERVER_REACHABLE_FILES.reduce(
      (n, rel) =>
        n +
        relativeImports(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))
          .length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("the grant endpoint imports its snapshot builder dynamically", () => {
    // The builder is loaded on demand so a cold start does not pay for it.
    // If this ever becomes a static import the `.js` contract above still
    // applies, but the endpoint shape would have changed — worth noticing.
    const core = fs.readFileSync(
      path.join(REPO_ROOT, "src/server/vercel-api/_lib/integrations-core.ts"),
      "utf8",
    );
    expect(core).toContain('import("./station-snapshot-for-grant.js")');
  });
});
