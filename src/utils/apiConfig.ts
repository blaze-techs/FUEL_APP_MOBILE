/**
 * API Configuration Utility - Firebase-first
 *
 * Gemini is intentionally server-side. Never expose GEMINI_API_KEY or any
 * provider credential through VITE_* client environment variables.
 */

export function isBackendAvailable(): boolean { return false; }

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
const TRPC_API_URL = import.meta.env.VITE_TRPC_URL || "";

function isVercelDeployment(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host.includes("vercel.app") || host.includes("netlify.app") || host.includes("github.io") || host.includes("fuel-app-mobile");
}

export function getApiUrl(): string { return BACKEND_URL; }
export function getApiPath(path: string): string { return BACKEND_URL ? `${BACKEND_URL}${path}` : ""; }
export function getTrpcUrl(): string {
  if (TRPC_API_URL) return TRPC_API_URL;
  if (typeof window !== "undefined" && isVercelDeployment()) return "/api/trpc";
  return "";
}
export function getRestApiUrl(): string {
  if (BACKEND_URL) return BACKEND_URL;
  if (typeof window !== "undefined" && isVercelDeployment()) return "/api";
  return "";
}
export function getBackendUrl(): string { return BACKEND_URL; }

/** Deprecated compatibility helper. Gemini calls must use the authenticated /api/gemini-ocr proxy. */
export function getGeminiUrl(): string { return "/api/gemini-ocr"; }
export function isProxiedDeployment(): boolean { return isVercelDeployment(); }
