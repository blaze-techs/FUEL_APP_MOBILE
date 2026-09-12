/**
 * Pricing Mode — the station/user's explicit choice of how fuel prices are
 * populated, so prices stay STABLE and UNIFORM across the whole app.
 *
 *   "manual" — prices only change when the user (or an explicitly queued
 *              Price Scheduler entry) sets them. The regulator/EPRA
 *              auto-sync NEVER writes.
 *   "auto"   — regulator/EPRA published prices auto-populate entries the
 *              user hasn't manually set (source "auto"). Scheduled changes
 *              and user edits are still protected from being overwritten.
 *
 * The mode is persisted per-station (cloud key `pricing_mode`, cross-device)
 * with a localStorage read-through cache so the UI renders instantly.
 */

import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export type PricingMode = "manual" | "auto";

export const PRICING_MODE_KEY = "pricing_mode";
export const PRICING_MODE_LOCAL_KEY = "fuelpro_pricing_mode";

export interface PricingModeMeta {
  id: PricingMode;
  label: string;
  description: string;
}

export const PRICING_MODES: PricingModeMeta[] = [
  {
    id: "manual",
    label: "Manual",
    description:
      "Prices only change when you set them (or a scheduled change applies). Regulator auto-sync is OFF — nothing overwrites your prices.",
  },
  {
    id: "auto",
    label: "Auto (regulator)",
    description:
      "Published regulator/EPRA prices auto-populate fuels you haven't set. Your manual and scheduled prices are never overwritten.",
  },
];

/** Default mode is MANUAL for every station: prices only change when the
 * user (or an explicitly queued Price Scheduler entry) sets them. The
 * regulator/EPRA auto-sync is opt-in via the Pricing Mode selector, so a
 * station's already-set prices are never silently overwritten out of the
 * box. */
export function defaultPricingMode(): PricingMode {
  return "manual";
}

/** Synchronous read (localStorage cache) for instant first render. */
export function getPricingModeSync(stationId?: string): PricingMode {
  try {
    const cached = cloudStorageService.getCached<PricingMode>(
      PRICING_MODE_KEY,
      stationId,
    );
    if (cached === "manual" || cached === "auto") return cached;
    const local = localStorage.getItem(PRICING_MODE_LOCAL_KEY);
    if (local === "manual" || local === "auto") return local;
  } catch {
    /* ignore */
  }
  return defaultPricingMode();
}

/** Async authoritative read from cloud (falls back to the sync default). */
export async function getPricingMode(stationId?: string): Promise<PricingMode> {
  try {
    const data = await cloudStorageService.get<PricingMode>(
      PRICING_MODE_KEY,
      stationId,
    );
    if (data === "manual" || data === "auto") return data;
  } catch {
    /* ignore */
  }
  return getPricingModeSync(stationId);
}

/** Persist the mode (cloud + localStorage cache). */
export async function setPricingMode(
  mode: PricingMode,
  stationId?: string,
): Promise<void> {
  try {
    localStorage.setItem(PRICING_MODE_LOCAL_KEY, mode);
    await cloudStorageService.set(PRICING_MODE_KEY, mode, stationId);
  } catch {
    /* ignore — mode still applies for this session */
  }
}

export function pricingModeLabel(mode: PricingMode): string {
  return PRICING_MODES.find((m) => m.id === mode)?.label ?? mode;
}

export function pricingModeDescription(mode: PricingMode): string {
  return (
    PRICING_MODES.find((m) => m.id === mode)?.description ??
    "Prices are managed by the station."
  );
}

/**
 * Whether the regulator/EPRA auto-sync may write to a given fuel price entry.
 * Only "auto"-sourced (or unmarked legacy) entries are eligible, and only when
 * the station's pricing mode is "auto". "user" and "scheduled" entries are
 * always protected — this is what stops the Price Scheduler's applied price
 * from being silently reverted by the national source.
 */
export function canAutoSyncPrice(
  source: string | undefined,
  mode: PricingMode,
): boolean {
  if (mode !== "auto") return false;
  return source === "auto" || source === undefined;
}
