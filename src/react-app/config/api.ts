/**
 * FuelPro API Configuration
 * Centralized API client for backend communication
 *
 * Note: Primary cloud storage is now Supabase.
 * This API is optional for features not yet migrated to Supabase.
 */

// Lazy API base URL getter using dynamic import to avoid circular deps
let _apiBase: string | null = null;
let _apiPromise: Promise<string> | null = null;

function getApiBase(): string {
  if (_apiBase) return _apiBase;
  // Try environment variable first, then fall back to empty string (Supabase-only mode)
  return import.meta.env.VITE_BACKEND_URL || "";
}

async function getApiBaseAsync(): Promise<string> {
  if (_apiBase) return _apiBase;
  if (!_apiPromise) {
    _apiPromise = import("@/utils/apiConfig").then((m) => m.getBackendUrl());
  }
  _apiBase = await _apiPromise;
  return _apiBase;
}

// Backend API URL - uses centralized config that handles Vercel proxy
export function getApiBaseUrl(): string {
  return getApiBase();
}

// Check if backend API is configured
export function isBackendConfigured(): boolean {
  return !!import.meta.env.VITE_BACKEND_URL;
}

// Get auth token from founder session (Supabase-based)
export function getAuthToken(): string | null {
  try {
    // Try Supabase founder session token
    const token = localStorage.getItem("fuelpro_founder_token");
    if (token) return token;

    // Try Supabase session token (Supabase auth)
    const sessionJson = localStorage.getItem("fuelpro_founder_session_meta");
    if (sessionJson) {
      const session = JSON.parse(sessionJson);
      if (session.token) {
        // Check if session is still valid (7 days)
        if (
          session.loginTime &&
          Date.now() - session.loginTime < 7 * 24 * 60 * 60 * 1000
        ) {
          return session.token;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// API Endpoints - using functions to ensure lazy evaluation
export const API_ENDPOINTS = {
  // Dashboard
  get DASHBOARD_STATS() {
    return `${getApiBase()}/api/dashboard/stats`;
  },
  get SALES_TREND() {
    return `${getApiBase()}/api/dashboard/sales-trend`;
  },
  get FUEL_DISTRIBUTION() {
    return `${getApiBase()}/api/dashboard/fuel-distribution`;
  },
  get CURRENT_PRICES() {
    return `${getApiBase()}/api/dashboard/current-prices`;
  },

  // Authentication
  get LOGIN() {
    return `${getApiBase()}/api/auth/login`;
  },
  get REGISTER() {
    return `${getApiBase()}/api/auth/register`;
  },
  get ME() {
    return `${getApiBase()}/api/auth/me`;
  },

  // M-PESA
  get MPESA_STK() {
    return `${getApiBase()}/api/mpesa/stkpush`;
  },
  get MPESA_STATUS() {
    return `${getApiBase()}/api/mpesa/stkstatus`;
  },
  get MPESA_CONFIG() {
    return `${getApiBase()}/api/mpesa/config`;
  },

  // Cloud Sync
  get CLOUD_DATA() {
    return `${getApiBase()}/api/data`;
  },
  get USER_DATA() {
    return `${getApiBase()}/api/user-data`;
  },
};

// API Request Helper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  // If endpoint is empty, backend is not configured - use Supabase instead
  if (!endpoint) {
    return {
      success: false,
      error: "Backend not configured - using local storage only",
    };
  }

  const token = getAuthToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers as Record<string, string>),
  };

  try {
    const response = await fetch(endpoint, {
      ...options,
      headers,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        // Handle unauthorized - clear session
        localStorage.removeItem("fuelpro_founder_token");
        localStorage.removeItem("fuelpro_founder_session_meta");
        console.warn("Session expired - please login again");
      }

      return {
        success: false,
        error: data?.error || data?.message || `API Error: ${response.status}`,
      };
    }

    return data;
  } catch (error) {
    console.error(`API Request Failed: ${endpoint}`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

// Dashboard API helpers
export const dashboardApi = {
  async getStats(): Promise<
    ApiResponse<{
      totalRevenue: number;
      netProfit: number;
      fuelSold: number;
      balanceDue: number;
      todaySales: number;
      timestamp: string;
    }>
  > {
    return apiRequest(API_ENDPOINTS.DASHBOARD_STATS);
  },

  async getSalesTrend(): Promise<
    ApiResponse<
      Array<{
        date: string;
        revenue: number;
        fuelSold: number;
      }>
    >
  > {
    return apiRequest(API_ENDPOINTS.SALES_TREND);
  },

  async getFuelDistribution(): Promise<
    ApiResponse<{
      petrol: number;
      diesel: number;
      kerosene: number;
    }>
  > {
    return apiRequest(API_ENDPOINTS.FUEL_DISTRIBUTION);
  },

  async getCurrentPrices(): Promise<
    ApiResponse<{
      petrol: number;
      diesel: number;
      kerosene: number;
    }>
  > {
    return apiRequest(API_ENDPOINTS.CURRENT_PRICES);
  },
};

export default {
  getApiBaseUrl,
  API_ENDPOINTS,
  apiRequest,
  dashboardApi,
  getAuthToken,
};
