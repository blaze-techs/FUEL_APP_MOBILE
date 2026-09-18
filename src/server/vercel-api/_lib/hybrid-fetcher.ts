/**
 * Hybrid fuel-price fetcher — the "Smart-Cache" engine.
 *
 * Three-tier lookup strategy that minimises external API usage:
 *
 *  1. EXACT CACHE:  a row in `fuel_prices` matching (location_name, country)
 *     that was refreshed within FRESH_WINDOW days. Instant, costs nothing.
 *
 *  2. NEAREST TOWN:  PostGIS `get_nearest_fuel_prices` RPC finds the closest
 *     cached location within SEARCH_RADIUS_KM. If it's fresh, serve it with a
 *     "N km away" label. This is what lets a user in a tiny village 10km from
 *     Lodwar get the Lodwar price WITHOUT spending a SerpApi search.
 *
 *  3. LIVE AI SEARCH:  only when there is NO cached data within the radius.
 *     SerpApi scrapes Google for official fuel-price results, then an LLM
 *     (Groq llama-3.1-8b-instant, or DeepSeek as a fallback) extracts
 *     structured { petrol, diesel, kerosene, currency } from the snippets.
 *     The result is upserted into `fuel_prices` so future lookups hit tier 1/2.
 *
 * SerpApi free tier is 100 searches/month — tiers 1 & 2 ensure those searches
 * are only consumed for genuinely new, isolated locations.
 */
import { supabaseAdmin } from "./supabase-admin.js";

const FRESH_WINDOW_MS = 15 * 24 * 60 * 60 * 1000; // 15 days
const SEARCH_RADIUS_KM = 50;

export interface HyperLocalPriceResult {
  location_name: string;
  country: string;
  latitude: number;
  longitude: number;
  prices: {
    petrol: number | null;
    diesel: number | null;
    kerosene: number | null;
  };
  currency: string;
  source: string;
  last_updated: string;
  distance_km?: number;
}

interface FuelPricesRow {
  id: string;
  location_name: string;
  country: string;
  lat: number | null;
  lon: number | null;
  prices: Record<string, number | null> | null;
  currency: string | null;
  source: string | null;
  last_updated: string;
  query_count: number;
}

interface NearestRpcRow {
  location_name: string;
  country: string;
  distance_km: number;
  prices: Record<string, number | null> | null;
  currency: string | null;
  last_updated: string;
}

function isFresh(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < FRESH_WINDOW_MS;
}

// Cached rows may store the petrol price under either `super_petrol` (written
// by api/_lib/fuel-engine.ts) or `petrol` (written by this fetcher). Read both
// so the nearest-neighbour fallback works regardless of which engine wrote
// the row.
function petrolOf(
  p: Record<string, number | null> | null | undefined,
): number | null {
  if (!p) return null;
  if (p.super_petrol != null) return p.super_petrol;
  return p.petrol ?? null;
}

function rowToResult(
  row: FuelPricesRow,
  source: string,
  distanceKm?: number,
): HyperLocalPriceResult {
  const p = row.prices || {};
  return {
    location_name: row.location_name,
    country: row.country,
    latitude: row.lat ?? 0,
    longitude: row.lon ?? 0,
    prices: {
      petrol: petrolOf(p),
      diesel: p.diesel ?? null,
      kerosene: p.kerosene ?? null,
    },
    currency: row.currency || "Local",
    source,
    last_updated: row.last_updated,
    distance_km: distanceKm,
  };
}

export async function getHyperLocalPrices(
  lat: number,
  lon: number,
  locationName: string,
  country: string,
): Promise<HyperLocalPriceResult> {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }

  // ── Tier 1: Exact cache ──
  const { data: exactMatch, error: exactErr } = await supabaseAdmin
    .from("fuel_prices")
    .select("*")
    .eq("location_name", locationName)
    .eq("country", country)
    .maybeSingle();

  if (exactErr) {
    console.error("[hybrid-fetcher] exact cache error:", exactErr.message);
  }

  if (exactMatch && isFresh(exactMatch.last_updated)) {
    // Bump the query_count so the cron refreshes the most popular locations.
    await supabaseAdmin
      .from("fuel_prices")
      .update({ query_count: (exactMatch as FuelPricesRow).query_count + 1 })
      .eq("id", (exactMatch as FuelPricesRow).id);
    return rowToResult(exactMatch as FuelPricesRow, "Exact Cache");
  }

  // ── Tier 2: Nearest cached town (PostGIS spatial fallback) ──
  // Returns the closest cached location's REAL price within the radius. This
  // is real data from a nearby priced location (labelled with distance), not
  // a fabricated estimate. The RPC is `get_nearest_fuel` (singular) — the
  // variant defined in migration 012.
  const { data: nearestRows, error: rpcErr } = await supabaseAdmin.rpc(
    "get_nearest_fuel",
    {
      user_lat: lat,
      user_lon: lon,
      radius_km: SEARCH_RADIUS_KM,
    },
  );

  if (rpcErr) {
    console.error("[hybrid-fetcher] RPC error:", rpcErr.message);
  }

  if (nearestRows && (nearestRows as NearestRpcRow[]).length > 0) {
    const nearest = (nearestRows as NearestRpcRow[])[0];
    if (isFresh(nearest.last_updated)) {
      return {
        location_name: nearest.location_name,
        country: nearest.country,
        latitude: lat,
        longitude: lon,
        prices: {
          petrol: petrolOf(nearest.prices),
          diesel: nearest.prices?.diesel ?? null,
          kerosene: nearest.prices?.kerosene ?? null,
        },
        currency: nearest.currency || "Local",
        source: `Nearest Town (${nearest.distance_km.toFixed(1)} km away)`,
        last_updated: nearest.last_updated,
        distance_km: nearest.distance_km,
      };
    }
  }

  // ── Tier 3: Live AI search (SerpApi + LLM extraction) ──
  // The AI EXTRACTS verbatim prices from search snippets — it must NOT
  // estimate or generalise. If no real price is found, we throw and the
  // caller surfaces "no data" rather than a fabricated estimate.
  return fetchAndCachePrices(lat, lon, locationName, country);
}

async function fetchAndCachePrices(
  lat: number,
  lon: number,
  locationName: string,
  country: string,
): Promise<HyperLocalPriceResult> {
  if (!supabaseAdmin) {
    throw new Error("Supabase admin client is not configured.");
  }
  const serpapiKey = process.env.SERPAPI_KEY;
  let prices: ExtractedPrices | null = null;

  if (serpapiKey) {
    prices = await extractPricesViaSearch(locationName, country, serpapiKey);
  }

  // No estimation fallback: if SerpApi is not configured or returned no usable
  // snippets, we do NOT ask the AI to guess from its training knowledge. We
  // surface "no real data available" rather than fabricate a price.
  if (!prices) {
    throw new Error(
      `No real fuel price data available for ${locationName}, ${country}. ` +
        "SerpApi key is missing or returned no usable snippets. " +
        "No estimation is performed — pass coordinates near a cached location " +
        "or configure SERPAPI_KEY.",
    );
  }

  // Upsert into the cache (the trigger auto-populates the `location` geography
  // column from lat/lon).
  const { data: upserted, error: upsertErr } = await supabaseAdmin
    .from("fuel_prices")
    .upsert(
      {
        location_name: locationName,
        country,
        lat,
        lon,
        prices: {
          petrol: prices.petrol,
          diesel: prices.diesel,
          kerosene: prices.kerosene,
        },
        currency: prices.currency,
        source: "AI-Verified",
        last_updated: new Date().toISOString(),
        query_count: 1,
      },
      { onConflict: "location_name,country" },
    )
    .select("*")
    .maybeSingle();

  if (upsertErr) {
    console.error("[hybrid-fetcher] upsert error:", upsertErr.message);
  }

  if (upserted) {
    return rowToResult(upserted as FuelPricesRow, "AI-Verified");
  }

  // Even if the upsert failed, return what we extracted so the user sees data.
  return {
    location_name: locationName,
    country,
    latitude: lat,
    longitude: lon,
    prices: {
      petrol: prices.petrol,
      diesel: prices.diesel,
      kerosene: prices.kerosene,
    },
    currency: prices.currency,
    source: "AI-Verified (uncached)",
    last_updated: new Date().toISOString(),
  };
}

interface ExtractedPrices {
  petrol: number | null;
  diesel: number | null;
  kerosene: number | null;
  currency: string;
}

/**
 * SerpApi → LLM pipeline:
 *  1. Google search via SerpApi for official fuel prices in the location.
 *  2. Collect answer_box + organic snippets.
 *  3. Ask an LLM to extract structured prices from the raw text.
 */
async function extractPricesViaSearch(
  locationName: string,
  country: string,
  serpapiKey: string,
): Promise<ExtractedPrices | null> {
  const query = `official government fuel petrol diesel kerosene price in ${locationName} ${country}`;
  const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
    query,
  )}&api_key=${serpapiKey}&hl=en`;

  const serpRes = await fetch(serpUrl);
  if (!serpRes.ok) {
    console.error("[hybrid-fetcher] SerpApi error:", serpRes.status);
    return null;
  }
  const serpJson: any = await serpRes.json();

  const answerBox = serpJson.answer_box?.answer || serpJson.answer_box?.snippet;
  const snippets =
    (serpJson.organic_results as Array<{ snippet?: string }> | undefined)
      ?.slice(0, 3)
      .map((r) => r.snippet)
      .filter(Boolean)
      .join("\n") || "";

  const combined = `${answerBox || ""}\n${snippets}`.trim();
  if (!combined) {
    console.warn("[hybrid-fetcher] No search snippets found for", locationName);
    return null;
  }

  return extractPricesWithAI(combined);
}

async function extractPricesWithAI(
  text: string,
): Promise<ExtractedPrices | null> {
  // Prefer Groq (fast + free tier), then DeepSeek, then QWEN via OpenRouter.
  const groqKey = process.env.GROQ_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK;
  const qwenKey = process.env.QWEN_API_KEY || process.env.QWEN;

  if (groqKey) {
    const result = await callGroq(text, groqKey);
    if (result) return result;
  }

  if (deepseekKey) {
    const result = await callDeepSeek(text, deepseekKey);
    if (result) return result;
  }

  if (qwenKey) {
    const result = await callQwen(text, qwenKey);
    if (result) return result;
  }

  console.warn("[hybrid-fetcher] No AI provider available for extraction.");
  return null;
}

const EXTRACTION_SYSTEM_PROMPT =
  "Extract the Super Petrol, Diesel, and Kerosene prices explicitly stated " +
  "for the user's exact location from the text. Pay attention to local " +
  "currencies. If the exact location is NOT named in the text, return null " +
  "for every field. Do NOT estimate, interpolate, or generalise from nearby " +
  "towns, national averages, or your own knowledge — only verbatim prices " +
  "from the text count. " +
  'Return ONLY valid JSON: { "petrol": number|null, "diesel": number|null, "kerosene": number|null, "currency": string }';

async function callGroq(
  text: string,
  apiKey: string,
): Promise<ExtractedPrices | null> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!res.ok) {
      console.error("[hybrid-fetcher] Groq error:", res.status);
      return null;
    }
    const data: any = await res.json();
    return parseExtraction(data.choices[0].message.content);
  } catch (err) {
    console.error("[hybrid-fetcher] Groq fetch failed:", err);
    return null;
  }
}

async function callDeepSeek(
  text: string,
  apiKey: string,
): Promise<ExtractedPrices | null> {
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!res.ok) {
      console.error("[hybrid-fetcher] DeepSeek error:", res.status);
      return null;
    }
    const data: any = await res.json();
    return parseExtraction(data.choices[0].message.content);
  } catch (err) {
    console.error("[hybrid-fetcher] DeepSeek fetch failed:", err);
    return null;
  }
}

/**
 * QWEN via OpenRouter — OpenAI-compatible endpoint. Good fallback when Groq
 * and DeepSeek are unavailable or out of credits (DeepSeek returns 402 when
 * the free balance is exhausted).
 */
async function callQwen(
  text: string,
  apiKey: string,
): Promise<ExtractedPrices | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen-2.5-72b-instruct",
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!res.ok) {
      console.error("[hybrid-fetcher] QWEN error:", res.status);
      return null;
    }
    const data: any = await res.json();
    return parseExtraction(data.choices[0].message.content);
  } catch (err) {
    console.error("[hybrid-fetcher] QWEN fetch failed:", err);
    return null;
  }
}

function parseExtraction(content: string): ExtractedPrices | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      petrol: typeof parsed.petrol === "number" ? parsed.petrol : null,
      diesel: typeof parsed.diesel === "number" ? parsed.diesel : null,
      kerosene: typeof parsed.kerosene === "number" ? parsed.kerosene : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : "Local",
    };
  } catch {
    console.error("[hybrid-fetcher] Failed to parse AI JSON output:", content);
    return null;
  }
}
