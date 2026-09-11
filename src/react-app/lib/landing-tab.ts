/**
 * landing-tab.ts — resolves which top-level tab opens on login.
 *
 * The user preference (`defaultTab`) is picked in General Settings →
 * "Default Landing Tab". The dropdown there lists every tab registered in
 * `state.tabConfigurations`, so current AND future tabs are recognized
 * automatically. This helper validates the stored preference against the
 * registry (graceful fallback to "dashboard" if the tab was removed,
 * hidden, or never registered) and optionally honors "remember last tab"
 * (reopens the tab the owner last had open instead of the saved default).
 */
import type { TabConfiguration } from "@/react-app/context/FuelContext";
import type { UserPreferences } from "@/react-app/lib/user-preferences";

export const FALLBACK_TAB = "dashboard";
export const LAST_TAB_STORAGE_KEY = "fuelpro_last_active_tab";
/** SessionStorage flag set right before a PREVIEW tab-switch so the
 *  router does not overwrite the saved "last used tab" while previewing
 *  (otherwise the preview would clobber the owner's real last tab). */
export const PREVIEW_FLAG_KEY = "fuelpro_landing_preview";

type LandingTabConfigs =
  Pick<TabConfiguration, "id" | "visible">[] | undefined | null;

/** True when the tab id is registered (visibility is not required — the
 *  owner may have picked the tab before hiding it). */
export function validateTabId(
  tabId: string | null | undefined,
  configs: LandingTabConfigs,
): boolean {
  if (!tabId) return false;
  if (!configs || !Array.isArray(configs) || configs.length === 0) {
    // Registry not loaded yet: allow built-ins only (fail-closed for
    // arbitrary ids so a stale value can't crash the router).
    return tabId === FALLBACK_TAB;
  }
  return configs.some((t) => t.id === tabId);
}

/**
 * Returns the tab id to open on login.
 * Priority (spec: remember-last wins when enabled, else saved default):
 *   1. `prefs.rememberLastTab` && a valid stored last tab (localStorage)
 *   2. `prefs.defaultTab` if valid
 *   3. "dashboard" (always registered)
 */
export function resolveLandingTab(
  prefs: Pick<UserPreferences, "defaultTab" | "rememberLastTab">,
  configs: LandingTabConfigs,
  lastTab?: string | null,
): string {
  if (prefs.rememberLastTab) {
    const stored =
      lastTab !== undefined
        ? lastTab
        : typeof window !== "undefined"
          ? window.localStorage.getItem(LAST_TAB_STORAGE_KEY)
          : null;
    if (validateTabId(stored, configs)) return stored as string;
  }
  if (validateTabId(prefs.defaultTab, configs)) return prefs.defaultTab;
  return FALLBACK_TAB;
}

/** Persists the currently open tab for the remember-last feature.
 *  Skips persistence while a landing-tab PREVIEW is in progress so the
 *  previewed tab does not become the owner's "last used tab". */
export function persistLastActiveTab(tabId: string): void {
  try {
    if (window.sessionStorage.getItem(PREVIEW_FLAG_KEY) === "1") return;
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, tabId);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

/** Marks the start of a landing-tab preview (auto-clears after `ms`). */
export function beginLandingPreview(ms = 4000): void {
  try {
    window.sessionStorage.setItem(PREVIEW_FLAG_KEY, "1");
    window.setTimeout(
      () => window.sessionStorage.removeItem(PREVIEW_FLAG_KEY),
      ms,
    );
  } catch {
    /* non-fatal */
  }
}

/** Clears the preview flag (called when the preview ends). */
export function endLandingPreview(): void {
  try {
    window.sessionStorage.removeItem(PREVIEW_FLAG_KEY);
  } catch {
    /* non-fatal */
  }
}
