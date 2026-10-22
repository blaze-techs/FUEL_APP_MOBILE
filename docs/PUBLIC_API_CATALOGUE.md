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

## Verification status

The endpoint has been committed to the feature branch. It has not yet been verified by CI or a production deployment. The live upstream catalogue may change; failures are returned as 502 rather than fabricated data. The original video was not available in the request context, so this source is the public-apis GitHub catalogue previously identified as the likely source, not a verified transcription of that video.
