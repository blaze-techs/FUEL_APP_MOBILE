/**
 * CENTRALIZED API ENDPOINTS
 *
 * Single source of truth for all API endpoints.
 * Use these constants instead of hardcoding URL strings.
 */

// Base URL - should match the backend server
const API_BASE = "/api";

// ============================================
// AUTH ENDPOINTS
// ============================================
export const AUTH_ENDPOINTS = {
  LOGIN: `${API_BASE}/auth/login`,
  REGISTER: `${API_BASE}/auth/register`,
  LOGOUT: `${API_BASE}/auth/logout`,
  REFRESH: `${API_BASE}/auth/refresh`,
  ME: `${API_BASE}/auth/me`,
  CHANGE_PASSWORD: `${API_BASE}/auth/change-password`,
  FORGOT_PASSWORD: `${API_BASE}/auth/forgot-password`,
  RESET_PASSWORD: `${API_BASE}/auth/reset-password`,
} as const;

// ============================================
// ADMIN ENDPOINTS
// ============================================
export const ADMIN_ENDPOINTS = {
  AUTH: `${API_BASE}/admin/auth`,
  AUTH_LOGIN: `${API_BASE}/admin/auth/login`,
  AUTH_LOGOUT: `${API_BASE}/admin/auth/logout`,
  CHANGE_PASSWORD: `${API_BASE}/admin/auth/change-password`,

  DASHBOARD: `${API_BASE}/admin/dashboard`,
  STATS: `${API_BASE}/admin/stats`,
  USERS: `${API_BASE}/admin/users`,
  STATIONS: `${API_BASE}/admin/stations`,

  SUBSCRIPTIONS: `${API_BASE}/admin/subscriptions`,
  FEATURES: `${API_BASE}/admin/features`,
  SETTINGS: `${API_BASE}/admin/settings`,
} as const;

// ============================================
// M-PESA ENDPOINTS
// ============================================
export const MPESA_ENDPOINTS = {
  CONFIG: `${API_BASE}/mpesa/config`,
  STK_PUSH: `${API_BASE}/mpesa/stkpush`,
  STK_STATUS: `${API_BASE}/mpesa/stkstatus`,
  BALANCE: `${API_BASE}/mpesa/balance`,
  TRANSACTIONS: `${API_BASE}/mpesa/transactions`,
  B2C: `${API_BASE}/mpesa/b2c`,
} as const;

// ============================================
// DASHBOARD ENDPOINTS
// ============================================
export const DASHBOARD_ENDPOINTS = {
  SUMMARY: `${API_BASE}/dashboard/summary`,
  SALES_TREND: `${API_BASE}/dashboard/sales-trend`,
  FUEL_DISTRIBUTION: `${API_BASE}/dashboard/fuel-distribution`,
  CURRENT_PRICES: `${API_BASE}/dashboard/current-prices`,
  TOP_PRODUCTS: `${API_BASE}/dashboard/top-products`,
  RECENT_SALES: `${API_BASE}/dashboard/recent-sales`,
} as const;

// ============================================
// DATA ENDPOINTS
// ============================================
export const DATA_ENDPOINTS = {
  // Cloud data
  CLOUD_DATA: `${API_BASE}/data`,
  USER_DATA: `${API_BASE}/user-data`,

  // Sales
  SALES: `${API_BASE}/sales`,
  SALES_CREATE: `${API_BASE}/sales/create`,
  SALES_UPDATE: `${API_BASE}/sales/update`,
  SALES_DELETE: `${API_BASE}/sales/delete`,

  // Inventory
  INVENTORY: `${API_BASE}/inventory`,
  INVENTORY_UPDATE: `${API_BASE}/inventory/update`,

  // Prices
  PRICES: `${API_BASE}/prices`,
  PRICES_UPDATE: `${API_BASE}/prices/update`,

  // Reports
  REPORTS: `${API_BASE}/reports`,
  REPORTS_GENERATE: `${API_BASE}/reports/generate`,
} as const;

// ============================================
// SYNC ENDPOINTS
// ============================================
export const SYNC_ENDPOINTS = {
  PUSH: `${API_BASE}/sync/push`,
  PULL: `${API_BASE}/sync/pull`,
  STATUS: `${API_BASE}/sync/status`,
  CONFLICTS: `${API_BASE}/sync/conflicts`,
} as const;

// ============================================
// ALL ENDPOINTS COMBINED
// ============================================
export const API_ENDPOINTS = {
  ...AUTH_ENDPOINTS,
  ...ADMIN_ENDPOINTS,
  ...MPESA_ENDPOINTS,
  ...DASHBOARD_ENDPOINTS,
  ...DATA_ENDPOINTS,
  ...SYNC_ENDPOINTS,
} as const;

// ============================================
// API CLIENT HELPER
// ============================================

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Make an authenticated API request
 */
export async function apiRequest<T = unknown>(
  endpoint: string,
  options: ApiRequestOptions = {},
  authToken?: string,
): Promise<T> {
  const { method = "GET", headers = {}, body } = options;

  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  if (authToken) {
    requestHeaders["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(endpoint, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Default export
export default API_ENDPOINTS;
