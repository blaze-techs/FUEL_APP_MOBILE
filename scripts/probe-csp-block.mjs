/**
 * Decisive test: is the caption-model failure a CSP block?
 *
 * From the REAL production page (which carries the CSP), fetch the host that
 * serves the model's metadata versus the host the weights actually redirect
 * to. If the second is blocked by CSP while the first is not, the cause is
 * proven rather than inferred.
 */
import { chromium } from "playwright";

const HOST = process.argv[2] || "https://fuel-app-mobile.pages.dev";

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await (await browser.newContext()).newPage();

const cspViolations = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to connect/i.test(t)) {
    cspViolations.push(t.slice(0, 220));
  }
});

await page.goto(`${HOST}/`, { waitUntil: "domcontentloaded", timeout: 90000 });

const out = await page.evaluate(async () => {
  const probe = async (label, url) => {
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual" });
      return { label, ok: true, status: res.status };
    } catch (e) {
      return { label, ok: false, error: String(e).slice(0, 120) };
    }
  };
  return [
    await probe(
      "huggingface.co (metadata — allowed today)",
      "https://huggingface.co/Xenova/whisper-tiny/resolve/main/config.json",
    ),
    await probe(
      "us.gcp.cdn.hf.co (weights CDN — redirect target)",
      "https://us.gcp.cdn.hf.co/xet-bridge-us/probe",
    ),
  ];
});

console.log(`\n=== ${HOST} ===`);
for (const r of out) {
  console.log(
    `  ${r.ok ? "ALLOWED" : "BLOCKED"}  ${r.label}` +
      (r.ok ? ` (http ${r.status})` : ` -> ${r.error}`),
  );
}
if (cspViolations.length) {
  console.log("\n  CSP violations observed:");
  for (const v of [...new Set(cspViolations)]) console.log(`    ${v}`);
}

await browser.close();
