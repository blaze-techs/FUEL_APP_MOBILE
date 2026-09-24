// End-to-end check of the READY mini-site page against the built bundle:
// serves a synthetic published doc, then asserts the public page renders the
// station content with the STATION's own canonical/robots/JSON-LD.
import { chromium } from "playwright";

const ORIGIN = process.env.MINI_SITE_ORIGIN || "http://localhost:8899";
const SLUG = "qa-publican-energy";

const doc = {
  slug: SLUG,
  siteName: "QA Publican Energy",
  headline: "QA Publican Energy",
  tagline: "Fuel, lubricants and car wash",
  about: "A QA station site used to verify the published mini site renders.",
  currencySymbol: "KSh",
  country: "KE",
  address: "Moi Avenue, Nairobi",
  phone: "+254700000000",
  email: "hello@publican.test",
  theme: { primary: "#c5a059" },
  sections: ["about", "prices", "services", "hours", "contact", "faqs"],
  services: [
    { id: "svc1", title: "Car wash", description: "Full exterior wash" },
  ],
  hours: [
    { day: 1, open: "06:00", close: "21:00", closed: false },
    { day: 2, open: "06:00", close: "21:00", closed: false },
  ],
  socials: {},
  showPricesInHero: true,
  allowIndexing: true,
  prices: [
    { label: "Super Petrol", code: "PMS", price: 214.03, unit: "L" },
    { label: "Diesel", code: "AGO", price: 217.86, unit: "L" },
  ],
  team: [{ name: "Jane Owner", role: "Manager" }],
  testimonials: [],
  faqs: [{ question: "Do you accept M-PESA?", answer: "Yes." }],
  gallery: [],
  blog: [],
  updatedAt: 1_760_000_000_000,
  schemaType: "GasStation",
};

const b = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const p = await b.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

// Mock only the Storage object URL the published doc comes from; everything
// else (the app bundle, the view counter) is passed through to the real server.
await p.route("**/storage/v1/object/public/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(doc),
  }),
);

await p.goto(`${ORIGIN}/site/${SLUG}`, { waitUntil: "load" });
await p.waitForTimeout(3500);

const info = await p.evaluate(() => ({
  href: location.href,
  title: document.title,
  canonical:
    document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
    null,
  robots:
    document.querySelector('meta[name="robots"]')?.getAttribute("content") ||
    null,
  ogTitle:
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content") || null,
  ld: JSON.parse(
    document.getElementById("ld-mini-site")?.textContent || "null",
  ),
  text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 900),
}));

console.log(
  JSON.stringify(
    {
      title: info.title,
      canonical: info.canonical,
      robots: info.robots,
      ogTitle: info.ogTitle,
      ldType: info.ld?.["@type"] ?? null,
      ldName: info.ld?.name ?? null,
      ldUrl: info.ld?.url ?? null,
      hasStationName: info.text.includes("QA Publican Energy"),
      hasPrices: info.text.includes("214.03") && info.text.includes("217.86"),
      hasService: info.text.includes("Car wash"),
      hasFaq: info.text.includes("M-PESA"),
      snippet: info.text.slice(0, 320),
      errors,
    },
    null,
    2,
  ),
);
await b.close();
