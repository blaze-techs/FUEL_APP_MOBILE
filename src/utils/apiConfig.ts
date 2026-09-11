/**
 * API Configuration Utility - Firebase-first
 *
 * Primary cloud storage: Firebase Firestore
 * Backend API: Railway (optional - graceful degradation if unavailable)
 */

// Check if backend is available - returns false gracefully if not
export function isBackendAvailable(): boolean {
  // For now, we don't require the backend - Firebase handles cloud sync
  // This can be enabled later if needed
  return false;
}

// Optional REST API backend (for features not yet in Firebase)
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
const TRPC_API_URL = import.meta.env.VITE_TRPC_URL || "";

// Google Gemini API Key (for AI features)
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

// Detect static/Vercel deployment
function isVercelDeployment(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host.includes("vercel.app") ||
    host.includes("netlify.app") ||
    host.includes("github.io") ||
    host.includes("fuel-app-mobile")
  );
}

/**
 * Get the API base URL.
 * Returns empty string if backend not configured.
 */
export function getApiUrl(): string {
  return BACKEND_URL;
}

export function getApiPath(path: string): string {
  return BACKEND_URL ? `${BACKEND_URL}${path}` : "";
}

/** Get tRPC endpoint URL */
export function getTrpcUrl(): string {
  if (TRPC_API_URL) {
    return TRPC_API_URL;
  }
  if (typeof window !== "undefined" && isVercelDeployment()) {
    return "/api/trpc";
  }
  return "";
}

/** Get REST API base URL */
export function getRestApiUrl(): string {
  if (BACKEND_URL) {
    return BACKEND_URL;
  }
  if (typeof window !== "undefined" && isVercelDeployment()) {
    return "/api";
  }
  return "";
}

/**
 * Get backend URL for auth and data fetching.
 * Returns empty string if backend not configured.
 */
export function getBackendUrl(): string {
  return BACKEND_URL;
}

/** Get Gemini AI API URL */
export function getGeminiUrl(): string {
  if (GEMINI_API_KEY) {
    return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  }
  return "";
}

/** Check if running in a proxied/Vercel deployment */
export function isProxiedDeployment(): boolean {
  return isVercelDeployment();
}
