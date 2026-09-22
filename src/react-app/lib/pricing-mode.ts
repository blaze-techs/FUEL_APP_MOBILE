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
      "Prices only change when an authorized user sets them or an explicitly authorized schedule applies. Published regulator/reference prices never overwrite station prices.",
  },
];

/** Product default for a genuinely unconfigured station. */
export function defaultPricingMode(): PricingMode {
  return "manual";
}

/**
 * Synchronous first-render read.
 * This is only a product default. Current state is loaded from the
 * station-scoped cloud row asynchronously.
 */
export function getPricingModeSync(_stationId?: string): PricingMode {
  // Deliberately do not return cached/local mode as authoritative state.
  // Callers must refresh from the station-scoped cloud row before treating
  // the mode as current. Manual is only the product default for first paint.
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

  // Historical "auto" mode is intentionally retired. Existing stations are
  // migrated to manual at read time so a legacy setting cannot silently
  // mutate operational prices after a later refresh/login/device change.
  if (data === "manual" || data === "auto") return "manual";
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

  // Operational fuel pricing is manual-only. Reference/regulator data remains
  // available to advisory features, but it can never become station truth
  // without an explicit user/schedule action.
  await cloudStorageService.setStationAuthoritative(
    PRICING_MODE_KEY,
    "manual",
    stationId,
  );

  if (mode !== "manual") {
    throw new Error(
      "Automatic regulator pricing is disabled for operational station prices. Use Manual pricing and explicitly authorize each change.",
    );
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
 * Whether regulator/EPRA auto-sync may write a price entry.
 *
 * Only entries explicitly marked as auto-sourced are eligible, and only when
 * the station's pricing mode is "auto". An UNMARKED entry predates the source
 * field, so there is no evidence the owner did not set it by hand — it is
 * protected rather than clobbered, exactly like "user"/"scheduled".
 */
export function canAutoSyncPrice(
  _source: string | undefined,
  _mode: PricingMode,
): boolean {
  // Operational station prices are manual-only. Regulator data is advisory
  // and can never mutate the station's recorded selling price automatically.
  return false;
}
