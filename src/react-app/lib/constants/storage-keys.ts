/**
 * CENTRALIZED STORAGE KEYS
 *
 * This is the SINGLE SOURCE OF TRUTH for all localStorage keys.
 * All code should import keys from here instead of hardcoding strings.
 *
 * Convention:
 * - Use "fuelpro_" prefix for all app keys
 * - Use version suffixes (v1, v2, v3) when schema changes
 * - Group related keys by feature
 * - Use camelCase for key names
 */

// ============================================
// AUTHENTICATION & USER
// ============================================
export const AUTH_KEYS = {
  // Token storage
  TOKEN: "fuelpro_token",

  // User data
  USER: "fuelpro_user",
  USERS: "fuelpro_users",
  USERS_V3: "fuelpro_users_v3",

  // Device identification
  DEVICE_ID: "fuelpro_device_id",

  // Session
  SESSION: "fuelpro_session",

  // Role bindings
  ROLE_BINDINGS: "fuelpro_role_bindings",

  // Clerk auth (external)
  CLERK_USER_ID: "clerk_user_id",
  CLERK_NAME: "clerk_name",
  CLERK_EMAIL: "clerk_email",
} as const;

// ============================================
// STATIONS & TENANT
// ============================================
export const STATION_KEYS = {
  // Station data
  STATIONS: "fuelpro_stations_v3",
  CURRENT_STATION: "fuelpro_current_station_v3",
  CURRENT_STATION_LEGACY: "fuelpro_current_station",

  // Admin settings
  ADMIN_SETTINGS: "fuelpro_admin_settings",
  ADMIN_SETTINGS_V2: "fuelpro_admin_settings_v2",

  // Company data
  COMPANY_DATA: "fuelpro_company_data",

  // Tax & compliance
  TAX_RATE: "fuelpro_tax_rate",
  KRA_PIN: "fuelpro_kra_pin",

  // Station currency
  STATION_CURRENCY: "fuelpro_station_currency",

  // Tab configuration
  TAB_CONFIG: "fuelpro_tab_config",
} as const;

// ============================================
// LOCATION & REGIONAL
// ============================================
export const LOCATION_KEYS = {
  // Country detection
  COUNTRY: "fuelpro_location_country",
  LOCATION: "fuelpro_user_location",

  // Coordinates
  COORDS: "fuelpro_user_coords",

  // Timezone
  TIMEZONE: "fuelpro_timezone",
} as const;

// ============================================
// FUEL & PRICING
// ============================================
export const FUEL_KEYS = {
  // Prices
  PRICES: "fuelpro_daily_prices",
  PRICE_FETCH_DATE: "fuelpro_prices_fetch_date",
  PRICE_OVERRIDE: "fuelpro_price_override",
  PRICE_UPDATE_DATE: "fuelpro_price_update_date",

  // Price board
  PRICE_BOARD: "fuelpro_priceboard_v2",
  PRICE_HISTORY: "fuelpro_price_history_v2",

  // Unified prices (new)
  UNIFIED_PRICES: "fuelpro_unified_prices",
} as const;

// ============================================
// SUBSCRIPTION & BILLING
// ============================================
export const SUBSCRIPTION_KEYS = {
  // Subscription
  SUBSCRIPTION: "fuelpro_subscription",
  SUBSCRIPTION_V1: "fuelpro_subscription_v1",
  SUBSCRIPTION_V2: "fuelpro_subscription_v2",
  SUBSCRIPTION_V3: "fuelpro_subscription_v3",

  // Pricing & coupons
  PRICING: "fuelpro_pricing",
  COUPON: "fuelpro_coupon",
  PAYMENT: "fuelpro_payment",
  TRIAL: "fuelpro_trial",

  // Feature flags
  FEATURE_FLAGS: "fuelpro_feature_flags",
} as const;

// ============================================
// SYNC & DATA
// ============================================
export const SYNC_KEYS = {
  // Sync queue
  PENDING_CHANGES: "fuelpro_pending_changes",
  SYNC_QUEUE: "fuelpro_sync_queue",
  LAST_SYNC: "fuelpro_last_sync",

  // Data versions
  DATA_VERSION: "fuelpro_data_version",
  SCHEMA_VERSION: "fuelpro_schema_version",

  // Cloud sync
  CLOUD_ENABLED: "fuelpro_cloud_enabled",
  CLOUD_LAST_SYNC: "fuelpro_cloud_last_sync",

  // Legacy sync
  LEGACY_SYNC_V1: "fuelpro_sync_v1",
  LEGACY_SYNC_V2: "fuelpro_sync_v2",
} as const;

// ============================================
// UI & APPEARANCE
// ============================================
export const UI_KEYS = {
  // Theme
  THEME: "fuelpro_theme",
  THEME_SETTINGS: "fuelpro_theme_settings",

  // Sidebar
  SIDEBAR_COLLAPSED: "fuelpro_sidebar_collapsed",
  SIDEBAR_WIDTH: "fuelpro_sidebar_width",

  // Tabs
  ACTIVE_TAB: "fuelpro_active_tab",
  TABS_CONFIG: "fuelpro_tabs_config",

  // Mobile
  MOBILE_NAV_INDEX: "fuelpro_mobile_nav_index",
} as const;

// ============================================
// SETUP & ONBOARDING
// ============================================
export const SETUP_KEYS = {
  // Setup state
  SETUP_COMPLETE: "fuelpro_setup_complete",
  ONBOARDING_COMPLETE: "fuelpro_onboarding_complete",

  // Wizard data
  WIZARD_DATA: "fuelpro_wizard_data",

  // First login
  FIRST_LOGIN: "fuelpro_first_login",

  // Welcome
  WELCOME_SHOWN: "fuelpro_welcome_shown",
} as const;

// ============================================
// ALL KEYS COMBINED (for iteration/cleanup)
// ============================================
export const ALL_STORAGE_KEYS = {
  ...AUTH_KEYS,
  ...STATION_KEYS,
  ...LOCATION_KEYS,
  ...FUEL_KEYS,
  ...SUBSCRIPTION_KEYS,
  ...SYNC_KEYS,
  ...UI_KEYS,
  ...SETUP_KEYS,
} as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get a prefixed storage key
 */
export function getKey(prefix: string, key: string): string {
  return `${prefix}_${key}`;
}

/**
 * Check if a key exists in localStorage
 */
export function hasKey(key: string): boolean {
  return localStorage.getItem(key) !== null;
}

/**
 * Safely get a value from localStorage
 */
export function safeGet<T = string>(key: string, defaultValue: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely set a value to localStorage
 */
export function safeSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a key from localStorage
 */
export function safeRemove(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear all app-related keys from localStorage
 */
export function clearAllAppKeys(): number {
  let cleared = 0;
  for (const key of Object.values(ALL_STORAGE_KEYS)) {
    if (safeRemove(key)) cleared++;
  }
  return cleared;
}

// Default export for convenience
export default ALL_STORAGE_KEYS;
