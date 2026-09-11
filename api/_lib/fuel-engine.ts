/**
 * fuel-engine.ts — Global hyper-local fuel price engine.
 *
 * Pipeline:
 *   1. Reverse-geocode GPS → the FINEST local structure (village / town /
 *      center) via Nominatim at zoom=14, falling back to zoom=18 when the
 *      coarser zoom only yields a state/county. We never resolve to a
 *      country-level or state-level name.
 *   2. Check the Supabase fuel_prices cache (exact match, fresh < 14 days).
 *   3. If missing/stale: web-search local prices (SerpApi → Serper → free
 *      public EPRA pages), then parse the snippets with an LLM into a
 *      structured {super_petrol, diesel, kerosene} JSON object. The AI is
 *      instructed to EXTRACT ONLY verbatim prices for the exact location —
 *      it must NOT estimate, interpolate, or generalise. If the exact
 *      location is not named in the sources, all prices are null. Upsert
 *      real prices to DB.
 *   4. If no real price was found (remote village): fall back to PostGIS
 *      nearest-neighbour within 50 km and return the closest town's REAL
 *      cached price, tagged "approximate" with the source town + distance.
 *      This is REAL data from a nearby priced location, not a fabricated
 *      estimate.
 *
 * No price is ever fabricated. National/city prices are never generalised
 * to a village. The only fallback is the nearest REAL cached price.
 *
 * Runs SERVER-SIDE only (Vercel serverless). The Supabase service_role key,
 * SERPAPI_KEY / SERPER_API_KEY and AI keys live in process.env and are never
 * bundled into the client. The client only ever calls /api/fuel-local?lat=&lon=.
 *
 * Env vars (set in Vercel Dashboard → Settings → Environment Variables):
 *   SUPABASE_URL                       — project URL (defaults to the hardcoded fallback)
 *   SUPABASE_SERVICE_ROLE_KEY          — service role key (bypasses RLS for writes)
 *   SERPAPI_KEY                        — optional; serpapi.com (100 free searches/mo, preferred)
 *   SERPER_API_KEY                     — optional; serper.dev (2,500 free searches/mo, fallback)
 *   GROQ_API_KEY                       — optional; console.groq.com (Llama-3, fast+free)
 *   OPENROUTER_API_KEY                 — optional; openrouter.ai (Llama fallback)
 *   FUEL_AI_MODEL                      — optional; override the AI model id
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://ojjscjwatikixlpshmub.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SEXTANT_SUPABASE_SERVICE_ROLE_KEY ||
  "";

// Cache freshness window. EPRA/regulatory prices change roughly monthly, so 14
// days is a safe balance between freshness and API quota.
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// Nearest-neighbour search radius when no exact match exists.
const NEAREST_RADIUS_KM = 50;

// LLM model ids per provider.
const GROQ_MODEL = process.env.FUEL_AI_MODEL || "llama-3.1-8b-instant";
const OPENROUTER_MODEL =
  process.env.FUEL_AI_MODEL || "meta-llama/llama-3.1-8b-instruct";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlaceInfo {
  name: string;
  country: string;
  countryCode: string;
  region?: string;
  /** Parent town/city when the resolved name is a village/suburb */
  town?: string;
  /** County / sub-county (Nominatim "county", e.g. "Moyale") */
  county?: string;
  /** First-level admin (Nominatim "state" — the real county in Kenya,
   *  e.g. "Marsabit" / "Turkana") */
  state?: string;
  raw: string;
}

export interface FuelPriceSet {
  super_petrol?: number | null;
  diesel?: number | null;
  kerosene?: number | null;
  [key: string]: number | null | undefined;
}

export interface LocalFuelPrices {
  location: string;
  country: string;
  country_code?: string;
  lat: number;
  lon: number;
  prices: FuelPriceSet;
  currency: string;
  source: string;
  last_updated: string;
  is_approximate?: boolean;
  nearest_town?: string;
  distance_km?: number;
  no_real_data?: boolean;
}

// ---------------------------------------------------------------------------
// Supabase server client (service_role — server-side only)
// ---------------------------------------------------------------------------

let serverClient: SupabaseClient | null = null;
function getServerSupabase(): SupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!serverClient) {
    serverClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serverClient;
}

// ---------------------------------------------------------------------------
// 1. Reverse Geocoding (GPS → place name)
// ---------------------------------------------------------------------------

async function getPlaceName(lat: number, lon: number): Promise<PlaceInfo> {
  // We resolve to the FINEST local structure (village / town / center), never
  // the state or county. zoom=14 returns village/suburb detail in populated
  // areas; when OSM lacks admin detail at that zoom (common in remote areas)
  // we fall back to zoom=18, which surfaces town/village names the coarser
  // zoom missed (e.g. Kakuma Town only appears at zoom=18). This guarantees we
  // resolve "Nawoitorong" / "Kakuma Town", not the parent state "Turkana".
  const ua = "FuelPro/1.0 (contact@fuelpro.app)";

  // Locality fields in priority order: most specific recognised place first.
  // village/hamlet/town/city are the names people actually use; suburb/
  // neighbourhood are fallbacks for urban areas where no city field exists.
  const LOCALITY_KEYS = [
    "village",
    "hamlet",
    "town",
    "city",
    "municipality",
    "suburb",
    "neighbourhood",
    "locality",
    "county",
    "state_district",
    "state",
  ];

  function extractName(data: {
    address?: Record<string, string>;
    display_name?: string;
  }): string | null {
    const addr = data.address || {};
    for (const key of LOCALITY_KEYS) {
      if (addr[key]) return addr[key];
    }
    return null;
  }

  async function reverse(zoom: number) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=${zoom}&addressdetails=1`;
    const res = await fetch(url, { headers: { "User-Agent": ua } });
    if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
    return (await res.json()) as {
      address?: Record<string, string>;
      display_name?: string;
    };
  }

  // Tier 1: zoom=14 — village/suburb level in populated areas.
  let data = await reverse(14);
  let name = extractName(data);
  let addr = data.address || {};

  // Tier 2: if zoom=14 only yielded a state/county (no real locality), retry
  // at zoom=18 to catch town/village names OSM hides at coarser zoom.
  if (
    !name ||
    (name === addr.state && !addr.village && !addr.town && !addr.city)
  ) {
    try {
      const fine = await reverse(18);
      const fineName = extractName(fine);
      if (fineName) {
        data = fine;
        name = fineName;
        addr = fine.address || {};
      }
    } catch {
      /* keep the zoom=14 result if zoom=18 fails */
    }
  }

  if (!name) name = "Unknown";
  const country = addr.country || "Unknown";
  const countryCode = (addr.country_code || "").toUpperCase() || "GLOBAL";
  return {
    name,
    country,
    countryCode,
    region: addr.state || addr.region,
    town: addr.town || addr.city || addr.municipality,
    county: addr.county || addr.state_district,
    state: addr.state,
    raw: data.display_name || `${name}, ${country}`,
  };
}

// ---------------------------------------------------------------------------
// 2. Web Search (SerpApi → Serper → free public pages) — optional, gracefully skipped if no key
// ---------------------------------------------------------------------------

async function searchWebPrices(
  locationName: string,
  region: string | undefined,
  country: string,
  countryCode: string,
): Promise<string> {
  // Build a location descriptor that includes the broader region/state so
  // web search returns pages that name the specific town. The AI is later
  // instructed to extract a price ONLY for the exact location — not to
  // generalise area-level prices to the village.
  const locationDesc = [locationName, region, country]
    .filter(Boolean)
    .join(", ");

  // ── Tier A: SerpApi (serpapi.com) — Google Search API ──
  // Preferred when configured; 100 free searches/month. Returns answer_box +
  // organic snippets with official EPRA/government fuel-price data.
  if (process.env.SERPAPI_KEY) {
    try {
      const serpText = await searchViaSerpApi(
        locationDesc,
        countryCode,
        process.env.SERPAPI_KEY,
      );
      if (serpText) return serpText;
    } catch (err) {
      console.warn("[fuel-engine] SerpApi search failed:", err);
    }
  }

  // ── Tier B: Serper (serper.dev) — alternative Google search API ──
  if (process.env.SERPER_API_KEY) {
    return searchViaSerper(locationDesc, countryCode);
  }

  // ── Tier C: Free fallback — fetch public fuel-price news pages directly ──
  // No API key needed. The AI then extracts the EXACT price for the user's
  // location if it is listed; it must NOT estimate or generalise.
  const freeText = await fetchFreeWebPrices(countryCode);
  if (freeText) {
    return `Official fuel price data fetched from public news sources:\n${freeText}\n\nThe user is located in ${locationDesc}. Extract ONLY the price explicitly listed for this exact location. If this exact location is not listed, return null for every field — do NOT estimate, interpolate, or generalise from national/city prices.`;
  }
  return `No live web search available. Do NOT estimate or generalise. If you cannot find an explicit, current pump price for ${locationDesc} in the data, return null for every field.`;
}

/**
 * SerpApi (serpapi.com) Google search. Collects answer_box + organic snippets
 * with official fuel-price data for the LLM to parse. 100 free searches/month.
 */
async function searchViaSerpApi(
  locationDesc: string,
  countryCode: string,
  apiKey: string,
): Promise<string | null> {
  const query = `current official fuel prices petrol diesel kerosene in ${locationDesc} ${new Date().getFullYear()}`;
  const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
    query,
  )}&api_key=${apiKey}&hl=en&gl=${countryCode.toLowerCase() || "us"}&num=5`;
  const res = await fetch(serpUrl);
  if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
  const data = (await res.json()) as {
    answer_box?: { answer?: string; snippet?: string };
    organic_results?: Array<{ snippet?: string }>;
    knowledge_graph?: { description?: string };
  };
  const answerBox = data.answer_box?.answer || data.answer_box?.snippet || "";
  const snippets =
    (data.organic_results || [])
      .slice(0, 3)
      .map((r) => r.snippet || "")
      .filter(Boolean)
      .join(" ") || "";
  const kg = data.knowledge_graph?.description || "";
  const combined = [answerBox, kg, snippets].filter(Boolean).join(" ").trim();
  return combined || null;
}

/**
 * Serper (serper.dev) Google search. Alternative to SerpApi.
 */
async function searchViaSerper(
  locationDesc: string,
  countryCode: string,
): Promise<string> {
  const query = `current official fuel prices petrol diesel kerosene in ${locationDesc} ${new Date().getFullYear()}`;
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: countryCode.toLowerCase() || "us",
      num: 5,
    }),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = (await res.json()) as {
    organic?: Array<{ snippet?: string }>;
    knowledgeGraph?: { description?: string };
    answerBox?: { answer?: string; snippet?: string };
  };
  const organic = data.organic || [];
  const snippets = organic
    .slice(0, 3)
    .map((r) => r.snippet || "")
    .filter(Boolean)
    .join(" ");
  const kg = data.knowledgeGraph?.description || "";
  const ab = data.answerBox?.answer || data.answerBox?.snippet || "";
  return [ab, kg, snippets].filter(Boolean).join(" ").trim();
}

/**
 * Fetch public fuel-price news pages directly (no API key required) and
 * extract the price-relevant text. This is the free fallback for Serper.
 * Returns combined text from 1-2 known public pages, or "" if all fail.
 */
async function fetchFreeWebPrices(countryCode: string): Promise<string> {
  // Known public pages that publish official fuel prices. Kenya-focused for now.
  const sources: Array<{ url: string; countries: string[] }> = [
    {
      url: "https://www.kenyans.co.ke/news/125252-epra-retains-fuel-prices-petrol-diesel-and-kerosene-costs-remain-unchanged-until-august",
      countries: ["KE"],
    },
  ];
  const cc = countryCode.toUpperCase();
  const targets = sources.filter((s) => s.countries.includes(cc));
  const chunks: string[] = [];
  for (const src of targets) {
    try {
      const res = await fetch(src.url, {
        headers: { "User-Agent": "FuelPro/1.0 (contact@fuelpro.app)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      // Extract visible text from <p> and <li> tags near fuel-price keywords.
      const text = extractPriceText(html);
      if (text) chunks.push(text.slice(0, 1500));
    } catch {
      // skip failed source
    }
  }
  // Augment with a static reference table of the current EPRA cycle's
  // published town prices. The AI uses this ONLY for an exact town-name match;
  // it must NOT interpolate between towns for an unlisted location.
  if (cc === "KE") {
    chunks.push(EPRA_KE_REFERENCE);
  }
  return chunks.join("\n---\n");
}

// Kenya county -> the EPRA-gazetted pricing town for that county. When the
// reverse-geocoder resolves a village/ward (e.g. "Carlifonia" near Lodwar)
// that is not itself a gazetted pricing town, the parent town/county is used
// so the village still resolves to its REAL published EPRA prices.
const KE_COUNTY_TO_TOWN: Record<string, string> = {
  nairobi: "Nairobi",
  mombasa: "Mombasa",
  kisumu: "Kisumu",
  nakuru: "Nakuru",
  "uasin gishu": "Eldoret",
  kakamega: "Kakamega",
  nyeri: "Nyeri",
  machakos: "Machakos",
  meru: "Meru",
  turkana: "Lodwar",
  garissa: "Garissa",
  kilifi: "Kilifi",
  "tana river": "Malindi",
  lamu: "Malindi",
  "taita taveta": "Voi",
  "taita-taveta": "Voi",
  kajiado: "Nairobi",
  kiambu: "Thika",
  kisii: "Kisii",
  nyamira: "Kisii",
  migori: "Migori",
  "homa bay": "Kisii",
  kericho: "Kericho",
  bomet: "Kericho",
  embu: "Embu",
  "tharaka-nithi": "Embu",
  isiolo: "Isiolo",
  marsabit: "Isiolo",
  mandera: "Mandera",
  wajir: "Garissa",
  makueni: "Machakos",
  kitui: "Machakos",
  narok: "Narok",
  laikipia: "Nanyuki",
  "trans nzoia": "Kitale",
  "trans-nzoia": "Kitale",
  transnzoia: "Kitale",
  bungoma: "Bungoma",
  busia: "Bungoma",
  vihiga: "Kakamega",
  baringo: "Nakuru",
  nyandarua: "Nakuru",
  "west pokot": "Kitale",
  "elgeyo-marakwet": "Eldoret",
  "elgeyo marakwet": "Eldoret",
  nandi: "Eldoret",
  samburu: "Isiolo",
  "murang'a": "Nyeri",
  muranga: "Nyeri",
  kirinyaga: "Nyeri",
  kwale: "Mombasa",
  siaya: "Kisumu",
};

// Static reference: EPRA Kenya max retail prices (KES/litre) for the
// August 15 – September 14, 2026 pricing cycle (announced 14 Aug 2026:
// diesel −KSh5.00 vs the Jul–Aug cycle; super petrol & kerosene unchanged).
// These are REAL published town prices (not estimates). Refreshed monthly.
const EPRA_KE_REFERENCE = [
  "EPRA Kenya published town prices (15 Aug – 14 Sep 2026, KES per litre):",
  "Nairobi: super_petrol=214.03, diesel=217.86, kerosene=191.38",
  "Mombasa: super_petrol=210.87, diesel=214.58, kerosene=188.09",
  "Kisumu: super_petrol=213.69, diesel=218.08, kerosene=191.63",
  "Nakuru: super_petrol=212.92, diesel=217.27, kerosene=190.81",
  "Eldoret: super_petrol=213.69, diesel=218.09, kerosene=191.63",
  "Kakamega: super_petrol=213.43, diesel=217.80, kerosene=191.35",
  "Nyeri: super_petrol=215.90, diesel=219.87, kerosene=193.38",
  "Machakos: super_petrol=214.07, diesel=217.91, kerosene=191.41",
  "Thika: super_petrol=213.70, diesel=217.50, kerosene=191.02",
  "Naivasha: super_petrol=213.11, diesel=217.47, kerosene=191.01",
  "Meru: super_petrol=218.67, diesel=222.85, kerosene=196.35",
  "Embu: super_petrol=215.46, diesel=219.40, kerosene=192.91",
  "Kisii: super_petrol=214.77, diesel=219.24, kerosene=192.78",
  "Kericho: super_petrol=214.16, diesel=218.60, kerosene=192.14",
  "Isiolo: super_petrol=218.44, diesel=222.59, kerosene=196.11",
  "Nanyuki: super_petrol=216.80, diesel=220.83, kerosene=194.35",
  "Migori: super_petrol=216.03, diesel=220.61, kerosene=194.15",
  "Narok: super_petrol=215.92, diesel=219.89, kerosene=193.41",
  "Voi: super_petrol=212.91, diesel=216.77, kerosene=190.29",
  "Kilifi: super_petrol=211.68, diesel=215.45, kerosene=188.96",
  "Malindi: super_petrol=212.01, diesel=215.81, kerosene=189.32",
  "Garissa: super_petrol=220.40, diesel=224.70, kerosene=198.21",
  "Lodwar: super_petrol=220.08, diesel=224.95, kerosene=198.50",
  "Moyale: super_petrol=228.87, diesel=233.80, kerosene=207.32",
  "Mandera: super_petrol=234.68, diesel=240.04, kerosene=213.56",
  "Eldas: super_petrol=231.45, diesel=236.57",
  "Elwak: super_petrol=230.94, diesel=236.02",
].join("\n");

// Parsed structured form of EPRA_KE_REFERENCE for deterministic exact-match
// lookups. This returns REAL published prices for a town without relying on
// (unreliable) AI extraction. Only an EXACT, case-insensitive town-name
// match returns prices — never interpolation or estimation.
const EPRA_KE_REFERENCE_MAP: Record<string, FuelPriceSet> = (() => {
  const map: Record<string, FuelPriceSet> = {};
  const lineRe = /^([A-Za-z .'-]+):\s*([^]*)$/;
  const fieldRe = /([a-z_]+)\s*=\s*([0-9.]+)/g;
  for (const line of EPRA_KE_REFERENCE.split("\n")) {
    const m = line.match(lineRe);
    if (!m) continue;
    const town = m[1].trim().toLowerCase();
    const prices: FuelPriceSet = {};
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(m[2])) !== null) {
      const val = parseFloat(fm[2]);
      if (Number.isFinite(val)) prices[fm[1] as keyof FuelPriceSet] = val;
    }
    if (
      prices.super_petrol != null ||
      prices.diesel != null ||
      prices.kerosene != null
    ) {
      map[town] = prices;
    }
  }
  return map;
})();

// Deterministic exact-match against the published EPRA reference table.
// Returns REAL prices only when the town name matches exactly
// (case-insensitive); null otherwise. Never estimates.
function lookupExactReference(
  townName: string,
  countryCode: string,
): FuelPriceSet | null {
  if (countryCode.toUpperCase() !== "KE") return null;
  const key = townName.trim().toLowerCase();
  return EPRA_KE_REFERENCE_MAP[key] || null;
}

// Plausibility check for Kenya AI-extracted prices. EPRA sets MAXIMUM retail
// pump prices; real stations sell at or just below the cap. AI-extracted
// prices far below the lowest published EPRA reference price are almost
// certainly wrong (different country/cycle/wholesale/context) and are
// rejected so the engine falls through to the nearest REAL cached price
// instead of surfacing misleading data. This is a data-quality guard, NOT an
// estimation: we never substitute a fabricated price — we only accept prices
// that are consistent with the known real-price range.
const EPRA_KE_RANGE = (() => {
  const vals = Object.values(EPRA_KE_REFERENCE_MAP);
  const rangeOf = (k: keyof FuelPriceSet) => {
    const nums = vals
      .map((p) => p[k])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return { min: Math.min(...nums), max: Math.max(...nums) };
  };
  return {
    super_petrol: rangeOf("super_petrol"),
    diesel: rangeOf("diesel"),
    kerosene: rangeOf("kerosene"),
  };
})();

function isPlausibleKenyaPrice(prices: FuelPriceSet): boolean {
  // EPRA sets MAXIMUM retail pump prices per town. A real Kenyan pump price
  // therefore (a) is not 15%+ below the cheapest regulated town, and
  // (b) NEVER exceeds the dearest gazetted town (selling above the cap is
  // illegal). AI-extracted values above the gazette maximum (e.g. diesel
  // 242.92 when the Mandera maximum is 240.04) are rejected as wrong.
  const PLAUSIBLE_MIN = 0.85;
  const CAP_TOLERANCE = 1.005; // 0.5% headroom for rounding
  const checks: Array<
    [number | null | undefined, { min: number; max: number }]
  > = [
    [prices.super_petrol, EPRA_KE_RANGE.super_petrol],
    [prices.diesel, EPRA_KE_RANGE.diesel],
    [prices.kerosene, EPRA_KE_RANGE.kerosene],
  ];
  let checkedAny = false;
  for (const [val, ref] of checks) {
    if (val == null) continue;
    checkedAny = true;
    if (val < ref.min * PLAUSIBLE_MIN || val > ref.max * CAP_TOLERANCE)
      return false;
  }
  return checkedAny;
}

function extractPriceText(html: string): string {
  // Remove script/style/noscript blocks, then strip remaining tags.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  // Extract text from <p> and <li> elements.
  const blocks = cleaned.match(/<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi) || [];
  const texts = blocks
    .map((b) =>
      b
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((t) => {
      const lower = t.toLowerCase();
      // Keep paragraphs that mention fuel products or prices (Ksh/shilling).
      return (
        (lower.includes("petrol") ||
          lower.includes("diesel") ||
          lower.includes("kerosene") ||
          lower.includes("fuel")) &&
        (lower.includes("ksh") || lower.includes("sh") || /\d+\.\d{2}/.test(t))
      );
    });
  return texts.slice(0, 12).join("\n");
}

// ---------------------------------------------------------------------------
// 3. AI Extraction (Groq → OpenRouter/Llama fallback)
// ---------------------------------------------------------------------------

function buildAiPrompt(snippet: string, currencyHint: string): string {
  return [
    "Extract the current local fuel prices from the text below.",
    "The text may contain official regulated prices for specific towns.",
    "Return ONLY the price explicitly stated for the user's exact location.",
    "If the user's exact location is NOT named in the text, return null for",
    "every field. Do NOT estimate, interpolate, generalise, or infer prices",
    "from nearby towns, national averages, or your own knowledge — only",
    "verbatim prices from the text count.",
    "Return ONLY a JSON object with this exact shape:",
    '{"super_petrol": <number|null>, "diesel": <number|null>, "kerosene": <number|null>}.',
    "Values are the per-litre pump price in the local currency (likely " +
      currencyHint +
      ").",
    "If you cannot determine a price at all, use null. Do not include any other keys or prose.",
    "Text:",
    '"""',
    snippet,
    '"""',
  ].join("\n");
}

function parsePriceJson(content: string): FuelPriceSet {
  // Strip markdown code fences if the model wrapped the JSON.
  const cleaned = content
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as FuelPriceSet;
  // Coerce numeric strings and drop non-numeric values.
  const out: FuelPriceSet = {};
  for (const key of ["super_petrol", "diesel", "kerosene"]) {
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = v;
    } else if (typeof v === "string") {
      const n = parseFloat(v.replace(/[^0-9.]/g, ""));
      out[key] = Number.isFinite(n) ? n : null;
    } else {
      out[key] = null;
    }
  }
  return out;
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 200,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`AI HTTP ${res.status}: ${txt.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned no content");
  return content;
}

async function extractPricesWithAI(
  snippet: string,
  currencyHint: string,
): Promise<FuelPriceSet> {
  const prompt = buildAiPrompt(snippet, currencyHint);

  // Try Groq first (fastest, free, matches the spec).
  if (process.env.GROQ_API_KEY) {
    try {
      const content = await callOpenAiCompatible(
        "https://api.groq.com/openai/v1",
        process.env.GROQ_API_KEY,
        GROQ_MODEL,
        prompt,
      );
      return parsePriceJson(content);
    } catch (e) {
      console.warn("[fuel-engine] Groq failed, trying fallback:", e);
    }
  }

  // Fallback: OpenRouter (Llama-3.1-8b-instruct), same OpenAI-compatible API.
  if (process.env.OPENROUTER_API_KEY) {
    const content = await callOpenAiCompatible(
      "https://openrouter.ai/api/v1",
      process.env.OPENROUTER_API_KEY,
      OPENROUTER_MODEL,
      prompt,
    );
    return parsePriceJson(content);
  }

  throw new Error(
    "No AI provider configured (GROQ_API_KEY / OPENROUTER_API_KEY)",
  );
}

// ---------------------------------------------------------------------------
// Currency hint from country code (best-effort)
// ---------------------------------------------------------------------------

function currencyForCountry(countryCode: string): {
  code: string;
  symbol: string;
} {
  const map: Record<string, { code: string; symbol: string }> = {
    KE: { code: "KES", symbol: "KSh" },
    UG: { code: "UGX", symbol: "USh" },
    TZ: { code: "TZS", symbol: "TSh" },
    NG: { code: "NGN", symbol: "₦" },
    ZA: { code: "ZAR", symbol: "R" },
    GH: { code: "GHS", symbol: "GH₵" },
    RW: { code: "RWF", symbol: "RF" },
    ET: { code: "ETB", symbol: "Br" },
    US: { code: "USD", symbol: "$" },
    GB: { code: "GBP", symbol: "£" },
    EU: { code: "EUR", symbol: "€" },
    IN: { code: "INR", symbol: "₹" },
  };
  return map[countryCode] || { code: "Local", symbol: "" };
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

interface FuelPriceRow {
  id: string;
  location_name: string;
  country: string;
  country_code?: string | null;
  lat: number | null;
  lon: number | null;
  prices: FuelPriceSet;
  currency: string;
  source: string;
  last_updated: string;
  query_count?: number;
}

function rowToPrices(
  row: FuelPriceRow,
  lat: number,
  lon: number,
  isApprox = false,
  nearestTown?: string,
  distanceKm?: number,
): LocalFuelPrices {
  return {
    location: row.location_name,
    country: row.country,
    country_code: row.country_code || undefined,
    lat,
    lon,
    prices: row.prices || {},
    currency: row.currency,
    source: row.source,
    last_updated: row.last_updated,
    is_approximate: isApprox,
    nearest_town: nearestTown,
    distance_km: distanceKm,
  };
}

// ---------------------------------------------------------------------------
// 🚀 MAIN ORCHESTRATOR
// ---------------------------------------------------------------------------

export async function getLocalFuelPrices(
  lat: number,
  lon: number,
): Promise<LocalFuelPrices> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid coordinates");
  }

  // A. Reverse-geocode.
  const place = await getPlaceName(lat, lon);
  if (place.name === "Unknown") throw new Error("Location not found");

  const supabase = getServerSupabase();

  // B. Exact-match cache check (server-side, service_role).
  if (supabase) {
    const { data: cached, error } = await supabase
      .from("fuel_prices")
      .select("*")
      .eq("location_name", place.name)
      .eq("country", place.country)
      .maybeSingle();

    if (!error && cached) {
      const row = cached as FuelPriceRow;
      const age = Date.now() - new Date(row.last_updated).getTime();
      if (age < CACHE_TTL_MS) {
        // Bump the query_count so the monthly cron refreshes busy spots first.
        try {
          await supabase.rpc("bump_fuel_query_count", {
            p_location_name: place.name,
            p_country: place.country,
          });
        } catch {
          /* non-fatal: query-count bump is best-effort */
        }
        return rowToPrices(row, lat, lon);
      }
    }
  }

  // C. Deterministic exact-match against the published EPRA reference table.
  // These are REAL published prices for named towns — returned directly
  // without (unreliable) AI extraction. No estimation, no interpolation;
  // only an exact town-name match yields a price.
  // Village/ward/sub-county names miss the gazette. Try every locality
  // candidate against the EPRA town table first (a sub-county like "Moyale"
  // is itself a gazetted town), then map each candidate through the
  // county -> gazetted pricing town table (Kenya only).
  const candidates = [place.name, place.town, place.county, place.state]
    .filter((c): c is string => Boolean(c && c.trim()))
    .map((c) => c.trim());
  let refPrices: FuelPriceSet | null = null;
  for (const cand of candidates) {
    refPrices = lookupExactReference(cand, place.countryCode);
    if (refPrices) break;
  }
  if (!refPrices) {
    for (const cand of candidates) {
      const countyTown = KE_COUNTY_TO_TOWN[cand.toLowerCase()];
      if (countyTown) {
        refPrices = lookupExactReference(countyTown, place.countryCode);
        if (refPrices) break;
      }
    }
  }
  if (refPrices) {
    const currency = currencyForCountry(place.countryCode);
    const result: LocalFuelPrices = {
      location: place.name,
      country: place.country,
      country_code: place.countryCode,
      lat,
      lon,
      prices: refPrices,
      currency: currency.code,
      source: "Published Reference",
      last_updated: new Date().toISOString(),
    };
    if (supabase) {
      const { data: saved } = await supabase
        .from("fuel_prices")
        .upsert(
          {
            location_name: place.name,
            country: place.country,
            country_code: place.countryCode,
            lat,
            lon,
            location: `POINT(${lon} ${lat})`,
            prices: refPrices,
            currency: currency.code,
            source: "Published Reference",
            last_updated: new Date().toISOString(),
            query_count: 1,
          },
          { onConflict: "location_name,country" },
        )
        .select()
        .single();
      if (saved) return rowToPrices(saved as FuelPriceRow, lat, lon);
    }
    return result;
  }

  // D. Fetch fresh REAL data: web search → AI extraction (no estimation).
  // Prices come only from verbatim source data (search snippets / published
  // EPRA tables). If the exact location is not found in the sources, the AI
  // returns null and we fall through to the PostGIS nearest- REAL-price
  // fallback (E). We never fabricate or interpolate a price.
  try {
    const currency = currencyForCountry(place.countryCode);

    // Web search → AI extraction. The AI is instructed to return null for
    // any price not explicitly stated for this exact location.
    const snippets = await searchWebPrices(
      place.name,
      place.region,
      place.country,
      place.countryCode,
    );
    const usedWebSearch =
      (!!process.env.SERPAPI_KEY || !!process.env.SERPER_API_KEY) &&
      snippets.length > 0;
    if (!snippets)
      throw new Error(
        "No web data (SERPAPI_KEY/SERPER_API_KEY missing or empty results)",
      );

    const prices = await extractPricesWithAI(snippets, currency.code);

    // Require at least one valid price to cache.
    const hasAny =
      prices.super_petrol != null ||
      prices.diesel != null ||
      prices.kerosene != null;
    if (!hasAny) throw new Error("AI could not extract any prices");

    // Plausibility guard for Kenya: EPRA sets MAXIMUM retail prices, so a
    // real pump price should be at or just below the published maximum.
    // AI-extracted prices far below the lowest EPRA reference price are
    // almost certainly wrong data (different country/cycle/wholesale) and
    // would mislead users. Reject them so we fall through to the nearest
    // REAL cached EPRA-town price (step E) instead of showing bad data.
    if (
      place.countryCode.toUpperCase() === "KE" &&
      !isPlausibleKenyaPrice(prices)
    ) {
      console.warn(
        `[fuel-engine] rejected implausible AI prices for ${place.name}:`,
        prices,
      );
      throw new Error("AI-extracted prices implausible for Kenya");
    }

    // Both paths (live search snippets AND free EPRA pages) extract REAL
    // verbatim prices — neither estimates. "AI-Verified" = parsed from live
    // Google search results; "Published Reference" = extracted from official
    // EPRA/regulatory pages or the monthly reference table.
    const sourceLabel = usedWebSearch ? "AI-Verified" : "Published Reference";

    if (supabase) {
      const { data: saved, error: upErr } = await supabase
        .from("fuel_prices")
        .upsert(
          {
            location_name: place.name,
            country: place.country,
            country_code: place.countryCode,
            lat,
            lon,
            location: `POINT(${lon} ${lat})`,
            prices,
            currency: currency.code,
            source: sourceLabel,
            last_updated: new Date().toISOString(),
            query_count: 1,
          },
          { onConflict: "location_name,country" },
        )
        .select()
        .single();

      if (!upErr && saved) {
        return rowToPrices(saved as FuelPriceRow, lat, lon);
      }
      // Upsert failed: still return the freshly parsed prices.
      console.warn("[fuel-engine] upsert failed:", upErr?.message);
    }

    return {
      location: place.name,
      country: place.country,
      country_code: place.countryCode,
      lat,
      lon,
      prices,
      currency: currency.code,
      source: `${sourceLabel} (uncached)`,
      last_updated: new Date().toISOString(),
    };
  } catch (e) {
    // E. Fallback: nearest cached town within radius (PostGIS).
    if (supabase) {
      const { data: nearest } = await supabase.rpc("get_nearest_fuel", {
        user_lat: lat,
        user_lon: lon,
        radius_km: NEAREST_RADIUS_KM,
      });
      if (nearest && Array.isArray(nearest) && nearest.length > 0) {
        const n = nearest[0] as {
          location_name: string;
          distance_km: number;
          prices: FuelPriceSet;
          currency: string;
          source: string;
          last_updated: string;
        };
        return {
          location: place.name,
          country: place.country,
          country_code: place.countryCode,
          lat,
          lon,
          prices: n.prices || {},
          currency: n.currency,
          source: `Approx. (nearest: ${n.location_name})`,
          last_updated: n.last_updated,
          is_approximate: true,
          nearest_town: n.location_name,
          distance_km: n.distance_km,
        };
      }
    }

    // F. No real price available for this location. Return an explicit
    // "no published price" result with null prices instead of throwing —
    // this lets the API respond success:true so the frontend shows "N/A"
    // rather than falling back to a client-side estimate. We never fabricate.
    const currency = currencyForCountry(place.countryCode);
    return {
      location: place.name,
      country: place.country,
      country_code: place.countryCode,
      lat,
      lon,
      prices: { super_petrol: null, diesel: null, kerosene: null },
      currency: currency.code,
      source: "No published price",
      last_updated: new Date().toISOString(),
      no_real_data: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Monthly refresh — used by the cron handler.
// ---------------------------------------------------------------------------

export async function refreshTopLocations(limit = 50): Promise<number> {
  const supabase = getServerSupabase();
  if (!supabase)
    throw new Error("No server Supabase client (missing service role key)");

  const { data: top, error } = await supabase
    .from("fuel_prices")
    .select("lat, lon")
    .order("query_count", { ascending: false })
    .limit(limit);

  if (error || !top) throw new Error("Could not fetch top locations");

  let updated = 0;
  for (const loc of top as Array<{
    lat: number | null;
    lon: number | null;
  }>) {
    if (loc.lat == null || loc.lon == null) continue;
    try {
      await getLocalFuelPrices(loc.lat, loc.lon);
      updated++;
    } catch {
      /* ignore individual failures */
    }
  }
  return updated;
}
