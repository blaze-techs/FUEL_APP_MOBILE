/**
 * Pricing Mode — the station's explicit source-of-truth for how operational
 * fuel prices are populated.
 *
 * Mode is persisted ONLY in the station-scoped cloud row. A station with no
 * saved mode has the explicit product default "manual". A cloud read failure
 * is an error, not permission to substitute stale/global mode state.
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
      "Published regulator/EPRA prices may populate fuels you have not manually set. Manual and scheduled prices remain protected.",
  },
];

/** Product default for a genuinely unconfigured station. */
export function defaultPricingMode(): PricingMode {
  return "manual";
}

/**
 * Synchronous first-render read.
 * Only a station-scoped in-memory/cache value is trusted. The old global
 * localStorage key is intentionally ignored because it can belong to another
 * station or another logged-in session.
 */
export function getPricingModeSync(stationId?: string): PricingMode {
  if (!stationId) return defaultPricingMode();

  try {
    const cached = cloudStorageService.getCached<PricingMode>(
      PRICING_MODE_KEY,
      stationId,
    );
    if (cached === "manual" || cached === "auto") return cached;
  } catch {
    // No cache is authoritative; use the product default until cloud load.
  }

  return defaultPricingMode();
}

/**
 * Authoritative station-scoped read.
 * - Missing row => explicit product default (manual).
 * - Invalid value => explicit product default (manual).
 * - Network/database failure => throws. Never substitutes stale/global state.
 */
export async function getPricingMode(stationId?: string): Promise<PricingMode> {
  if (!stationId) return defaultPricingMode();

  const data = await cloudStorageService.getStationAuthoritative<PricingMode>(
    PRICING_MODE_KEY,
    stationId,
  );

  if (data === "manual" || data === "auto") return data;
  return defaultPricingMode();
}

/**
 * Persist the station's mode. Cloud is authoritative; the local station-scoped
 * cache is updated only after the cloud write succeeds.
 */
export async function setPricingMode(
  mode: PricingMode,
  stationId?: string,
): Promise<void> {
  if (!stationId) {
    throw new Error("Cannot persist pricing mode without a station");
  }

  await cloudStorageService.setStationAuthoritative(
    PRICING_MODE_KEY,
    mode,
    stationId,
  );
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
 * Whether regulator/EPRA auto-sync may write a price entry.
 * Only explicitly auto-sourced entries (plus legacy unmarked entries) are
 * eligible, and only when the station mode is "auto".
 */
export function canAutoSyncPrice(
  source: string | undefined,
  mode: PricingMode,
): boolean {
  if (mode !== "auto") return false;
  return source === "auto" || source === undefined;
}
