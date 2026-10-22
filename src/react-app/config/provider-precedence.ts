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
 * declared fallback is permitted — never an arbitrary catalogue entry.
 */
export function mayServeCapability(
  capability: string,
  candidateId: string,
): boolean {
  const entry = providerForCapability(capability);
  if (!entry) return false;
  if (candidateId === entry.authoritative.id) return true;
  if (candidateId === entry.fallback?.id) {
    return resolveProviderEnvKey(entry.authoritative) === null;
  }
  return false;
}
