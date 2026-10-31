# FuelPro production audit — 2026-10-04

## Executive finding

The recurring defects are not one isolated UI bug. The production system currently has **multiple competing authorities and unfinished hardening work** across application state, Supabase permissions/RLS, and deployment/runtime paths.

This audit intentionally separates **confirmed defects** from **advisories/design choices**. No reference/default/regulator value should be promoted to operational station truth without an explicit authorized action.

## Confirmed findings

### 1. Operational fuel-price protection is still incomplete on `main`

PR #40 (`hardening/immutable-manual-fuel-prices-2026-09-22`) is still open and unmerged. Its three-file patch directly addresses the known price-reversion path:

- legacy Price Board entries without provenance are protected instead of treated as regulator-owned;
- cloud/local/realtime hydration is read-only and cannot be mistaken for a new price edit;
- automatic/regulator operational writes are retired;
- browser country is removed as a write-side pricing authority;
- pricing mode is forced to manual.

Do **not** merge the entire old branch blindly because it was based on an older `main`; port the hunks onto the current `main` and run regression tests against current FuelContext behavior.

### 2. Stale/offline station writes remain a high-risk integration area

PR #42 (`fix/stale offline station sessions`) is open. Its intended fix is server-authoritative station leases + fencing, with validation immediately before online writes and offline-queue replay. This is the correct architecture for preventing an old browser from replaying a stale station snapshot over a newer session.

### 3. Company QR access hardening is still sitting in an open PR

PR #46 (`Fix Company QR access session and enforce scope server-side`) is open. It addresses stale grant/mode leakage and enforces scope server-side. UI-only read/edit/normal restrictions are not sufficient; the server/RPC must be the final authority.

### 4. Live Supabase security surface contains unnecessary SECURITY DEFINER exposure

The production advisor reported public execution for several SECURITY DEFINER functions. The two shift-continuity functions were unnecessarily exposed:

- `fuelpro_enforce_shift_meter_continuity()` — trigger-only internal function.
- `fuelpro_get_shift_continuity(uuid,date,text)` — authenticated station read RPC.

These were hardened in production on 2026-10-04 and the matching migration is committed in this branch. The trigger function has no client EXECUTE privilege; the read RPC is authenticated-only.

### 5. `lookup_station()` exposes owner identifiers to anonymous callers

Its current SECURITY DEFINER implementation returns `stationId`, `ownerId`, `stationName`, and `code` for fuzzy station searches. Returning `ownerId` to an anonymous caller is unnecessary data exposure. This needs a compatibility check of every caller before replacing the response with a minimum public shape. The safe target is to return only the fields required by the access flow.

### 6. Supabase has significant policy/index debt

The live performance advisor currently reports:

- 107 foreign keys without covering indexes;
- 68 RLS policies with row-by-row `auth.*()` initialization-plan evaluation;
- 39 groups of multiple permissive RLS policies;
- 36 unused indexes.

These are not all immediate correctness bugs. They should be remediated in priority order, with query plans/production usage checked before dropping any unused index.

### 7. Supabase security advisor still reports structural warnings

Current production advisories include:

- 10 RLS-enabled tables with no policies (some may intentionally be service-only);
- 2 functions with mutable search paths;
- `spatial_ref_sys` exposed without RLS (PostGIS metadata; do not blindly modify without checking extension ownership/usage);
- PostGIS installed in `public`;
- SECURITY DEFINER functions callable by authenticated users;
- leaked-password protection disabled.

These require classification and least-privilege remediation, not blanket changes that break legitimate FuelPro RPCs.

### 8. Vercel runtime telemetry has a real OCR failure

Production runtime telemetry identified `api/gemini-ocr.ts` failing with:

`Response.setHeaders()` receiving a plain object instead of a `Headers`/`Map`-compatible value.

The current adapter type also models `setHeaders` as accepting `Record<string,string>`, which is inconsistent with the runtime response implementation. The correct fix is to normalize CORS headers through the response API (`Headers`/`Map`) or use `setHeader(name,value)` consistently, then add a regression test for the OCR endpoint.

This is a real server bug, not a cosmetic warning.

## Correct remediation strategy

1. **One source of truth per domain**
   - operational prices → station-authoritative `fuel_types_config`/price records;
   - regulator prices → reference/advisory data only;
   - sales → immutable canonical sales ledger;
   - payments → payment ledger + reconciliation;
   - meters → chronological shift ledger;
   - permissions → server-side RPC/RLS authority;
   - external mini-sites → token/grant-scoped server authority.

2. **No hydration writes**
   Cloud/local/realtime hydration must never trigger a write-back that changes provenance or operational state.

3. **No client-only authorization**
   Read-only/edit/normal QR access must be enforced by the server/RPC, not merely by hiding UI controls.

4. **No silent fallback to reference/default data**
   Missing station data should produce an explicit unavailable state or a setup action, never a plausible-looking hardcoded fuel price.

5. **Regression suite before deployment**
   Minimum critical path:
   registration → station → member/QR access → shift open → inherited meters → sale → payment → shift close → variance approval → report → reopen/reversal → cross-device refresh → offline replay → print/export.

6. **Deployment gate**
   A change is not considered fixed until TypeScript, lint, unit tests, production build, database migration replay, live API smoke tests, and browser E2E checks pass on the actual deployed artifact.
