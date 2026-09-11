// Auto-News Update Service for FuelPro
// Fetches fuel industry news from credible sources and stores locally

export interface ExternalNewsItem {
  id: string;
  title: string;
  summary: string;
  category:
    | "price"
    | "regulation"
    | "industry"
    | "technology"
    | "sustainability"
    | "market"
    | "tax";
  source: string;
  sourceUrl: string;
  publishedAt: string;
  country: string;
  priority: "high" | "medium" | "low";
}

const NEWS_STORAGE_KEY = "fuelpro_external_news";
const LAST_FETCH_KEY = "fuelpro_news_last_fetch";
const FETCH_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Credible fuel industry news sources mapped by country
const NEWS_SOURCES: Record<
  string,
  Array<{
    name: string;
    rssUrl?: string;
    apiUrl?: string;
    scraper?: () => Promise<Partial<ExternalNewsItem>[]>;
  }>
> = {
  KE: [
    { name: "EPRA Kenya", rssUrl: "https://www.epra.go.ke/feed" },
    {
      name: "Business Daily Africa",
      rssUrl: "https://www.businessdailyafrica.com/rss.xml",
    },
    {
      name: "Capital FM Kenya",
      rssUrl: "https://www.capitalfm.co.ke/news/feed/",
    },
    {
      name: "The Standard",
      rssUrl: "https://www.standardmedia.co.ke/rss/headlines.php",
    },
  ],
  UG: [
    { name: "URA Uganda", rssUrl: "https://www.ura.go.ug/feed" },
    { name: "Daily Monitor", rssUrl: "https://www.monitor.co.ug/rss.xml" },
    { name: "New Vision", rssUrl: "https://www.newvision.co.ug/rss" },
  ],
  TZ: [
    { name: "EWURA", rssUrl: "https://www.ewura.go.tz/feed" },
    { name: "The Citizen", rssUrl: "https://www.thecitizen.co.tz/rss.xml" },
    { name: "Daily News", rssUrl: "https://dailynews.co.tz/feed" },
  ],
  NG: [
    { name: "NNPC", rssUrl: "https://nnpcgroup.com/feed" },
    { name: "Vanguard", rssUrl: "https://www.vanguardngr.com/feed/" },
    { name: "Punch Nigeria", rssUrl: "https://punchng.com/feed/" },
  ],
  ZA: [
    { name: "SARS", rssUrl: "https://www.sars.gov.za/feed/" },
    { name: "News24", rssUrl: "https://www.news24.com/rss" },
    { name: "Business Day", rssUrl: "https://www.businesslive.co.za/rss" },
  ],
  GH: [
    { name: "NPA Ghana", rssUrl: "https://www.npa.gov.gh/feed" },
    { name: "Graphic Online", rssUrl: "https://www.graphic.com.gh/rss.xml" },
    { name: "Joy News", rssUrl: "https://www.myjoyonline.com/feed/" },
  ],
  RW: [
    { name: "RRA Rwanda", rssUrl: "https://www.rra.gov.rw/feed" },
    { name: "The New Times", rssUrl: "https://www.newtimes.co.rw/rss.xml" },
  ],
  ET: [{ name: "Ethiopian News", rssUrl: "https://www.fanabc.com/feed" }],
  GLOBAL: [
    { name: "Energy Intelligence", rssUrl: "https://www.energyintel.com/rss" },
    {
      name: "Reuters Energy",
      rssUrl: "https://www.reuters.com/markets/commodities/energy/rss",
    },
    {
      name: "Platts Oil",
      rssUrl: "https://www.spglobal.com/commodityinsights/rss/oil",
    },
    { name: "OPEC News", rssUrl: "https://www.opec.org/rss/news.xml" },
  ],
};

// Keywords for categorizing news
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  price: [
    "price",
    "cost",
    "rate",
    "per litre",
    "per liter",
    "pump price",
    "wholesale",
    "retail price",
    "tariff",
    "hike",
    "drop",
    "increase",
    "decrease",
    "shilling",
    "naira",
    "rand",
  ],
  regulation: [
    "regulation",
    "policy",
    "law",
    "bill",
    "act",
    "compliance",
    "license",
    "permit",
    "authority",
    "regulatory",
    "legal",
    "mandatory",
    "requirement",
    "standard",
    "ban",
    "restriction",
  ],
  industry: [
    "refinery",
    "pipeline",
    "import",
    "export",
    "supply",
    "demand",
    "production",
    "reserves",
    "exploration",
    "drilling",
    "distribution",
    "storage",
    "terminal",
    "depot",
  ],
  technology: [
    "digital",
    "technology",
    "software",
    "automation",
    "system",
    "app",
    "online",
    "electronic",
    "smart",
    "iot",
    "monitoring",
    "pos",
    "payment",
  ],
  sustainability: [
    "green",
    "renewable",
    "solar",
    "ev",
    "electric vehicle",
    "carbon",
    "emission",
    "climate",
    "environment",
    "clean energy",
    "biofuel",
    "ethanol",
  ],
  market: [
    "market",
    "trading",
    "commodity",
    "brent",
    "wti",
    "crude",
    "futures",
    "stock",
    "share",
    "investment",
    "economic",
    "growth",
    "revenue",
  ],
  tax: [
    "tax",
    "vat",
    "levy",
    "duty",
    "excise",
    "kra",
    "ura",
    "tra",
    "firs",
    "sars",
    "rra",
    "gra",
    "revenue authority",
    "withholding",
  ],
};

function categorizeNews(
  title: string,
  summary: string,
): ExternalNewsItem["category"] {
  const text = (title + " " + summary).toLowerCase();
  const scores: Record<string, number> = {};

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = keywords.reduce((score, keyword) => {
      return score + (text.includes(keyword.toLowerCase()) ? 1 : 0);
    }, 0);
  }

  const bestCategory = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return (
    bestCategory[1] > 0 ? bestCategory[0] : "industry"
  ) as ExternalNewsItem["category"];
}

function determinePriority(
  title: string,
  summary: string,
): ExternalNewsItem["priority"] {
  const text = (title + " " + summary).toLowerCase();
  const highKeywords = [
    "urgent",
    "breaking",
    "alert",
    "mandatory",
    "must",
    "immediate",
    "critical",
    "important",
    "new law",
    "price change",
    "hike",
    "shutdown",
  ];
  if (highKeywords.some((k) => text.includes(k))) return "high";

  const mediumKeywords = [
    "update",
    "new",
    "announced",
    "launch",
    "introduce",
    "review",
    "adjustment",
  ];
  if (mediumKeywords.some((k) => text.includes(k))) return "medium";

  return "low";
}

// Parse RSS XML to news items
function parseRSS(
  xmlText: string,
  sourceName: string,
  countryCode: string,
): ExternalNewsItem[] {
  const items: ExternalNewsItem[] = [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const itemElements = doc.querySelectorAll("item");

    itemElements.forEach((item, index) => {
      if (index >= 10) return; // Max 10 per source

      const title = item.querySelector("title")?.textContent || "";
      const description = item.querySelector("description")?.textContent || "";
      const link = item.querySelector("link")?.textContent || "";
      const pubDate =
        item.querySelector("pubDate")?.textContent || new Date().toISOString();

      // Clean HTML from description
      const cleanSummary = description
        .replace(/<[^>]*>/g, "")
        .substring(0, 300);

      if (title && isFuelRelated(title, cleanSummary)) {
        items.push({
          id: `ext_${sourceName.replace(/\s+/g, "_")}_${index}_${Date.now()}`,
          title: title.substring(0, 200),
          summary: cleanSummary || title,
          category: categorizeNews(title, cleanSummary),
          source: sourceName,
          sourceUrl: link,
          publishedAt: new Date(pubDate).toISOString(),
          country: countryCode,
          priority: determinePriority(title, cleanSummary),
        });
      }
    });
  } catch (e) {
    console.warn(`Failed to parse RSS from ${sourceName}:`, e);
  }
  return items;
}

// Check if article is fuel/petroleum related
function isFuelRelated(title: string, summary: string): boolean {
  const fuelKeywords = [
    "fuel",
    "petrol",
    "diesel",
    "gasoline",
    "kerosene",
    "oil",
    "petroleum",
    "pump",
    "station",
    "energy",
    "gas",
    "lpg",
    "cng",
    "electric",
    "power",
    "mpesa",
    "price",
    "kra",
    "ura",
    "tra",
    "firs",
    "sars",
    "tax",
    "levy",
    "refinery",
    "pipeline",
    "epra",
    "ewura",
    "npa",
    "nnpc",
    "dangote",
    "vat",
    "excise",
    "duty",
    "regulation",
    "compliance",
    "license",
    "renewable",
    "solar",
    "ev charging",
    "carbon",
    "emission",
    "opec",
    "brent",
    "wti",
    "crude",
  ];
  const text = (title + " " + summary).toLowerCase();
  return fuelKeywords.some((kw) => text.includes(kw.toLowerCase()));
}

// Fetch RSS feed via CORS proxy
async function fetchRSS(url: string): Promise<string | null> {
  // Use a CORS proxy service
  const corsProxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];

  for (const proxyUrl of corsProxies) {
    try {
      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      });
      if (response.ok) {
        const text = await response.text();
        if (text.includes("<item") || text.includes("<entry")) {
          return text;
        }
      }
    } catch {
      // Try next proxy
      continue;
    }
  }
  return null;
}

// Resolve user's country for news
function resolveCountryCode(): string {
  try {
    const saved = localStorage.getItem("fuelpro_location_country");
    if (saved) {
      const parsed = JSON.parse(saved);
      const cc = parsed.currentCountry || parsed.country;
      if (cc) return cc.toUpperCase();
    }
  } catch {
    /* */
  }
  return "US";
}

// Main news fetch function - supports ALL countries dynamically
export async function fetchExternalNews(
  countryCode?: string,
): Promise<ExternalNewsItem[]> {
  const allNews: ExternalNewsItem[] = [];
  const cc = (countryCode || resolveCountryCode()).toUpperCase();
  const sources = NEWS_SOURCES[cc] || NEWS_SOURCES["GLOBAL"];

  // Fetch country-specific sources
  for (const source of sources) {
    if (source.rssUrl) {
      const xml = await fetchRSS(source.rssUrl);
      if (xml) {
        const items = parseRSS(xml, source.name, countryCode);
        allNews.push(...items);
      }
    }
  }

  // Fetch global sources
  for (const source of NEWS_SOURCES["GLOBAL"] || []) {
    if (source.rssUrl) {
      const xml = await fetchRSS(source.rssUrl);
      if (xml) {
        const items = parseRSS(xml, source.name, "GLOBAL");
        allNews.push(...items);
      }
    }
  }

  // Sort by date, remove duplicates by title similarity
  const unique = removeDuplicates(allNews);
  return unique.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

function removeDuplicates(items: ExternalNewsItem[]): ExternalNewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Store fetched news
export function storeExternalNews(news: ExternalNewsItem[]) {
  try {
    localStorage.setItem(NEWS_STORAGE_KEY, JSON.stringify(news));
    localStorage.setItem(LAST_FETCH_KEY, Date.now().toString());
  } catch (e) {
    console.warn("Failed to store news:", e);
  }
}

// Load stored news
export function loadExternalNews(): ExternalNewsItem[] {
  try {
    const raw = localStorage.getItem(NEWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Check if fetch is needed
export function shouldFetchNews(): boolean {
  try {
    const lastFetch = parseInt(localStorage.getItem(LAST_FETCH_KEY) || "0");
    return Date.now() - lastFetch > FETCH_INTERVAL;
  } catch {
    return true;
  }
}

// Get last fetch time
export function getLastFetchTime(): Date | null {
  try {
    const lastFetch = parseInt(localStorage.getItem(LAST_FETCH_KEY) || "0");
    return lastFetch ? new Date(lastFetch) : null;
  } catch {
    return null;
  }
}

// Auto-fetch wrapper
export async function autoFetchNews(
  countryCode?: string,
): Promise<ExternalNewsItem[]> {
  if (!shouldFetchNews()) {
    return loadExternalNews();
  }

  const news = await fetchExternalNews(countryCode);
  if (news.length > 0) {
    storeExternalNews(news);
  }
  return news.length > 0 ? news : loadExternalNews();
}

export default {
  fetchExternalNews,
  storeExternalNews,
  loadExternalNews,
  shouldFetchNews,
  autoFetchNews,
  getLastFetchTime,
};
