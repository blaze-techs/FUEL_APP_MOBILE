/**
 * Fuel Interlink Bus — lightweight in-memory pub/sub for instant cross-tab
 * propagation of fuel-price and fuel-type changes.
 *
 * Cloud real-time (cloudStorageService.subscribe) already syncs persisted
 * changes across devices with a round-trip. This bus covers the in-device
 * case: when a price/type is edited in one component (e.g. Dashboard price
 * card → "Set price"), sibling components on the SAME page (PriceBoard, POS,
 * Invoice, Reports…) update instantly without waiting for the cloud echo or
 * a manual reload. It is complementary to, not a replacement for, the cloud
 * real-time subscription.
 *
 * The bus carries canonical-normalized payloads (see config/pricing.ts) so
 * consumers don't need to re-normalize. Subscribers receive the raw value and
 * the canonical fuel type key when available.
 */

import type { CanonicalFuelType } from "@/react-app/config/pricing";

export interface FuelPriceChangePayload {
  /** Raw fuel name as edited (e.g. "Super Petrol", "Diesel", "PMS"). */
  fuelType: string;
  /** Canonical key, if the raw name resolved to a known canonical type. */
  canonical?: CanonicalFuelType | null;
  /** New per-litre price (in the station's currency). */
  price: number;
  /** Where the change originated (for debugging / echo suppression). */
  source?: string;
}

export interface FuelTypeChangePayload {
  /** The fuel-type id (from fuel_types_config) when known. */
  id?: string;
  fuelType: string;
  canonical?: CanonicalFuelType | null;
  source?: string;
}

type PriceListener = (payload: FuelPriceChangePayload) => void;
type TypeListener = (payload: FuelTypeChangePayload) => void;

const priceListeners = new Set<PriceListener>();
const typeListeners = new Set<TypeListener>();

/** Broadcast a fuel-price change to all subscribers on this device. */
export function emitFuelPriceChange(payload: FuelPriceChangePayload): void {
  // Iterate over a copy so a listener can unsubscribe during dispatch.
  for (const fn of Array.from(priceListeners)) {
    try {
      fn(payload);
    } catch {
      /* listener errors must not break the bus */
    }
  }
}

/** Subscribe to fuel-price changes. Returns an unsubscribe function. */
export function onFuelPriceChange(listener: PriceListener): () => void {
  priceListeners.add(listener);
  return () => priceListeners.delete(listener);
}

/** Broadcast a fuel-type list change (add/edit/delete/activate) to subscribers. */
export function emitFuelTypeChange(payload: FuelTypeChangePayload): void {
  for (const fn of Array.from(typeListeners)) {
    try {
      fn(payload);
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to fuel-type changes. Returns an unsubscribe function. */
export function onFuelTypeChange(listener: TypeListener): () => void {
  typeListeners.add(listener);
  return () => typeListeners.delete(listener);
}

/** Shared prefill shape for cross-tab fuel price/type navigation. */
export interface FuelPricePrefill {
  /** Raw or canonical fuel name to focus/edit (e.g. "Super Petrol", "diesel"). */
  fuelType?: string;
  /** Canonical key hint (avoids re-normalization on the receiver). */
  canonical?: CanonicalFuelType;
  /** Price to pre-fill into an edit field (per litre). */
  price?: number;
  /** Amount (litres) — used when navigating to POS / Invoice quick-sale. */
  amount?: number;
  /** Optional FuelTypesManager sub-view to switch to ("fueltypes" | "pumps" | "priceboard" | "quality"). */
  view?: string;
}
