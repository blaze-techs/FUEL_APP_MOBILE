// Production check of the public mini-site. No mocking: it loads the real
// published document from Storage through the deployed bundle and asserts the
// SEO surface the feature is responsible for.
//
// Usage: MINI_SITE_ORIGIN=https://fuel-app-mobile.vercel.app \
//        node scripts/probe-mini-site-prod.mjs <slug> <missing-slug>
import { chromium } from "playwright";

const ORIGIN = process.env.MINI_SITE_ORIGIN || "https://fuel-app-mobile.vercel.app";
const SLUG = process.argv[2] || "publican-energy";
const MISSING = process.argv[3] || "definitely-not-published-xyz";

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});

async function load(path) {
  const p = await b.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const resp = await p.goto(`${ORIGIN}${path}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  return { p, errors, status: resp?.status() };
}

async function seo(p) {
  return p.evaluate(() => {
    const meta = (n) =>
      document.querySelector(`meta[name="${n}"]`)?.getAttribute("content") ?? null;
    const prop = (n) =>
      document
        .querySelector(`meta[property="${n}"]`)
        ?.getAttribute("content") ?? null;
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => {
        try {
          return JSON.parse(s.textContent || "{}");
        } catch {
          return {};
        }
      })
      .filter((o) => o && o["@type"]);
    return {
      title: document.title,
      canonical:
        document.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
        null,
      robots: meta("robots"),
      ogTitle: prop("og:title"),
      ldTypes: ld.map((o) => o["@type"]),
    };
  });
}

const body = (p) => p.evaluate(() => document.body.innerText);
// FAQ answers live inside collapsed <details>, which innerText omits — read
// the DOM instead so a legitimately collapsed answer still counts as rendered.
const domText = (p) => p.evaluate(() => document.body.textContent || "");

console.log(`origin = ${ORIGIN}\n`);

// ── published page ────────────────────────────────────────────────────────
{
  const { p, errors, status } = await load(`/site/${SLUG}`);
  const s = await seo(p);
  const text = await body(p);
  const full = await domText(p);
  const has = (t) => text.toLowerCase().includes(t.toLowerCase());
  const hasDom = (t) => full.toLowerCase().includes(t.toLowerCase());
  // The answer must be in the DOM (it is collapsed by default, and a collapsed
  // <details> is excluded from innerText — that is expected, not a defect).
  const faqAnswerInDom = hasDom("cash are all accepted");

  const checks = {
    http200: status === 200,
    siteName: has("THE PUBLICAN ENERGY"),
    headline: has("Fuel you can count on"),
    address: has("Lodwar"),
    phone: has("254754458501"),
    pricesRendered: has("220.08") && has("224.95"),
    servicesRendered: has("Car wash"),
    hoursRendered: has("Monday") || has("05:00"),
    faqRendered: has("Do you accept M-PESA?"), // the section that never rendered
    faqAnswerInDom,
    canonicalOwn:
      s.canonical !== null && s.canonical.includes(`/site/${SLUG}`),
    robotsIndexable: (s.robots || "").includes("index"),
    gasStationLd: s.ldTypes.includes("GasStation"),
    ogTitle: !!s.ogTitle,
    noErrors: errors.length === 0,
  };

  console.log("PUBLISHED PAGE");
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
  }
  console.log(`  title:     ${s.title}`);
  console.log(`  canonical: ${s.canonical}`);
  console.log(`  robots:    ${s.robots}`);
  console.log(`  ld:        ${s.ldTypes.join(", ")}`);
  if (errors.length) console.log("  errors:", errors.slice(0, 3));
  await p.close();

  var publishedOk = Object.values(checks).every(Boolean);
}

// ── missing page must NOT be indexable under FuelPro's own URL ─────────────
{
  const { p, errors } = await load(`/site/${MISSING}`);
  const s = await seo(p);
  const checks = {
    noindex: (s.robots || "").includes("noindex"),
    noCanonical: s.canonical === null,
    noGasStationLd: !s.ldTypes.includes("GasStation"),
    titleSaysNotFound: /not found/i.test(s.title),
    noErrors: errors.length === 0,
  };
  console.log("\nMISSING PAGE (soft-404 guard)");
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
  }
  console.log(`  title:     ${s.title}`);
  console.log(`  canonical: ${s.canonical}`);
  console.log(`  robots:    ${s.robots}`);
  if (errors.length) console.log("  errors:", errors.slice(0, 3));
  await p.close();

  var missingOk = Object.values(checks).every(Boolean);
}

await b.close();

const all = publishedOk && missingOk;
console.log("\nRESULT:", all ? "ALL PASS" : "FAILURES PRESENT");
process.exit(all ? 0 : 1);
