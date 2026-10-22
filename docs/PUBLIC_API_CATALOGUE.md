# Public API catalogue and integration policy

## What this change provides

`GET /api/public-apis` (also supports `HEAD`) retrieves the public-apis community catalogue from its canonical GitHub README and serves it with a one-hour shared cache and a one-day stale-while-revalidate window. It has an 8-second upstream timeout, a 2.5 MB response limit, a fixed upstream URL, and does not accept arbitrary URLs or act as an open proxy.

Source: https://github.com/public-apis/public-apis

## Important distinction

The upstream project is a directory of third-party APIs, not one API that can be installed into FuelPro. Catalogue entries have different owners, terms, availability, authentication, rate limits, and data schemas. Some are key-protected, OAuth-only, paid, restricted, deprecated, or unrelated to fuel-station workflows. FuelPro must not call every entry automatically or send customer, employee, financial, or station data to unrelated providers.

This endpoint makes the catalogue discoverable; it does **not** mean every listed provider has been individually integrated or verified.

## Integration checklist for each provider

1. Confirm the provider's official documentation, current availability, licence/terms, rate limits, and pricing.
2. Record the intended FuelPro feature and data fields; do not integrate APIs with no justified use case.
3. Store credentials in server-side Vercel environment variables only. Never use `VITE_*` for secret keys.
4. Implement a fixed provider-specific server route or service; never accept arbitrary upstream URLs from clients.
5. Validate inputs/outputs, enforce user and station permissions, set timeouts and request budgets, and redact secrets/PII from logs.
6. Add unit and integration tests for success, malformed data, authentication failure, timeout, rate limiting, and provider outage.
7. Verify the provider with test credentials and then production credentials; document any key/account/paid-plan prerequisite.
8. Deploy only after CI passes and check the production route after deployment.

## FuelPro-first provider priorities

Prioritize providers that directly support existing FuelPro requirements, after confirming official documentation and credentials: EPRA/Kenyan fuel pricing sources, M-PESA/Daraja, KRA/eTIMS, currency exchange for accounting, geocoding/maps for station locations, weather for operational context, and Claude/Anthropic for opted-in assistant features. Keep existing authoritative business records in Supabase; third-party APIs must not overwrite sales, pump readings, receipts, payments, payroll, or ledger records without validated reconciliation and audit trails.

## Standing rule — keep the existing working API

**When FuelPro already has a working provider for a capability, keep using it.
Never substitute the public-apis catalogue's counterpart for that capability.**

The catalogue is a discovery directory. It may be consulted only to:

- discover a provider for a capability FuelPro does **not** yet have, or
- add a **last-resort fallback behind** an existing provider.

It must never replace a configured provider, even when the catalogue lists a
similar or better-known one.

The authoritative provider per capability is recorded in
`src/react-app/config/provider-precedence.ts`:

| Capability                 | Authoritative provider                   | Fallback               | Catalogue counterparts (must NOT be substituted)     |
| -------------------------- | ---------------------------------------- | ---------------------- | ---------------------------------------------------- |
| Document & image OCR       | Google Gemini vision (`/api/gemini-ocr`) | on-device Tesseract.js | OCR.space, API4AI OCR, Mindee                        |
| Assistant / LLM            | Anthropic Claude (`/api/claude`)         | —                      | OpenAI, Groq, Cohere, AI21                           |
| Regulated fuel prices (KE) | EPRA reference + oilpriceapi.com         | —                      | CollectAPI Gas Prices, fuelpricesapi.com             |
| Fuel price web search      | SerpApi                                  | Serper                 | Bing Search (API Layer), Google Search (ScrapingBee) |
| Fuel price AI extraction   | Groq (Llama)                             | DeepSeek → OpenRouter  | Cohere, AI21, Together AI                            |
| Reverse geocoding          | Nominatim (OpenStreetMap)                | —                      | Geoapify, OpenCage, Positionstack, IPStack           |
| Currency exchange rates    | exchangerate-api.com                     | —                      | Fixer, Currencyapi, Frankfurter                      |
| Station weather context    | Open-Meteo                               | —                      | OpenWeatherMap, WeatherAPI, Weatherbit               |

Precedence is **per capability**. A provider authoritative for one capability
may still be a fallback for another — e.g. an AI model used for fuel-price
extraction is not thereby authoritative for OCR.

`src/test/provider-precedence.test.ts` enforces the rule structurally: it
fails if a capability is pointed at a catalogue counterpart, if the
authoritative provider's module disappears, if an unconfigured provider's
fallback is used while the provider is configured, or if any app code starts
calling `/api/public-apis`. Mutation-tested: substituting Gemini with OCR.space
fails 2 assertions; wiring the catalogue into `ocr-service.ts` fails 1.

Note: `exchangerate-api.com` is itself listed in the public-apis catalogue.
That is recorded via `alsoInCatalogue: true` — it is _not_ a substitution,
because FuelPro still calls the same provider it always did.

## Verification status

`GET /api/public-apis` is deployed and verified live on both hosts
(`fuel-app-mobile.pages.dev` and `fuel-app-mobile.vercel.app`) — HTTP 200,
318,072 bytes, one-hour shared cache. The upstream catalogue may change;
failures return 502 rather than fabricated data. The endpoint remains a
**passive discovery route**: no app code consumes it as a provider, and
`src/test/provider-precedence.test.ts` fails the build if that changes.
