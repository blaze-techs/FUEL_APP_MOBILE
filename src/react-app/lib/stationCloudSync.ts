/**
 * Station Cloud Sync — cross-device sync for station/sales/admin data.
 *
 * Root cause this fixes: StationContext previously stored ALL station data
 * (stations, tanks, prices, sales, everything under the "fuelpro_stations_v3"
 * key) purely in browser localStorage, and its only "cloud sync" attempt
 * (`syncFromBackend`/`syncToBackend`) called a `/api/trpc/sync.*` endpoint
 * that doesn't exist in this Supabase-based deployment — it's leftover from
 * an earlier Node/Express iteration of the app (see CLAUDE_CHANGES.md). The
 * fetch always failed and was silently swallowed, so nothing ever actually
 * reached Supabase. That's why logging in on a new device/browser showed no
 * data: it was never anywhere but that one browser's localStorage, and why
 * the "first login" screen appeared again — the app had no way to know a
 * station already existed for that account.
 *
 * This module stores the whole station/admin blob as one JSON row per user
 * in the generic `app_kv` table (already provisioned by
 * supabase/migrations/002_app_kv.sql, RLS-scoped to `owner_id = auth.uid()`)
 * — the same pattern already used for secrets/feature flags/config in
 * restApiSync.ts. Cloud is treated as the source of truth once a snapshot
 * exists there: if a device's local data hasn't been pushed yet, cloud wins;
 * otherwise it's a last-write-wins by timestamp, not a field-level merge.
 */
import { supabase } from "@/supabase/client";

const COLLECTION = "station_data";

export interface StationSnapshot {
  stations: any[];
  admin?: any;
  updatedAt: number;
}

export async function pullStationSnapshot(
  ownerId: string,
): Promise<StationSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from("app_kv")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (error || !data) return null;
    return (data.data as StationSnapshot) ?? null;
  } catch (err) {
    console.warn("[stationCloudSync] pull failed, staying on local data:", err);
    return null;
  }
}

export async function pushStationSnapshot(
  ownerId: string,
  snapshot: Omit<StationSnapshot, "updatedAt">,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from("app_kv").upsert({
      id: `station_data_${ownerId}`,
      collection: COLLECTION,
      owner_id: ownerId,
      data: { ...snapshot, updatedAt: Date.now() },
    });
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    // Offline or RLS/table not migrated yet — local data is unaffected,
    // the next successful push will catch up.
    console.warn(
      "[stationCloudSync] push failed, will retry on next change:",
      err?.message,
    );
    return { success: false, error: err?.message };
  }
}
