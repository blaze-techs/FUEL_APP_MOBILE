/**
 * price-history.ts — central recorder for station fuel price changes.
 *
 * The "Rate History" sub-tab (FuelRateHistory) reads the `price_history_data`
 * cloud key, but only PriceBoard ever wrote to it — price changes made in
 * Fuel Type Manager, applied by the Price Scheduler, or set from Dashboard /
 * Fuel Price Finder never appeared in the audit trail.
 *
 * This module is the single write path: every price-change source funnels
 * through recordPriceChange(), which appends an entry to the shared cloud
 * key with a dedup guard (same fuel + same new price within a few seconds
 * is one logical change, not two) so components that both write their own
 * entry AND call syncPriceToFuelTypes() don't double-record.
 */
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export const PRICE_HISTORY_KEY = "price_history_data";

export interface PriceChangeRecord {
  id: string;
  priceEntryId?: string;
  fuelType?: string;
  label?: string;
  oldPrice: number;
  newPrice: number;
  price?: number; // legacy alias read by FuelRateHistory
  changedBy: string;
  reason: string;
  changedAt: string;
  date?: string; // legacy alias read by FuelRateHistory
}

/** Window within which an identical (fuel, newPrice) record is treated as
 *  the same logical change (PriceBoard writes its own entry, then calls
 *  syncPriceToFuelTypes which would otherwise write a second one). */
const DEDUP_WINDOW_MS = 10_000;

// In-memory mirror of the last write per fuel so rapid successive calls in
// the same session dedupe without a cloud round-trip.
const lastWrite = new Map<string, { newPrice: number; at: number }>();

export interface RecordPriceChangeInput {
  fuelType: string;
  oldPrice: number | null | undefined;
  newPrice: number;
  changedBy: string;
  reason?: string;
  stationId?: string;
  priceEntryId?: string;
}

/**
 * Appends a price-change record to `price_history_data`. No-op when the
 * price didn't actually change or when the same change was just recorded.
 * Never throws — history must never break the price update itself.
 */
export async function recordPriceChange(
  input: RecordPriceChangeInput,
): Promise<void> {
  try {
    const { fuelType, newPrice, stationId } = input;
    if (!fuelType || !Number.isFinite(newPrice) || newPrice <= 0) return;
    const oldPrice =
      typeof input.oldPrice === "number" && Number.isFinite(input.oldPrice)
        ? input.oldPrice
        : 0;
    if (oldPrice === newPrice) return;

    const key = fuelType.toLowerCase();
    const now = Date.now();
    const prev = lastWrite.get(key);
    if (prev && prev.newPrice === newPrice && now - prev.at < DEDUP_WINDOW_MS) {
      return; // same logical change already recorded
    }
    lastWrite.set(key, { newPrice, at: now });

    const existing =
      (await cloudStorageService.get<PriceChangeRecord[]>(
        PRICE_HISTORY_KEY,
        stationId,
      )) || [];

    // Cloud-side dedup: if the newest record for this fuel already has the
    // same new price and is fresh, skip (covers the PriceBoard double-write
    // path across its own entry + the sync call).
    const latestForFuel = [...existing]
      .filter(
        (h) =>
          (h.fuelType || h.label || "").toLowerCase() === key ||
          // FuelRateHistory normalizes by label; PriceBoard entries carry
          // fuelType only. Compare against both.
          (h.label || "").toLowerCase() === key,
      )
      .sort((a, b) => (b.changedAt || "").localeCompare(a.changedAt || ""))[0];
    if (latestForFuel) {
      const latestPrice = latestForFuel.newPrice ?? latestForFuel.price ?? 0;
      const latestAt = Date.parse(latestForFuel.changedAt || "") || 0;
      if (
        latestPrice === newPrice &&
        Math.abs(now - latestAt) < DEDUP_WINDOW_MS
      ) {
        return;
      }
    }

    const iso = new Date(now).toISOString();
    const entry: PriceChangeRecord = {
      id: `ph_${now}_${Math.random().toString(36).slice(2, 7)}`,
      priceEntryId: input.priceEntryId,
      fuelType,
      label: fuelType,
      oldPrice,
      newPrice,
      price: newPrice,
      changedBy: input.changedBy,
      reason: input.reason || "Price update",
      changedAt: iso,
      date: iso,
    };

    // Cap the trail at 500 entries so the cloud row stays small.
    const next = [entry, ...existing].slice(0, 500);
    await cloudStorageService.set(PRICE_HISTORY_KEY, next, stationId);
  } catch {
    /* history is best-effort — never break the caller */
  }
}
