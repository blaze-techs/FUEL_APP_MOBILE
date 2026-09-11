/**
 * CENTRALIZED EVENT NAMES
 *
 * Standardized event naming convention: "fuelpro:event-name"
 * Using colon separator for namespace consistency
 */

// ============================================
// APP EVENTS
// ============================================
export const APP_EVENTS = {
  // App lifecycle
  APP_RELOAD: "fuelpro:app-reload",
  APP_READY: "fuelpro:app-ready",
  APP_ERROR: "fuelpro:app-error",

  // Theme
  THEME_CHANGE: "fuelpro:theme-change",
  THEME_TOGGLE: "fuelpro:theme-toggle",
} as const;

// ============================================
// AUTH EVENTS
// ============================================
export const AUTH_EVENTS = {
  LOGIN: "fuelpro:auth-login",
  LOGOUT: "fuelpro:auth-logout",
  SESSION_EXPIRED: "fuelpro:auth-session-expired",
  TOKEN_REFRESH: "fuelpro:auth-token-refresh",
  FORCE_REFRESH: "fuelpro:force-auth-refresh",
} as const;

// ============================================
// STATION EVENTS
// ============================================
export const STATION_EVENTS = {
  SELECTED: "fuelpro:station-selected",
  CHANGED: "fuelpro:station-changed",
  CREATED: "fuelpro:station-created",
  UPDATED: "fuelpro:station-updated",
  DELETED: "fuelpro:station-deleted",
} as const;

// ============================================
// SALES EVENTS
// ============================================
export const SALES_EVENTS = {
  SALE_MADE: "fuelpro:sale-made",
  SALE_UPDATED: "fuelpro:sale-updated",
  SALE_DELETED: "fuelpro:sale-deleted",
  SALE_REFUNDED: "fuelpro:sale-refunded",
} as const;

// ============================================
// INVENTORY EVENTS
// ============================================
export const INVENTORY_EVENTS = {
  UPDATE: "fuelpro:inventory-update",
  LOW_STOCK: "fuelpro:inventory-low-stock",
  RESTOCK: "fuelpro:inventory-restock",
} as const;

// ============================================
// TAB EVENTS
// ============================================
export const TAB_EVENTS = {
  CHANGE: "fuelpro:tab-change",
  TAB_CHANGED: "fuelpro:tab-changed",
} as const;

// ============================================
// SYNC EVENTS
// ============================================
export const SYNC_EVENTS = {
  STARTED: "fuelpro:sync-started",
  COMPLETED: "fuelpro:sync-completed",
  FAILED: "fuelpro:sync-failed",
  CLOUD_SYNC: "fuelpro-cloud-sync",
} as const;

// ============================================
// PRICE EVENTS
// ============================================
export const PRICE_EVENTS = {
  CHANGE: "fuelpro:fuel-price-change",
  UPDATED: "fuelpro:price-updated",
  EPRA_UPDATE: "fuelpro:epra-price-update",
} as const;

// ============================================
// DATA EVENTS
// ============================================
export const DATA_EVENTS = {
  EXPORT: "fuelpro:data-export",
  IMPORT: "fuelpro:data-import",
  BACKUP: "fuelpro:data-backup",
  RESTORE: "fuelpro:data-restore",
} as const;

// ============================================
// ALL EVENTS COMBINED
// ============================================
export const ALL_EVENTS = {
  ...APP_EVENTS,
  ...AUTH_EVENTS,
  ...STATION_EVENTS,
  ...SALES_EVENTS,
  ...INVENTORY_EVENTS,
  ...TAB_EVENTS,
  ...SYNC_EVENTS,
  ...PRICE_EVENTS,
  ...DATA_EVENTS,
} as const;

// ============================================
// EVENT EMITTER UTILITIES
// ============================================

type EventCallback = (data?: unknown) => void;

/**
 * Emit a custom event
 */
export function emitEvent(event: string, data?: unknown): boolean {
  try {
    window.dispatchEvent(new CustomEvent(event, { detail: data }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to a custom event
 */
export function onEvent(event: string, callback: EventCallback): () => void {
  const handler = (e: Event) => {
    callback((e as CustomEvent).detail);
  };
  window.addEventListener(event, handler);
  return () => window.removeEventListener(event, handler);
}

/**
 * Emit to BroadcastChannel (for cross-tab sync)
 */
export function broadcastEvent(
  channel: string,
  event: string,
  data?: unknown,
): boolean {
  try {
    const bc = new BroadcastChannel(channel);
    bc.postMessage({ event, data, timestamp: Date.now() });
    bc.close();
    return true;
  } catch {
    return false;
  }
}

// Default export
export default ALL_EVENTS;
