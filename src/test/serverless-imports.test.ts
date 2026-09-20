import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";

/**
 * Regression guard for the "Could not load the catalog." outage.
 *
 * The whole /api surface is served by a single Vercel catch-all function
 * (api/[[...path]].ts) that statically imports every route module. Vercel
 * compiles that file to ESM and runs it under Node, which requires an explicit
 * file extension on relative imports - an extensionless specifier throws
 * ERR_MODULE_NOT_FOUND at load time, so EVERY route through the dispatcher
 * 500s rather than just the broken one.
 *
 * That is exactly what shipped: all 43 dispatcher imports were extensionless
 * (while the route modules themselves correctly used ".js"), so the Movies
 * tab, Live TV, the fuel-price engine and the payment endpoints were all dead
 * at once.
 *
 * These tests fail the build if an extensionless (or dangling) relative import
 * is reintroduced anywhere in the serverless tree.
 */

const ROOT = resolve(__dirname, "../..");

/** Every tracked file that ships into the serverless API surface. */
function serverFiles(): string[] {
  const roots = ["api", "src/server/vercel-api"];
  const out: string[] = [];
  const walk = (dir: string) => {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs)) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(rel);
    }
  };
  roots.forEach(walk);
  return out;
}

/** Relative import/export specifiers used by a source file. */
function relativeSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re = /(?:from|import)\s*\(?\s*"(\.\.?\/[^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) specs.push(m[1]);
  return specs;
}

/** Resolve a specifier the way Node ESM would, against real on-disk files. */
function resolves(fromFile: string, spec: string): boolean {
  const target = normalize(join(ROOT, dirname(fromFile), spec));
  if (isFile(target)) return true;
  // A ".js" specifier refers to the corresponding TypeScript source, which is
  // what actually lives in the repo (Vercel compiles it to .js at build time).
  const bases = spec.endsWith(".js") ? [target.slice(0, -3)] : [target];
  return bases.some((base) =>
    [".ts", ".tsx", ".mts", ".js"].some((ext) => isFile(base + ext)),
  );
}

function isFile(p: string): boolean {
  return existsSync(p) && statSync(p).isFile();
}

describe("serverless import specifiers", () => {
  const files = serverFiles();

  it("finds the serverless tree", () => {
    expect(files).toContain("api/[[...path]].ts");
    expect(files).toContain("src/server/vercel-api/movies.ts");
  });

  it("every relative import carries an explicit extension", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const spec of relativeSpecifiers(source)) {
        if (!/\.(js|mjs|cjs|json|ts|tsx|mts)$/.test(spec)) {
          offenders.push(`${file} -> ${spec}`);
        }
      }
    }
    expect(
      offenders,
      "Extensionless relative imports break Vercel ESM function loading " +
        "(ERR_MODULE_NOT_FOUND) and 500 every route in the dispatcher.",
    ).toEqual([]);
  });

  it("every relative import points at a real module", () => {
    const dangling: string[] = [];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const spec of relativeSpecifiers(source)) {
        if (!resolves(file, spec)) dangling.push(`${file} -> ${spec}`);
      }
    }
    expect(dangling, "Imports that resolve to nothing.").toEqual([]);
  });

  it("the dispatcher wires up the movies route", () => {
    const dispatcher = readFileSync(join(ROOT, "api/[[...path]].ts"), "utf8");
    expect(dispatcher).toContain("/api/movies");
    expect(dispatcher).toMatch(/vercel-api\/movies\.js"/);
  });
});
