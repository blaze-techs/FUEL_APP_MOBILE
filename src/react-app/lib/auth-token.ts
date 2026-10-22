/**
 * Canonical browser access-token resolver for authenticated server routes.
 *
 * Server proxies (`/api/gemini-ocr`, `/api/claude`, …) verify the caller by
 * forwarding the token to Supabase `auth/v1/user`. A request without it is
 * rejected with HTTP 401, so every caller must send the token.
 *
 * Two storage shapes exist in this app and BOTH must be supported:
 *   1. `fuelpro_token` — written by AuthContext on sign-in.
 *   2. `sb-<project-ref>-auth-token` — the Supabase client's own persisted
 *      session (used when the app restored a session without going through
 *      the AuthContext sign-in path).
 *
 * This used to be copy-pasted per call site, which is how MPESAAnalyzer ended
 * up sending no Authorization header at all and getting a 401 for every AI
 * chunk. Keep the resolution in one place.
 */

const DIRECT_TOKEN_KEY = "fuelpro_token";
const SUPABASE_SESSION_SUFFIX = "-auth-token";

function readDirectToken(): string | null {
  try {
    const value = localStorage.getItem(DIRECT_TOKEN_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function readSupabaseSessionToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (
        !key ||
        !key.startsWith("sb-") ||
        !key.endsWith(SUPABASE_SESSION_SUFFIX)
      )
        continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const session = JSON.parse(raw) as { access_token?: unknown };
      const token = session?.access_token;
      if (typeof token === "string" && token.trim()) return token.trim();
    }
  } catch {
    // Malformed or unavailable storage — treat as no token.
  }
  return null;
}

/**
 * Resolve the current access token, or null when the caller is signed out.
 * Never throws; storage can be unavailable in restricted contexts.
 */
export function getAccessToken(): string | null {
  return readDirectToken() ?? readSupabaseSessionToken();
}

/**
 * Authorization header for an authenticated server route, or an empty object
 * when there is no token (so a signed-out caller still gets a clean 401
 * response instead of a malformed header).
 */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
