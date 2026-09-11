/**
 * Utility helpers - Common browser/environment utilities
 */

// Check if running in browser environment
export const isBrowser = typeof window !== "undefined";

// BroadcastChannel for cross-tab sync
export const broadcastChannel =
  isBrowser && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("fuelpro_sync")
    : null;
