/**
 * Discover every origin the on-device caption model actually contacts.
 *
 * The CSP blocks the model download ("Failed to fetch"), and guessing the
 * host list is how that happened in the first place. This runs the real
 * pipeline in a browser with CSP stripped, records every request, and prints
 * the exact origins that must be allowed.
 */
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

const seen = new Map();
page.on("request", (r) => {
  const u = new URL(r.url());
  if (!seen.has(u.origin)) seen.set(u.origin, []);
  const arr = seen.get(u.origin);
  if (arr.length < 4) arr.push(u.pathname.slice(0, 90));
});
page.on("requestfailed", (r) => {
  console.log("  [failed]", r.url().slice(0, 120), r.failure()?.errorText);
});

// A CSP-free document: nothing can be blocked, so every real dependency shows.
await page.setContent("<!doctype html><html><body>probe</body></html>");

const result = await page.evaluate(async () => {
  try {
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js"
    );
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = false;
    const pipe = await mod.pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      { quantized: true },
    );
    return { ok: !!pipe };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  }
});

console.log("\nmodel load:", JSON.stringify(result));
console.log("\n=== origins contacted ===");
for (const [origin, paths] of [...seen.entries()].sort()) {
  console.log(`  ${origin}`);
  for (const p of paths) console.log(`      ${p}`);
}

await browser.close();
