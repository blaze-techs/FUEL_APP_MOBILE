/**
 * App Router Type Definition
 *
 * This project is a static SPA (Vercel/Cloudflare) with no tRPC backend — it
 * runs in Supabase-only mode. `getApiUrl()` in `providers/trpc.tsx` returns ""
 * when no backend is configured, so every tRPC call is a runtime no-op.
 *
 * tRPC v11's `createTRPCReact<AppRouter>()` requires `AppRouter` to be a real
 * `Router<any, any>`; a stub like `Record<string, any>` (or `any`) collapses
 * the client type to a union of error-message string literals, breaking
 * `createClient`, `Provider`, `useUtils`, and every procedure access.
 *
 * To keep the (unused-at-runtime) client fully typed without a real backend,
 * we define a minimal real router whose procedures return `any`. The client
 * only imports `AppRouter` as a type (`import type`), so this router body is
 * erased from the production bundle and never executes.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";

const t = initTRPC.create({
  transformer: superjson,
});

// Procedures accept any input and return any so the stub client type-checks
// without a real backend. All calls are runtime no-ops (no API URL configured).

const anyQuery = () => t.procedure.input(z.any()).query((): any => null);

const anyMutation = () => t.procedure.input(z.any()).mutation((): any => null);

export const appRouter = t.router({
  audit: t.router({
    log: anyMutation(),
    listAll: anyQuery(),
    summary: anyQuery(),
    getFounderSession: anyQuery(),
    upsertFounderSession: anyMutation(),
  }),
  station: t.router({
    list: anyQuery(),
  }),
  sale: t.router({
    analytics: anyQuery(),
  }),
  founderAuth: t.router({
    getAllUsers: anyQuery(),
    getAllStations: anyQuery(),
  }),
  auth: t.router({
    me: anyQuery(),
    logout: anyMutation(),
  }),
});

export type AppRouter = typeof appRouter;
