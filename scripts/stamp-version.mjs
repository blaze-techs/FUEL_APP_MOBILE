// Generates a deterministic build stamp and saves it for the post-build step.
// CI/deployment environments expose the source commit; use it so the deployed
// /version.json can be verified against the exact Git commit. Local builds keep
// a timestamp fallback.
import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd());
const commit =
  process.env.GITHUB_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.COMMIT_SHA ||
  "";
const version = commit || new Date().toISOString().replace(/[:.]/g, "-");

fs.writeFileSync(path.join(root, ".build-version"), version);
console.log(`[version-stamp] .build-version written: ${version}`);
