/**
 * Pricing Mode — the station's explicit source-of-truth for how operational
 * fuel prices are populated.
 *
 * Operational station prices are manual-only. Regulator/reference data is
 * advisory and must never silently overwrite the station's selling price.
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

export function defaultPricingMode(): PricingMode {
  return "manual";
}

export function getPricingModeSync(_stationId?: string): PricingMode {
  return defaultPricingMode();
}

/**
 * Authoritative station-scoped read. Historical "auto" values are retired at
 * read time so a legacy setting cannot silently reactivate regulator writes.
 */
export async function getPricingMode(stationId?: string): Promise<PricingMode> {
  if (!stationId) return defaultPricingMode();

  const data = await cloudStorageService.getStationAuthoritative<PricingMode>(
    PRICING_MODE_KEY,
    stationId,
  );

  if (data === "manual" || data === "auto") return "manual";
  return defaultPricingMode();
}

/** Operational station pricing is manual-only. */
export async function setPricingMode(
  mode: PricingMode,
  stationId?: string,
): Promise<void> {
  if (!stationId) {
    throw new Error("Cannot persist pricing mode without a station");
  }

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

/** Regulator data can never automatically mutate operational station prices. */
export function canAutoSyncPrice(
  _source: string | undefined,
  _mode: PricingMode,
): boolean {
  return false;
}
