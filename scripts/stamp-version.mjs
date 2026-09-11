// Generates a build version stamp and saves it for the post-build step.
// The actual HTML replacement is done by the vite plugin in vite.config.ts
// (transformIndexHtml hook). This script just generates the version number.
import fs from "fs";
import path from "path";

const version = new Date().toISOString().replace(/[:.]/g, "-");
const root = path.resolve(process.cwd());

// Save the version to a temp file that the vite plugin + post-build script read.
fs.writeFileSync(path.join(root, ".build-version"), version);
console.log(`[version-stamp] .build-version written: ${version}`);
