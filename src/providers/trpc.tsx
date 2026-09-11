import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppRouter } from "../types/trpc-router";
import type { ReactNode } from "react";
import { useState } from "react";

export const trpc = createTRPCReact<AppRouter>();

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: (failureCount, error: any) => {
          // Don't retry on 401/403 errors
          if (
            error?.data?.code === "UNAUTHORIZED" ||
            error?.data?.code === "FORBIDDEN"
          ) {
            return false;
          }
          return failureCount < 3;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}

// Check if we're in a static deployment
function isStaticDeployment(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host.includes("vercel.app") ||
    host.includes("netlify.app") ||
    host.includes("github.io")
  );
}

// Determine the correct API URL - use relative path for Vercel deployments
// to leverage the Vercel proxy which handles CORS headers.
// Returns "" (Supabase-only mode) when no backend is configured, so callers
// can short-circuit instead of POSTing to a broken URL.
function getApiUrl(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    // Vercel serves the /api/trpc serverless functions same-origin, so a
    // relative URL works and avoids CORS. Cloudflare Pages and other static
    // hosts have NO /api/* endpoints, so we must NOT use a relative URL there
    // (it would 405 against the static host). Fall through to the explicit
    // backend URL or Supabase-only mode.
    const isVercel = host.includes("vercel.app");
    const hasBackendEnv = !!(
      import.meta.env.VITE_TRPC_URL || import.meta.env.VITE_BACKEND_URL
    );
    if (isVercel && hasBackendEnv) {
      return "/api/trpc";
    }
  }
  // Explicit backend URL (e.g. a separate API host). Guard against undefined
  // so we never produce the string "undefined/api/trpc" (which happened when
  // VITE_BACKEND_URL was unset: undefined + "/api/trpc" is a truthy string,
  // so the `|| ""` fallback never fired → POST /undefined/api/trpc → 405).
  const trpcUrl = import.meta.env.VITE_TRPC_URL;
  if (trpcUrl) return trpcUrl;
  const backendUrl = import.meta.env.VITE_BACKEND_URL;
  if (backendUrl) return `${backendUrl}/api/trpc`;
  // No backend configured → Supabase-only mode. tRPC queries will fail
  // fast with a network error rather than spamming 405s against the host.
  return "";
}

// Check if Supabase is configured
const isSupabaseConfigured = () =>
  !!import.meta.env.VITE_SUPABASE_URL &&
  !!import.meta.env.VITE_SUPABASE_ANON_KEY;

// Get Supabase auth token (async) with proper auth state waiting
async function getSupabaseToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    // Dynamic import to avoid circular dependencies
    const { getSupabaseClient } = await import("@/supabase/client");
    const client = getSupabaseClient();

    const {
      data: { session },
      error,
    } = await client.auth.getSession();

    if (error || !session) return null;

    return session.access_token;
  } catch {
    /* Supabase not available */
  }
  return null;
}

function createTrpcClient() {
  const apiUrl = getApiUrl();
  return trpc.createClient({
    links: [
      httpBatchLink({
        // tRPC requires a non-empty url; fall back to the relative path so the
        // link initialises, but the custom fetch below short-circuits when no
        // backend is actually configured (Supabase-only mode).
        url: apiUrl || "/api/trpc",
        // superjson is configured globally on the router (initTRPC.create),
        // so httpBatchLink must not set its own transformer.
        // Limit URL length to prevent 431 errors from oversized batch requests
        // Standard limit is 8KB, we use 2000 to be safe across proxies
        maxURLLength: 2000,
        async headers() {
          const headers: Record<string, string> = {};

          // Include Supabase auth token if configured
          const supabaseToken = await getSupabaseToken();
          if (supabaseToken) {
            headers["Authorization"] = `Bearer ${supabaseToken}`;
            headers["X-Supabase-Auth"] = "true";
          }

          // Include founder session token if available (for Founder Access)
          try {
            const sessionJson = localStorage.getItem(
              "fuelpro_founder_session_meta",
            );
            if (sessionJson) {
              const session = JSON.parse(sessionJson);
              // Check if session is still valid (7 days) with type guards
              if (
                typeof session.loginTime === "number" &&
                typeof session.token === "string" &&
                Date.now() - session.loginTime < 7 * 24 * 60 * 60 * 1000
              ) {
                if (session.token) {
                  headers["x-founder-token"] = session.token;
                }
              } else {
                // Clear expired or invalid session
                localStorage.removeItem("fuelpro_founder_session_meta");
              }
            }
          } catch {
            /* no founder session */
          }

          return headers;
        },
        fetch(input, init) {
          // When no backend is configured (Supabase-only mode, e.g. on
          // Cloudflare Pages which has no /api/* serverless functions), reject
          // the request immediately instead of POSTing to the host origin
          // (an empty url "" resolves to the current page → 405 on every
          // query/mutation). Callers already fall back to Supabase-direct.
          if (!apiUrl) {
            return Promise.reject(
              new Error(
                "tRPC backend not configured — running in Supabase-only mode",
              ),
            );
          }
          return globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
    ],
  });
}

export function TRPCProvider({ children }: { children: ReactNode }) {
  // Use useState to ensure each component tree gets its own queryClient
  // This prevents cache sharing issues during SSR and hot reload
  const [queryClient] = useState(createQueryClient);
  const [trpcClient] = useState(createTrpcClient);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
