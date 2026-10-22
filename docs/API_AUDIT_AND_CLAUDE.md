# API audit and Claude integration

## Claude API proxy

The server-side endpoint is `POST /api/claude`. It requires a valid Supabase access token in `Authorization: Bearer <access-token>`; it never accepts an Anthropic key from the browser.

Required Vercel server environment variables:
- `ANTHROPIC_API_KEY`: secret from the Anthropic Console. Never use a `VITE_` prefix.
- `SUPABASE_URL` (or existing `VITE_SUPABASE_URL`): Supabase project URL.
- `SUPABASE_ANON_KEY` (or existing `VITE_SUPABASE_ANON_KEY`): publishable/anon key used to validate the access token.
- Optional `CLAUDE_MODEL`: model available to the Anthropic account; defaults to `claude-sonnet-4-6`.

Configure secrets in Vercel Project Settings → Environment Variables for Preview and Production, then redeploy. Do not commit secrets. A missing Anthropic key intentionally returns HTTP 503 rather than a fake success.

Request:
```http
POST /api/claude
Authorization: Bearer <Supabase access token>
Content-Type: application/json

{
  "messages": [{"role":"user","content":"Summarize this fuel sales variance."}],
  "max_tokens": 1024,
  "system": "You are a careful FuelPro assistant."
}
```

The proxy validates the Supabase session, limits body/message sizes and output tokens, restricts roles and message shape, applies a timeout, and returns sanitized provider errors. It does not expose the Anthropic credential or pass arbitrary provider endpoints/tools from clients.

## Integration audit checklist

- [ ] Add `ANTHROPIC_API_KEY` and verify account/model access in Preview and Production.
- [ ] Verify signed-in request succeeds; missing/invalid token is rejected.
- [ ] Verify unauthenticated callers, unsupported methods, invalid JSON, oversized requests, and disallowed origins are rejected.
- [ ] Verify provider timeout, rate limit, invalid credential, and upstream failure responses.
- [ ] Audit all existing API routes for authentication, station-scoped authorization, input validation, idempotency, retries, secret exposure, and error leakage.
- [ ] Run `npm run check`, `npm test`, `npm run lint`, and `npm run build`.
- [ ] Confirm the Vercel preview deployment and smoke-test critical APIs before promoting to production.
- [ ] Review Supabase security and performance advisors; verify RLS policies and migration state before schema changes.
- [ ] Validate external providers (M-PESA/PayHero, KRA eTIMS, EPRA/fuel-price sources, OCR/AI) using their own sandbox/test credentials. Never fabricate a provider success response.

This checklist is a release gate, not a claim that every integration has already passed. Payment, tax, and fuel-price integrations must only be marked healthy after real provider responses and reconciliation have been verified.
