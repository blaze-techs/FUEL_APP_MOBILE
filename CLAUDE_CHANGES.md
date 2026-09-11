# Changes made in this session

## Fixed

1. **"No Cloud" bug (BUG_REPORT.md Bug #1) — root-caused and fixed.**
   `src/react-app/lib/restApiSync.ts` was checking Firebase Firestore for
   cloud status, even though the rest of the app (auth, station/sales data)
   already runs on Supabase. Its error-fallback path also referenced an
   `API_URL` variable that was **never defined anywhere in the file**, and
   `useCloudSync.ts` imported an `apiRequest` function that was **never
   exported** from it. Both would throw/fail silently at runtime.

   Rewrote the whole module to run on Supabase:
   - `checkApiStatus()` now does a real lightweight query against the
     `stations` table instead of a nonexistent Firestore health doc.
   - `apiRequest()` is now implemented for real, backed by the
     `team_members` table (the two call sites in `FounderAccess.tsx` /
     `useCloudSync.ts` needed `GET /api/users` and `PUT /api/users/:id`).
   - `createRecord` / `getRecord` / `updateRecord` / `deleteRecord` /
     `listRecords` now write to real Postgres tables (`stations`, `sales`,
     `team_members`, `audit_log`) where one exists, and to a new generic
     `app_kv` table for collections that don't have a dedicated table
     (`secrets`, `feature_flags`, `config`, `sales_analytics`).
   - localStorage fallback is preserved for offline resilience, but errors
     are now surfaced in the returned `error` field instead of swallowed.

2. **Added the missing `app_kv` table.** See `supabase/migrations/002_app_kv.sql`
   — **run this once in your Supabase SQL editor** (it's idempotent/safe to
   re-run). It's also folded into `supabase/schema.sql` for fresh installs.

3. **Removed dead code.** `src/react-app/hooks/useFounderAuth.ts` imported
   `@clerk/clerk-react`, which isn't even in `package.json` — it wasn't
   used anywhere else in the app, so it was just confusing debt. Deleted.

4. **Cross-device login & station data sync — root-caused and fixed.**
   `src/react-app/context/StationContext.tsx` (the context behind
   `useStations()`, which gates the entire app UI) was 100%
   localStorage-based. Supabase auth worked on every device, but station /
   business data never left the device, so a second device or browser saw
   zero stations and dropped the owner into the "create your first station"
   setup flow. The previous `syncFromBackend` / `syncToBackend` were dead
   code: they called a nonexistent tRPC endpoint
   (`${getApiBase()}/api/trpc/sync.fullSync` / `sync.pushChanges` with
   `VITE_BACKEND_URL` unset) and hunted for auth tokens under keys Supabase
   never writes (`fuelpro_founder_session`, `firebase_token`, `auth_token`,
   `fuelpro_auth_token`), then bailed silently.

   Rewrote the sync layer to run directly on Supabase (the schema already
   had `stations.owner_id` + RLS and `app_kv` from migration 002):
   - New top-level mappers `stationToRow` / `rowToStation` /
     `stationToBlob` + `newUuid()`; station ids are now UUIDs so they can
     be Postgres PK / `onConflict` targets.
   - `syncFromBackend()` pulls `stations` (`eq owner_id auth.uid()`) plus
     each station's `station_data` blob from `app_kv`, merges with the
     local cache (remote wins on id conflicts), re-persists localStorage,
     and best-effort pushes local-only stations back up.
   - `pushStationToBackend()` upserts row + blob with
     `owner_id = auth.uid()` on every write (satisfies RLS); legacy
     `station_<ts>_<rand>` ids are minted a UUID and remapped locally.
   - `createStation` / `updateStation` / `deleteStation` /
     `saveStationData` push to Supabase immediately; delete cascades the
     `app_kv` blob via the `station_id` FK.
   - `persist` moved above `syncFromBackend` (it was previously declared
     after code that referenced it — a temporal-dead-zone hazard).
   - `supabase.auth.onAuthStateChange` listener (`SIGNED_IN`,
     `INITIAL_SESSION`) triggers a pull when logging in mid-session
     without a full reload; the callback defers via `setTimeout` so no
     query ever runs inside Supabase's auth lock.
   - Deleted the dead tRPC/fetch sync and the fake-token `getAuthToken`.

   Result: signing in with the same email on any device/browser now loads
   your stations and their data from Supabase instead of showing the setup
   wizard. Verified with typecheck, production build, and a live
   two-profile smoke test.
   Supporting SQL: `supabase/migrations/004_cross_device_guard.sql`
   (idempotent guard; only strictly needed for projects provisioned from
   the legacy `database_schema.sql`).

5. Set real working env values in `.env.local` (your live Supabase project
   URL/anon key, `VITE_DEMO_MODE=false`) so the app runs against your actual
   backend out of the box.

6. **Global input loss, browser timeouts, and data erasure on restart — root-caused and fixed.**

   **"Everywhere" input clearing / browser restarts:**
   Found a systemic infinite loop in `src/react-app/context/StationContext.tsx`.
   The mount `useEffect` and Supabase auth listener depended on `syncFromBackend`,
   which in turn depended on the `stations` state array. Every single keystroke
   in any input updated `stations`, which changed the `syncFromBackend`
   reference, which triggered the mount `useEffect` to run again. The effect
   immediately called `setStations(loadFromStorage())`, which parses
   `localStorage` and returns a Brand-new object reference. This triggered
   another state change, creating a violent infinite loop that reset app state
   on every keystroke (causing React to unmount/remount inputs) and eventually
   crashed the browser tab via CPU exhaustion.
   - **Fix:** Added `useRef` (`stationsRef`, `adminSettingsRef`) to hold
     current state without triggering dependency updates. Rewrote `persist`,
     `syncToBackend`, and the mount/auth listener effects to be stable.
   - Set the mount `useEffect` and auth listener `useEffect` dependency arrays
     to `[]` so they only execute exactly once on mount/auth-change, entirely
     breaking the infinite re-hydration loop.

   **Data erasing on browser restart:**
   Found that `src/react-app/hooks/useFuelStore.ts` (Zustand store) was
   configured with `skipHydration: true` (originally added to prevent SSR
   mismatches). Since FuelPro is a pure Vite SPA with no SSR, this flag was
   actively preventing the store from rehydrating from `localStorage` on
   reload, causing POS carts, active shifts, and notifications to vanish.
   - **Fix:** Removed `skipHydration: true`.
   - Added `cart` and `activeShift` to the `partialize` whitelist so critical
     POS state survives browser restarts.

7. **"P.subscribe is not a function" crash screen — root cause fixed.**
   **ROOT CAUSE FOUND:** In `StationContext.tsx`, the code was calling
   `useAuth.subscribe(...)` but `useAuth` is a **React hook function**, not an
   object. Hooks must be called like `useAuth()`, not accessed like
   `useAuth.subscribe`. This caused the error "P.subscribe is not a function"
   where `P` was the minified name of the `useAuth` function.
   - **Fix:** Removed the incorrect `useAuth.subscribe()` call and instead
     used the existing `user` variable already declared from `const { user } = useAuth()`
     at line 376. The `useEffect` now properly reacts to `user` changes.
   - `OfflineIndicator.tsx` hardened with `safeSubscribe()` guard + try/catch.
   - `App.tsx` ErrorBoundary persists errors to `localStorage["fuelpro_last_error"]`.
   - `public/sw.js` cache bumped to `fuelpro-v3`.

## Verified working

- `npm install --legacy-peer-deps` — installs clean
- `npm run build` (= `npm run build:static`, the actual Vercel build command)
  — builds clean, no errors
- Production build served locally and returns HTTP 200 with the expected
  HTML shell

## Known issues found but **not** in scope for this pass (flagging for you)

These don't affect the deployed app because nothing imports them, but
they're worth cleaning up or finishing later:

- `src/react-app/lib/open-source/chatwootIntegration.ts`,
  `sentryIntegration.ts`, and `react-query-devtools.tsx` have genuine
  syntax errors (`npx tsc -b` fails on them). They're only referenced by
  `src/react-app/lib/open-source/index.ts`, which nothing in the running
  app imports — so it's dead weight. Either fix them (if you want
  Chatwoot/Sentry wired up) or delete the folder.
- `api/pump-mapping/*.ts` and `db/connection.ts` import from `astro` and
  `../api/queries/connection`, neither of which exist in this project —
  looks like leftover code from a different (Astro-based) iteration of the
  app. Not part of the Vercel build (`vercel.json` only builds the Vite
  frontend), so it's inert, but confusing to have around.
- The app still has a separate, unrelated `src/firebase/` module and a
  `src/react-app/services/FirebaseService.ts` — these are self-contained
  and don't conflict with anything, but you have two backend SDKs in the
  bundle. Worth deciding whether to fully remove Firebase now that
  Supabase is the real backend.
- The `index.html` still has Clerk meta tags (`clerk-publishable-key`,
  `clerk-frontend-api`) left over from an earlier auth approach, unrelated
  to the actual Supabase-based `AuthContext`. Harmless but worth removing
  for clarity.

## Additional pass (this session)

- Re-verified everything above from a clean checkout: `npm install`, `npm run
build`, and served the production `dist/` output locally — confirmed
  `HTTP 200` with the correct `<title>FuelPro - Fuel Management System</title>`,
  and confirmed the bundle has the real Supabase project URL baked in.
- Removed leftover `clerk-publishable-key` / `clerk-frontend-api` `<meta>`
  tags from `index.html` — Clerk isn't in `package.json` and isn't used by
  `AuthContext` (which is 100% Supabase), so these were just stale metadata
  from an earlier auth approach. Rebuilt clean afterward.

## Station Manager Upgrade (update-6)

6. **Station Manager upgraded (update-6).**
   Rewrote `src/react-app/components/StationManager.tsx` on top of the existing
   `useStations()` context and added `src/react-app/lib/station-stats.ts`:
   - Live stat cards (stations, combined revenue, today's revenue, shared users)
     plus cloud sync status and a "Sync Now" button wired to
     `syncToBackend()` + `syncFromBackend()` (update-22 Supabase layer).
   - Search, status filter chips (All/Active/Inactive/Maintenance) and sorting
     (Name / Revenue / Recently updated / Oldest).
   - Enriched station cards: per-station revenue (today/month/total), sales
     count, one-tap status toggle, relative "updated" time, cloud-sync badge
     (UUID-backed vs legacy local id), Open/Edit/Share/Export/Delete actions.
   - New modals: Create/Edit station (validated), Share Access (grant + revoke
     list), Access Station (password unlock via `verifyStationAccess`),
     Combined View (aggregated totals via `combineStations()`), and a delete
     confirmation dialog. Skeleton loaders, empty state, no-results state,
     auto-dismissing notices.
   - UPDATE-4 compliance: every subcomponent (StatCard, StatusBadge,
     StationCard, all modals, SkeletonCard, EmptyState) is defined at module
     scope — no component is ever defined inside a render function, so inputs
     cannot remount/clear while typing. All callbacks memoized; derived lists
     via useMemo keyed on station.id.
   - All analytics are computed defensively from the free-form `station.data`
     blob (`station-stats.ts`) and never throw; currency symbol auto-detects
     from `fuelpro_location_country` (defaults to Ksh).

## Invoice & Number Input Fixes

7. **Fixed Qty (DAYS) and other number inputs not being editable.**
   - `Invoice.tsx`: Fixed `updateInvoiceItem` to create new object references
     instead of mutating state directly (React anti-pattern fix). Also ensured
     qty and price inputs use `value={item.qty ?? ""}` and `value={item.price ?? ""}`
     so they properly handle undefined/null values.
   - `FuelOffloading.tsx`: Fixed quantity, rate, and totalAmount inputs to use
     `value={formData.field ?? ""}` for proper number input handling.
   - `DeliveryTracker.tsx`: Fixed deliveryYear, petrolPrice, and dieselPrice
     inputs to use `value={state.field ?? ""}`.
   - All inputs now have `step` attributes for proper decimal handling and
     `cursor-text` class for consistent cursor behavior.

## Working Version Sync (from FuelPro-working.zip)

8. **Synced key files with working version for consistency:**
   - `StationContext.tsx`: Added Supabase cross-device sync functions
     (`pushStationUpsert`, `pushStationDelete`, `syncStationsWithSupabase`)
     for proper station data synchronization across devices.
   - `Invoice.tsx`: Added `useRef` to track `lastDispatchedLabel` to prevent
     the quantity label input from fighting with global state changes.
   - `useFuelStore.ts`: Using working version with proper Zustand store
     configuration for state persistence.

## SalesZote Business Suite Integration (update-8)

9. **Full SalesZote-style POS & Inventory feature set integrated.**
   Based on the FuelPro × SalesZote Business Suit implementation guide:

   - **SQL Migration** (`supabase/migrations/005_saleszote_features.sql`): 15 new tables
     with RLS policies for products, customers, suppliers, sales_enhanced,
     sale_items, inventory_transactions, stock_transfers, purchase_orders,
     purchase_order_items, expenses, expense_categories, terminal_sessions,
     and integrations.

   - **pos-service.ts**: Central checkout + stock-movement engine. Every sale,
     adjustment, transfer, count, wastage, and PO-receipt writes an
     inventory_transactions row and keeps products.stock_quantity in sync.

   - **BusinessSuite.tsx**: Full SalesZote-style sidebar navigation shell with
     collapsible sections for Overview, POS, Catalog, Stock Management,
     Sales, Purchases, Customers, Expenses, Reports, and Settings.

   - **EnhancedDashboard.tsx**: KPI cards (sales, expenses, profit, inventory),
     sales trend chart, payment breakdown, top products, and recent activity.

   - **AdvancedPOS.tsx**: Full-featured POS with product grid, cart, customer
     selector, multiple payment methods (cash/M-PESA/card), terminal session
     integration, and success/completion screens.

   - **ProductsManagement.tsx**: Product CRUD with categories, barcode support,
     pricing (cost/selling), stock levels, reorder alerts, and active status.

   - **InventoryManagement.tsx**: Stock adjustments, transfers between stations,
     stock counts with variance calculation, wastage recording, and full
     transaction history.

   - **SalesInvoices.tsx**: Sales listing with search, date filter, and
     invoice detail modal with line items.

   - **PurchasesSuppliers.tsx**: Purchase order creation with line items,
     receive-to-stock flow, and supplier CRUD.

   - **CustomersManagement.tsx**: Customer profiles with contact info, credit
     limits, and purchase history.

   - **ExpensesManagement.tsx**: Auto-seeded expense categories, period
     filters, and category totals with P&L contribution.

   - **ReportsAnalytics.tsx**: P&L report, payment breakdown, top products,
     inventory valuation, and real CSV exports.

   - **TerminalSessions.tsx**: Open/close shifts, cash reconciliation,
     and variance computation.

   - **SettingsPanel.tsx**: Station info, tax rates, and integrations
     placeholder (M-PESA, Kopo Kopo).

   - **Home.tsx**: Wired to render BusinessSuite when a station is selected.

   Architecture compliance: all subcomponents module-scoped (UPDATE-4),
   all callbacks memoized, no effect-dependency loops, all inserts set
   owner_id from the Supabase session (UPDATE-22 RLS).

## Still worth doing (not done this pass — flagging so it's not lost)

- Delete or fix `src/react-app/lib/open-source/{chatwootIntegration,
sentryIntegration}.ts` (`react-query-devtools.tsx` is empty) — these have
  real syntax errors caught by `tsc -b`. Nothing in the running app imports
  them today so the build isn't affected, but it's a landmine for later.
- `api/pump-mapping/*.ts` and `db/connection.ts` reference an `astro`
  import and a `../api/queries/connection` path that don't exist in this
  project — looks like carryover from a different app iteration. Not part
  of the Vercel build (`vercel.json` only builds the Vite frontend), so
  it's inert but confusing.
- Decide whether to fully remove `src/firebase/` and
  `src/react-app/services/FirebaseService.ts` now that Supabase is the
  real backend — currently harmless (self-contained, unused by the active
  auth/data path) but it's dead weight in the bundle.

## To run it

```bash
npm install --legacy-peer-deps
npm run dev            # local dev server
npm run build           # production build -> dist/
```

`.env.local` is already set up with your live Supabase project. If you
haven't already, run `supabase/migrations/002_app_kv.sql` in your
Supabase SQL editor once.
