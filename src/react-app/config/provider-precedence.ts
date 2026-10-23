/**
 * Provider precedence — the authoritative provider for each capability.
 *
 * FuelPro integrates specific, verified providers. When one is already
 * configured and working, it is the ONLY provider that serves that
 * capability. `GET /api/public-apis` is a DISCOVERY directory of third-party
 * APIs — it is never a substitution source.
 *
 * STANDING RULE (keep-existing):
 *   For every capability below, keep the existing provider. Do NOT swap in the
 *   public-apis catalogue's counterpart for a capability that already has a
 *   working provider, even when the catalogue lists a similar one.
 *
 * The catalogue may be consulted only to:
 *   - discover a provider for a capability FuelPro does NOT yet have, or
 *   - add a LAST-RESORT fallback BEHIND an existing provider.
 * It must never be used to replace a configured provider.
 *
 * Precedence is per capability, so a provider that is authoritative for one
 * capability can still be a fallback for another (e.g. an AI model used for
 * fuel-price extraction is not thereby authoritative for OCR).
 */

export type ProviderPolicy = "keep-existing";

export interface ProviderRef {
  /** Stable id used in code and tests. */
  id: string;
  /** Human-readable name shown to owners. */
  name: string;
  /** Server-side env keys, in resolution order. First one set wins. */
  envKeys: string[];
  /** Same-origin route that fronts the provider, when one exists. */
  route?: string;
  /** Module that talks to the provider (repo-relative path). */
  module: string;
  /** Optional model/endpoint hint. */
  detail?: string;
}

export interface ProviderCapability {
  capability: string;
  label: string;
  /** The provider FuelPro already uses. Kept when configured. */
  authoritative: ProviderRef;
  /** Last-resort path used only when the authoritative provider is unavailable. */
  fallback?: ProviderRef;
  /**
   * Ordered fail-safe chain consulted only when `authoritative` (and any
   * single `fallback`) does not answer. Every entry is tried in order, so one
   * provider's outage degrades the capability instead of breaking it.
   *
   * A `fallbacks` entry may NOT be a public-apis catalogue counterpart unless
   * it is also listed in `catalogueCounterparts` — the guard enforces this so
   * the chain cannot quietly become a catalogue substitution.
   */
  fallbacks?: ProviderRef[];
  /**
   * Counterparts listed in the public-apis catalogue for this capability.
   * These are recorded so the guard can prove they were NOT substituted in.
   * Only providers that DIFFER from `authoritative` belong here.
   */
  catalogueCounterparts: string[];
  /**
   * True when the public-apis catalogue happens to list the SAME provider
   * FuelPro already uses (e.g. exchangerate-api.com). This is not a
   * substitution: the provider is unchanged. Recorded so the guard can
   * distinguish "same provider, also catalogued" from "different provider
   * swapped in".
   */
  alsoInCatalogue?: boolean;
  policy: ProviderPolicy;
}

export const PROVIDER_PRECEDENCE: ProviderCapability[] = [
  {
    capability: "ocr-document-vision",
    label: "Document & image OCR",
    authoritative: {
      id: "gemini",
      name: "Google Gemini vision (OCR)",
      envKeys: ["GEMINI_API_KEY", "VITE_GEMINI_API_KEY"],
      route: "/api/gemini-ocr",
      module: "api/gemini-ocr.ts",
      detail: "GEMINI_MODEL (default gemini-3.8-flash)",
    },
    fallback: {
      id: "tesseract",
      name: "On-device Tesseract.js",
      envKeys: [],
      module: "src/react-app/lib/ocr-service.ts",
      detail: "Runs in the browser; no key, no network",
    },
    catalogueCounterparts: [
      "OCR.space",
      "API4AI OCR",
      "Mindee",
      "Base64 by uinio.com",
    ],
    policy: "keep-existing",
  },
  {
    capability: "assistant-llm",
    label: "Assistant / LLM completion",
    authoritative: {
      id: "claude",
      name: "Anthropic Claude",
      envKeys: ["ANTHROPIC_API_KEY"],
      route: "/api/claude",
      module: "api/claude.ts",
      detail: "CLAUDE_MODEL (default claude-sonnet-4-6)",
    },
    catalogueCounterparts: ["OpenAI", "Groq", "Cohere", "AI21"],
    policy: "keep-existing",
  },
  {
    capability: "fuel-price-regulator",
    label: "Regulated fuel prices (Kenya)",
    authoritative: {
      id: "epra",
      name: "EPRA published reference + oilpriceapi.com",
      envKeys: ["OILPRICE_API_KEY"],
      route: "/api/fuel-prices",
      module: "src/server/vercel-api/fuel-prices.ts",
      detail: "EPRA gazette values embedded; oilpriceapi.com for live feed",
    },
    catalogueCounterparts: [
      "CollectAPI Gas Prices",
      "Fuel Prices by fuelpricesapi.com",
    ],
    // Both keyless. GlobalPetrolPrices is an INDEPENDENT published price
    // source used to cross-check the gazette figure; the AI extraction path
    // is the last resort when no published number can be read at all.
    fallbacks: [
      {
        id: "globalpetrolprices",
        name: "GlobalPetrolPrices.com (published national prices)",
        envKeys: [],
        module: "src/server/vercel-api/_lib/fuel-fallback-sources.ts",
        detail:
          "Keyless; page carries its own observation date, so staleness is detectable",
      },
      {
        id: "ai-extraction",
        name: "AI snippet extraction (Groq/DeepSeek/OpenRouter)",
        envKeys: ["GROQ_API_KEY", "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY"],
        module: "src/server/vercel-api/_lib/fuel-engine.ts",
        detail: "Verbatim extraction only — never estimates",
      },
    ],
    policy: "keep-existing",
  },
  {
    capability: "fuel-price-search",
    label: "Fuel price web search",
    authoritative: {
      id: "serpapi",
      name: "SerpApi",
      envKeys: ["SERPAPI_KEY"],
      module: "src/server/vercel-api/_lib/hybrid-fetcher.ts",
      detail: "Serper (SERPER_API_KEY) is the documented secondary",
    },
    // Keyless: the regulator's own published pages are fetched directly, so
    // the capability still works with no search key configured at all.
    fallbacks: [
      {
        id: "serper",
        name: "Serper.dev",
        envKeys: ["SERPER_API_KEY"],
        module: "src/server/vercel-api/_lib/hybrid-fetcher.ts",
      },
      {
        id: "public-regulator-pages",
        name: "Published regulator pages (keyless)",
        envKeys: [],
        module: "src/server/vercel-api/_lib/fuel-fallback-sources.ts",
        detail: "GlobalPetrolPrices + EPRA pages fetched directly",
      },
    ],
    catalogueCounterparts: [
      "Bing Search by API Layer",
      "Google Search by ScrapingBee",
    ],
    policy: "keep-existing",
  },
  {
    capability: "fuel-price-ai-extraction",
    label: "Fuel price AI extraction",
    authoritative: {
      id: "groq",
      name: "Groq (Llama)",
      envKeys: ["GROQ_API_KEY"],
      module: "src/server/vercel-api/_lib/fuel-engine.ts",
      detail: "DeepSeek then OpenRouter are the documented chain fallbacks",
    },
    catalogueCounterparts: ["Cohere", "AI21", "Together AI"],
    policy: "keep-existing",
  },
  {
    capability: "geocoding",
    label: "Reverse geocoding",
    authoritative: {
      id: "nominatim",
      name: "Nominatim (OpenStreetMap)",
      envKeys: [],
      module: "src/server/vercel-api/_lib/geocoding.ts",
      detail: "No key required; usage policy applies",
    },
    // Verified reachable from the same datacenter egress that Nominatim 403s.
    // Keyless, so they cost nothing and cannot be rate-limited by a missing key.
    fallbacks: [
      {
        id: "bigdatacloud",
        name: "BigDataCloud reverse geocode (keyless)",
        envKeys: [],
        module: "src/server/vercel-api/_lib/geocoding.ts",
        detail: "Returns a clean locality name — matches EPRA town names",
      },
      {
        id: "photon",
        name: "Photon by Komoot (keyless OSM)",
        envKeys: [],
        module: "src/server/vercel-api/_lib/geocoding.ts",
        detail: "Rich city/county/state detail",
      },
    ],
    catalogueCounterparts: ["Geoapify", "OpenCage", "Positionstack", "IPStack"],
    policy: "keep-existing",
  },
  {
    capability: "currency-fx",
    label: "Currency exchange rates",
    authoritative: {
      id: "exchangerate-api",
      name: "exchangerate-api.com",
      envKeys: [],
      module: "src/react-app/services/DataSyncService.ts",
    },
    // Keyless ECB-backed mirror of the same reference rates, used only when
    // the authoritative endpoint is unreachable.
    fallbacks: [
      {
        id: "frankfurter",
        name: "Frankfurter (ECB reference rates, keyless)",
        envKeys: [],
        module: "src/server/vercel-api/_lib/fx-rates.ts",
        detail: "Independent ECB source — also cross-checks the primary",
      },
    ],
    catalogueCounterparts: ["Fixer", "Currencyapi", "Frankfurter"],
    alsoInCatalogue: true,
    policy: "keep-existing",
  },
  {
    capability: "weather",
    label: "Station weather context",
    authoritative: {
      id: "open-meteo",
      name: "Open-Meteo",
      envKeys: [],
      module: "src/react-app/components/WeatherWidget.tsx",
      detail: "Keyless",
    },
    fallbacks: [
      {
        id: "met-no",
        name: "MET Norway Locationforecast",
        envKeys: [],
        module: "src/server/vercel-api/_lib/weather.ts",
        detail: "Keyless; requires a descriptive User-Agent",
      },
      {
        id: "wttr",
        name: "wttr.in",
        envKeys: [],
        module: "src/server/vercel-api/_lib/weather.ts",
        detail: "Keyless last resort",
      },
    ],
    catalogueCounterparts: ["OpenWeatherMap", "WeatherAPI", "Weatherbit"],
    policy: "keep-existing",
  },
];

/** True when the public-apis catalogue may not substitute an existing provider. */
export const CATALOGUE_NEVER_SUBSTITUTES = true;

export function providerForCapability(
  capability: string,
): ProviderCapability | undefined {
  return PROVIDER_PRECEDENCE.find((entry) => entry.capability === capability);
}

/**
 * The env key that actually resolves for a provider, or null when none is set.
 * Reads only server-visible keys; VITE_* keys are build-time public.
 */
export function resolveProviderEnvKey(ref: ProviderRef): string | null {
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  if (!env) return null;
  for (const key of ref.envKeys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) return key;
  }
  return null;
}

/**
 * Whether `candidateId` may serve `capability` right now.
 *
 * A configured authoritative provider is exclusive: any other provider is
 * refused. When the authoritative provider is NOT configured, only its
 * declared `fallback` / `fallbacks` chain is permitted — never an arbitrary
 * catalogue entry.
 */
export function mayServeCapability(
  capability: string,
  candidateId: string,
): boolean {
  const entry = providerForCapability(capability);
  if (!entry) return false;
  if (candidateId === entry.authoritative.id) return true;
  const isDeclared =
    candidateId === entry.fallback?.id ||
    (entry.fallbacks ?? []).some((f) => f.id === candidateId);
  if (isDeclared) {
    return resolveProviderEnvKey(entry.authoritative) === null;
  }
  return false;
}

/**
 * The full ordered chain for a capability: authoritative first, then any
 * declared fail-safes. This is what the runtime fail-over walks.
 */
export function providerChain(capability: string): ProviderRef[] {
  const entry = providerForCapability(capability);
  if (!entry) return [];
  return [
    entry.authoritative,
    ...(entry.fallback ? [entry.fallback] : []),
    ...(entry.fallbacks ?? []),
  ];
}
