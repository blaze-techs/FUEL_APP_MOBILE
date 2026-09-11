/**
 * Station Snapshot Service
 *
 * Lets a station OWNER publish a compact, read-only snapshot of the station's
 * operational data to a PUBLIC Supabase Storage object. A team member who
 * logged in via an Access Code (and therefore has NO Supabase session — RLS
 * would block them from app_kv) can fetch this snapshot via its public URL
 * and view the approved sections read-only.
 *
 * The snapshot is stored at:
 *   fuelpro-files/station-snapshots/<stationId>/snapshot.json
 * The `fuelpro-files` bucket is PUBLIC (fuelpro_files_public_read policy),
 * so the object is fetchable with a plain GET (no Authorization header).
 *
 * SECURITY: the snapshot contains ONLY operational station data (prices,
 * pump readings, recent sales, credit accounts by name, expenses by
 * category). It NEVER contains secrets, passwords, or PII beyond what the
 * owner explicitly chooses to share. It is read-only by design.
 */

import { getSupabaseClient } from "@/supabase/client";

const BUCKET = "fuelpro-files";
const SNAPSHOT_PATH = (stationId: string) =>
  `station-snapshots/${stationId}/snapshot.json`;

export interface StationSnapshot {
  stationId: string;
  stationName: string;
  stationLocation?: string;
  currency: string;
  country?: string;
  updatedAt: number;
  // Approved-section data (filtered by allowedTabs on the viewer side)
  fuelPrices: Array<{ label: string; price: number; code?: string }>;
  pumps: Array<{ fuel: string; count: number }>;
  tankLevels: Array<{ fuel: string; opening: number; closing: number }>;
  recentSales: Array<{
    invoice?: string;
    date?: string;
    total?: number;
    fuel?: string;
    litres?: number;
    payment?: string;
  }>;
  salesKpis: {
    totalRevenue: number;
    totalFuelSold: number;
    transactionCount: number;
  };
  creditAccounts: Array<{
    name: string;
    balance: number;
    limit: number;
    status?: string;
  }>;
  expenses: Array<{ category: string; amount: number; date?: string }>;
  invoices: Array<{
    number?: string;
    customer?: string;
    total?: number;
    date?: string;
    status?: string;
  }>;
  offloading: Array<{
    truck?: string;
    fuel?: string;
    litres?: number;
    date?: string;
  }>;
  employees: Array<{ name: string; role: string; status?: string }>;
  companyData: {
    name?: string;
    phone?: string;
    email?: string;
    kraPin?: string;
    vatNumber?: string;
  };
}

const EMPTY_SNAPSHOT: StationSnapshot = {
  stationId: "",
  stationName: "",
  currency: "USD",
  updatedAt: 0,
  fuelPrices: [],
  pumps: [],
  tankLevels: [],
  recentSales: [],
  salesKpis: { totalRevenue: 0, totalFuelSold: 0, transactionCount: 0 },
  creditAccounts: [],
  expenses: [],
  invoices: [],
  offloading: [],
  employees: [],
  companyData: {},
};

/**
 * The deterministic PUBLIC URL for a station snapshot. Anyone can GET this
 * (no Authorization header) because the bucket is public.
 */
export function getStationSnapshotUrl(stationId: string): string {
  const url =
    (import.meta as any).env?.VITE_SUPABASE_URL ||
    "https://ojjscjwatikixlpshmub.supabase.co";
  return `${url}/storage/v1/object/public/${BUCKET}/${SNAPSHOT_PATH(
    stationId,
  )}?t=${Date.now()}`; // cache-bust
}

/**
 * Fetch the public snapshot (no auth required). Used by the StationAccess
 * viewer for members logged in via access code.
 */
export async function getStationSnapshot(
  stationId: string,
): Promise<StationSnapshot | null> {
  try {
    const res = await fetch(getStationSnapshotUrl(stationId), {
      // public object — no Authorization header
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.stationId) return null;
    return { ...EMPTY_SNAPSHOT, ...data } as StationSnapshot;
  } catch (err) {
    console.error("Failed to fetch station snapshot:", err);
    return null;
  }
}

/**
 * Publish (or refresh) the station snapshot. Must be called while the OWNER
 * is logged in (uses the authenticated Supabase client to upload). The
 * uploaded object is then publicly readable.
 */
export async function publishStationSnapshot(
  stationId: string,
  snapshot: Omit<StationSnapshot, "updatedAt">,
): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const full: StationSnapshot = {
      ...snapshot,
      stationId,
      updatedAt: Date.now(),
    };
    const blob = new Blob([JSON.stringify(full)], {
      type: "application/json",
    });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(SNAPSHOT_PATH(stationId), blob, {
        cacheControl: "60",
        upsert: true, // overwrite the previous snapshot
        contentType: "application/json",
      });
    if (error) {
      console.error("Failed to publish station snapshot:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to publish station snapshot:", err);
    return false;
  }
}
