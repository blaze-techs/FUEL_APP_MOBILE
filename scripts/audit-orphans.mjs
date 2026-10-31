#!/usr/bin/env node
/**
 * Lists source files that nothing imports ("unwired modules").
 *
 * A green unit test on a module nothing calls only proves the module works,
 * not that the feature ships. Run this after adding a module to confirm it is
 * actually reachable. Framework entry points (api/, functions/, configs) and
 * tests are reported too; judge those by hand.
 *
 *   npm run audit:orphans
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts"];
const skipDirs = new Set([
  "node_modules",
  "dist",
  "build",
  "android",
  "coverage",
]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.includes(path.extname(e.name)) && !e.name.endsWith(".d.ts"))
      files.push(path.resolve(p));
  }
})(root);

const known = new Set(files);
const resolveSpec = (from, spec) => {
  const base = spec.startsWith("@/")
    ? path.join(root, "src", spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(from), spec)
      : null;
  if (!base) return null;
  const candidates = [
    base,
    ...exts.map((e) => base + e),
    ...exts.map((e) => path.join(base, "index" + e)),
    base.replace(/\.m?js$/, ".ts"),
    base.replace(/\.m?js$/, ".tsx"),
  ].map((c) => path.resolve(c));
  return candidates.find((c) => known.has(c)) ?? null;
};

const importRe =
  /(?:from|import|require|mock|importActual|doMock)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
const referenced = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(importRe)) {
    const hit = resolveSpec(f, m[1]);
    if (hit && hit !== f) referenced.add(hit);
  }
}

const isTest = (rel) =>
  /\.(test|spec)\.[tj]sx?$/.test(rel) ||
  rel.startsWith("src/test/") ||
  rel.startsWith("e2e/");
const orphans = files
  .filter((f) => !referenced.has(f))
  .map((f) => path.relative(root, f))
  .filter((rel) => !isTest(rel))
  .sort();

const groups = new Map();
for (const rel of orphans) {
  const key = rel
    .split("/")
    .slice(0, rel.startsWith("src/") ? 3 : 1)
    .join("/");
  groups.set(key, [...(groups.get(key) ?? []), rel]);
}
for (const [key, list] of groups) {
  console.log(`\n${key}  (${list.length})`);
  for (const rel of list) console.log(`  ${rel}`);
}
console.log(
  `\n${orphans.length} unreferenced of ${files.length} source files (tests excluded)`,
);
