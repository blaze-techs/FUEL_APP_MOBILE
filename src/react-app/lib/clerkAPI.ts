/**
 * Clerk API Utilities
 *
 * Helper functions for working with Clerk authentication:
 * - Getting auth tokens for API calls
 * - Verifying Clerk tokens on backend
 * - Managing Clerk user data
 */

// Clerk publishable key configuration
const getClerkPublishableKey = () => import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const getClerkBackendUrl = () => {
  const key = getClerkPublishableKey();
  if (!key) return null;

  // Extract domain from publishable key
  // Format: pk_live_xxx.api.clerk.com
  const match = key.match(/api\.clerk\.(\S+)/);
  if (match) {
    return `https://api.clerk.${match[1]}`;
  }
  return "https://api.clerk.com";
};

const getClerkDomain = () => {
  const key = getClerkPublishableKey();
  if (!key) return null;

  // Extract domain from publishable key
  const match = key.match(/clerk\.(\S+)\./);
  if (match) {
    return match[1];
  }
  return "accounts";
};

export interface ClerkUserInfo {
  id: string;
  email: string;
  name: string;
  imageUrl?: string;
  createdAt: number;
  lastLoginAt?: number;
}

/**
 * Get Clerk session token for authenticated API calls
 */
export async function getClerkToken(): Promise<string | null> {
  if (!getClerkPublishableKey()) return null;

  try {
    // @ts-expect-error - Clerk global is injected at runtime
    const token = await window.Clerk.session?.getToken();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Get auth headers for API calls
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getClerkToken();
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }
  return {
    "Content-Type": "application/json",
  };
}

/**
 * Check if user is authenticated with Clerk
 */
export function isClerkAuthenticated(): boolean {
  if (!getClerkPublishableKey()) return false;

  try {
    // @ts-expect-error - Clerk global is injected at runtime
    return !!window.Clerk?.session;
  } catch {
    return false;
  }
}

/**
 * Get current Clerk user ID
 */
export function getClerkUserId(): string | null {
  if (!getClerkPublishableKey()) return null;

  try {
    // @ts-expect-error - Clerk global is injected at runtime
    return window.Clerk?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Get Clerk domain for frontend API calls
 */
export function getFrontendClerkDomain(): string | null {
  return getClerkDomain();
}

/**
 * Clerk configuration status
 */
export const isClerkConfigured = () => !!getClerkPublishableKey();

/**
 * Make authenticated fetch call
 */
export async function clerkFetch<T = any>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = await getAuthHeaders();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

/**
 * Clerk API endpoints helper
 */
export const clerkAPI = {
  // Get user info
  async getUser(): Promise<ClerkUserInfo | null> {
    const userId = getClerkUserId();
    if (!userId) return null;

    try {
      return await clerkFetch(`${getClerkBackendUrl()}/v1/users/${userId}`);
    } catch {
      return null;
    }
  },

  // Get session info
  async getSession() {
    const token = await getClerkToken();
    if (!token) return null;

    try {
      return await clerkFetch(`${getClerkBackendUrl()}/v1/sessions`);
    } catch {
      return null;
    }
  },
};

export default {
  getClerkToken,
  getAuthHeaders,
  isClerkAuthenticated,
  getClerkUserId,
  isClerkConfigured,
  clerkFetch,
  clerkAPI,
};
