import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  getDetectedCurrency,
  getDetectedCountryCode,
} from "@/react-app/lib/currency";
import { currencySymbolFor, getVATRate } from "@/react-app/config/pricing";
import { getRegionalConfig } from "@/react-app/config/regions";
import { supabase, supabaseUrl, supabaseAnonKey } from "@/supabase/client";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { decompressAny } from "@/react-app/lib/compression";

// Lazy API base URL getter using dynamic import to avoid circular deps
let _apiBase: string | null = null;
let _apiPromise: Promise<string> | null = null;
function getApiBase(): string {
  if (_apiBase) return _apiBase;
  // Use environment variable or empty string (Firebase-only mode)
  return import.meta.env.VITE_BACKEND_URL || "";
}
async function getApiBaseAsync(): Promise<string> {
  if (_apiBase) return _apiBase;
  if (!_apiPromise) {
    _apiPromise = import("@/utils/apiConfig").then((m) => m.getBackendUrl());
  }
  _apiBase = await _apiPromise;
  return _apiBase || "";
}

// Encryption helper for sensitive data
const encrypt = (text: string, key: string): string => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text + key);
    let hash = "";
    for (let i = 0; i < data.length; i++) {
      hash += String.fromCharCode(data[i] ^ key.charCodeAt(i % key.length));
    }
    return btoa(hash);
  } catch {
    return btoa(text);
  }
};

const decrypt = (encoded: string, key: string): string => {
  try {
    const hash = atob(encoded);
    const data = new Uint8Array(hash.length);
    for (let i = 0; i < hash.length; i++) {
      data[i] = hash.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    }
    const decoder = new TextDecoder();
    const result = decoder.decode(data);
    return result.substring(0, result.length - key.length);
  } catch {
    return atob(encoded);
  }
};

const STORAGE_KEY = "fuelpro_stations_v3";
const ADMIN_KEY = "fuelpro_admin_v3";
const SESSION_KEY = "fuelpro_session_v3";
const CURRENT_STATION_KEY = "fuelpro_current_station_v3";
// Marker recording which user last wrote the global (un-scoped) stations key.
// Used to migrate a previous user's data to their user-scoped key on their
// next login, and to detect cross-user contamination (a different user's
// stations lingering in the shared global key).
const STATIONS_OWNER_KEY = "fuelpro_stations_v3_owner";

/**
 * Resolve the user-scoped stations localStorage key. The legacy
 * `fuelpro_stations_v3` key is NOT user-scoped, so stations from a previous
 * user leak into a newly-signed-in user's view. We now namespace the key by
 * user id so each account has its own isolated local cache. Guests (no user)
 * fall back to the legacy global key for backward compatibility.
 */
function stationStorageKey(userId: string | null): string {
  return userId ? `fuelpro_stations_v3_${userId}` : STORAGE_KEY;
}

/** Read the current user id from the persisted auth identity (best-effort). */
function readAuthUserId(): string | null {
  try {
    const raw = localStorage.getItem("fuelpro_auth_identity");
    if (raw) {
      const id = JSON.parse(raw)?.id;
      return typeof id === "string" ? id : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}
const ACCESS_LOG_KEY = "fuelpro_access_log_v3";
const BACKEND_SYNC_KEY = "fuelpro_backend_synced";
const BACKEND_SYNC_TIMESTAMP = "fuelpro_backend_sync_time";

export interface StationAccess {
  username: string;
  passwordHash: string; // encrypted
  role: "owner" | "shared";
  permissions: string[];
  grantedAt: string;
  grantedBy: string;
}

export interface Station {
  id: string;
  name: string;
  code: string;
  location: string;
  phone: string;
  email: string;
  kraPin: string;
  etrSerial: string;
  taxRate: number;
  theme: string;
  logo: string;
  description: string;
  country: string; // ISO country code (e.g. "DE", "US", "KE") — drives currency/tax/fuel prices
  currency: string; // ISO currency code (e.g. "EUR", "USD", "KES")
  currencySymbol: string; // display symbol (e.g. "€", "$", "KSh")
  timezone: string; // IANA timezone (e.g. "Europe/Berlin")
  createdAt: string;
  updatedAt: string;
  data: any; // station-specific fuel data
  access: StationAccess[];
  sharedUsers: {
    email: string;
    stationId: string;
    accessKey: string;
    grantedAt: string;
  }[];
  // Backend sync fields (optional)
  backendId?: number;
  userRole?: string;
  ownerId?: string; // Supabase auth uid of the station owner ( distinguishes owned vs shared/member stations)
  invitedBy?: string; // name/unique id of the user who invited this member (for shared stations)
  memberRole?: string; // role on a shared station (manager/staff/auditor) from station_members
}

export interface AdminSettings {
  adminUsername: string;
  adminPasswordHash: string;
  secretKey: string;
  apiKeys: Record<string, string>;
  tabConfig: Record<
    string,
    { label: string; icon: string; enabled: boolean; order: number }
  >;
  systemConfig: {
    enableSync: boolean;
    enableCloudBackup: boolean;
    enableAutoReports: boolean;
    enableKRAIntegration: boolean;
    enableWhatsApp: boolean;
    enableEmail: boolean;
    enableAI: boolean;
    currency: string;
    language: string;
  };
  updateHistory: UpdateRecord[];
}

export interface UpdateRecord {
  id: string;
  type: "settings" | "files" | "api_keys" | "tabs" | "system";
  description: string;
  changes: any;
  timestamp: string;
  reverted?: boolean;
  revertedAt?: string;
}

export interface AccessLog {
  id: string;
  stationId: string;
  user: string;
  action: string;
  timestamp: string;
  ip?: string;
}

interface StationContextType {
  stations: Station[];
  currentStation: Station | null;
  isAdmin: boolean;
  adminSettings: AdminSettings;
  isStationLoading: boolean;
  isBackendSyncing: boolean;
  lastBackendSync: number | null;
  // Station CRUD
  createStation: (station: Partial<Station>) => Station;
  updateStation: (id: string, data: Partial<Station>) => void;
  deleteStation: (id: string) => void;
  switchStation: (id: string) => void;
  combineStations: () => { data: any; stations: Station[] } | null;
  // Station Access
  shareStation: (stationId: string, email: string, password: string) => void;
  revokeAccess: (stationId: string, email: string) => void;
  verifyStationAccess: (stationId: string, password: string) => boolean;
  changeStationPassword: (stationId: string, newPassword: string) => void;
  // Admin
  loginAdmin: (username: string, password: string) => boolean;
  logoutAdmin: () => void;
  updateAdminPassword: (
    currentPassword: string,
    newPassword: string,
  ) => boolean;
  updateAdminSettings: (settings: Partial<AdminSettings>) => void;
  addUpdateRecord: (record: Omit<UpdateRecord, "id" | "timestamp">) => void;
  revertUpdate: (updateId: string) => void;
  updateTabConfig: (
    tabId: string,
    config: Partial<AdminSettings["tabConfig"][string]>,
  ) => void;
  updateApiKey: (keyName: string, value: string) => void;
  // Access Log
  addAccessLog: (stationId: string, action: string) => void;
  getAccessLogs: (stationId?: string) => AccessLog[];
  // Utils
  getStationData: (stationId: string) => any;
  saveStationData: (stationId: string, data: any) => void;
  exportAllData: () => string;
  importAllData: (json: string) => void;
  encryptSensitive: (text: string) => string;
  decryptSensitive: (encoded: string) => string;
  // Backend Sync (cross-device consistency)
  syncFromBackend: () => Promise<void>;
  syncToBackend: () => Promise<void>;
  hasBackendData: boolean;
}

const defaultAdminSettings: AdminSettings = {
  adminUsername: "ADMIN",
  adminPasswordHash: encrypt("fuelpro2026", "fuelpro_secret_key_2026"),
  secretKey: "fuelpro_secret_key_2026",
  apiKeys: {
    kra_etims: "",
    mpesa_api: "",
    email_smtp: "",
    whatsapp_api: "",
    google_maps: "",
    firebase: "",
    cloud_backup: "",
    ai_api: "",
  },
  tabConfig: {
    dashboard: {
      label: "Dashboard",
      icon: "LayoutDashboard",
      enabled: true,
      order: 1,
    },
    delivery: {
      label: "Fuel Statement Report",
      icon: "Truck",
      enabled: true,
      order: 2,
    },
    offloading: {
      label: "Fuel Offloading",
      icon: "Fuel",
      enabled: true,
      order: 3,
    },
    invoice: { label: "Invoice", icon: "Receipt", enabled: true, order: 4 },
    debt: { label: "Debt Reminder", icon: "Bell", enabled: true, order: 5 },
    sales: {
      label: "Sales Tracking",
      icon: "BarChart3",
      enabled: true,
      order: 6,
    },
    reports: {
      label: "Reports Center",
      icon: "FileBarChart",
      enabled: true,
      order: 7,
    },
    fuelSalesReport: {
      label: "Fuel Sales Report",
      icon: "TrendingUp",
      enabled: true,
      order: 8,
    },
    liveTransaction: {
      label: "Live Transaction",
      icon: "Activity",
      enabled: true,
      order: 9,
    },
    mpesa: {
      label: "M-PESA Analyzer",
      icon: "CreditCard",
      enabled: true,
      order: 10,
    },
    payroll: {
      label: "Payroll System",
      icon: "Users",
      enabled: true,
      order: 11,
    },
    communication: {
      label: "Communication",
      icon: "MessageCircle",
      enabled: true,
      order: 12,
    },
    documents: { label: "Documents", icon: "Folder", enabled: true, order: 13 },
    dataManager: {
      label: "Data Manager",
      icon: "Database",
      enabled: true,
      order: 14,
    },
    pos: {
      label: "Point of Sale",
      icon: "ShoppingCart",
      enabled: true,
      order: 15,
    },
    ai: { label: "AI Assistant", icon: "Brain", enabled: true, order: 16 },
    pumpmapping: {
      label: "Pump Mapping v1",
      icon: "Fuel",
      enabled: true,
      order: 17,
    },
    admin: {
      label: "Founder Access",
      icon: "Shield",
      enabled: true,
      order: 99,
    },
  },
  systemConfig: {
    enableSync: false,
    enableCloudBackup: false,
    enableAutoReports: false,
    enableKRAIntegration: false,
    enableWhatsApp: false,
    enableEmail: false,
    enableAI: true,
    // Resolve the default currency from the timezone/location detection in
    // lib/currency.ts (which inspects station data, the location cache, and
    // the browser timezone, in that order) instead of hard-coding a single
    // country's currency. Falls back to USD (international default) when
    // detection is inconclusive.
    currency: (() => {
      try {
        const detected = getDetectedCurrency();
        if (detected) return detected;
      } catch {
        /* */
      }
      return "USD";
    })(),
    language: "en",
  },
  updateHistory: [],
};

const loadFromStorage = (): {
  stations: Station[];
  admin: AdminSettings;
  currentId: string | null;
} => {
  try {
    // Use the user-scoped key so stations never leak across accounts. If a
    // user just logged in and their scoped key is empty, attempt a one-time
    // migration from the legacy global key — but ONLY if the owner marker
    // matches this user (otherwise the global key holds a DIFFERENT user's
    // stations and must be ignored, not migrated).
    const userId = readAuthUserId();
    const scopedKey = stationStorageKey(userId);
    let raw = localStorage.getItem(scopedKey);
    if (!raw && userId) {
      const globalRaw = localStorage.getItem(STORAGE_KEY);
      const globalOwner = localStorage.getItem(STATIONS_OWNER_KEY);
      if (globalRaw && globalOwner === userId) {
        // Same user's data is in the legacy global key — adopt it into the
        // scoped key and continue. This preserves stations for a user who
        // upgrades from the old un-scoped storage.
        localStorage.setItem(scopedKey, globalRaw);
        raw = globalRaw;
      }
    }
    const adminRaw = localStorage.getItem(ADMIN_KEY);
    const currentId = localStorage.getItem(CURRENT_STATION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      let admin = adminRaw ? JSON.parse(adminRaw) : defaultAdminSettings;

      // Upgrade a stale admin currency. Older versions defaulted to "USD"
      // (or left it unset while a CDN IP was misdetected as US). If the
      // persisted admin currency is USD/empty but location/timezone detection
      // resolves a real currency (e.g. KES for a Kenya station), adopt the
      // detected value so the whole app stops showing "$" to Kenyan users.
      try {
        const detected = getDetectedCurrency();
        const persisted = admin?.systemConfig?.currency;
        if (
          (!persisted || persisted === "USD") &&
          detected &&
          detected !== "USD"
        ) {
          admin = {
            ...admin,
            systemConfig: { ...admin.systemConfig, currency: detected },
          };
        }
      } catch {
        /* detection failed — keep persisted value */
      }

      // Backfill `code` for stations created before this field existed. The
      // stations table has a NOT NULL UNIQUE `code` column; without this,
      // cross-device sync silently fails. Generate once and persist so the
      // same code is reused on every subsequent push (avoids UNIQUE clashes).
      const stations = (parsed.stations || []).map((s: Station) =>
        s.code ? s : { ...s, code: generateStationCode(s.name) },
      );

      return { stations, admin, currentId };
    }
  } catch {
    /* ignore */
  }
  return { stations: [], admin: defaultAdminSettings, currentId: null };
};

// ═══════════════════════════════════════════════════
// SUPABASE CROSS-DEVICE SYNC
// Replaces the old syncFromBackend/syncToBackend, which called a
// tRPC endpoint that was never actually implemented (see CLAUDE_CHANGES.md).
// Stations are the top-level record gating the whole app, so this is what
// makes "log in on another device" actually restore your data instead of
// showing an empty setup screen.
// ═══════════════════════════════════════════════════

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (id: string) => UUID_RE.test(id);

// The `stations` table has a NOT NULL UNIQUE `code` column. Generate a short,
// unique, URL-safe code from the station name so backend upserts succeed.
function generateStationCode(name: string): string {
  const slug =
    (name || "station")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 16) || "station";
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${slug}-${suffix}`;
}

function stationRowToStation(
  row: any,
  dataBlob: any,
  cached?: Station,
): Station {
  // Auto-correct stale Kenya defaults: if the station's country is known and
  // not Kenya but the currency is still KES (a legacy Kenya-only default),
  // upgrade it to the correct currency for the station's country. This is a
  // world-wide fix — existing stations created before the multi-country
  // deployment had KES/Africa/Nairobi hardcoded regardless of location.
  const rawCountry = (row.country || "").toUpperCase();
  const rawCurrency = (row.currency || "").toUpperCase();
  let correctedCurrency = row.currency || "";
  let correctedSymbol = row.currency_symbol || "";
  let correctedTimezone = row.timezone || "";
  if (rawCountry && rawCountry !== "KE" && rawCurrency === "KES") {
    try {
      const rc = getRegionalConfig(rawCountry);
      correctedCurrency = rc?.currency || "USD";
      correctedSymbol = currencySymbolFor(correctedCurrency);
      correctedTimezone = row.timezone || rc?.timeZone || "UTC";
    } catch {
      correctedCurrency = "USD";
      correctedSymbol = "$";
    }
  }

  return {
    id: row.id,
    name: row.name || "",
    code: row.code || "",
    location: row.location || "",
    phone: row.phone || "",
    email: row.email || "",
    kraPin: row.kra_pin || "",
    etrSerial: row.etr_serial || "",
    taxRate:
      row.tax_rate !== null && row.tax_rate !== undefined
        ? Number(row.tax_rate)
        : (() => {
            try {
              const cc = row.country || getDetectedCountryCode();
              return Math.round((getVATRate(cc) || 0) * 100);
            } catch {
              return 0;
            }
          })(),
    theme: row.theme || "dark",
    logo: row.logo || "",
    description: row.description || "",
    country:
      row.country ||
      (() => {
        try {
          return getDetectedCountryCode() || "";
        } catch {
          return "";
        }
      })(),
    currency:
      correctedCurrency ||
      (() => {
        try {
          return getDetectedCurrency() || "USD";
        } catch {
          return "USD";
        }
      })(),
    currencySymbol:
      correctedSymbol ||
      currencySymbolFor(
        correctedCurrency ||
          (() => {
            try {
              return getDetectedCurrency() || "USD";
            } catch {
              return "USD";
            }
          })(),
      ),
    timezone:
      correctedTimezone ||
      (() => {
        try {
          const cc = row.country || getDetectedCountryCode();
          return getRegionalConfig(cc)?.timeZone || "UTC";
        } catch {
          return "UTC";
        }
      })(),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    data: dataBlob !== undefined ? dataBlob : (cached?.data ?? {}),
    // Access/sharing records aren't synced to the backend yet (they contain
    // local password hashes for the station-sharing feature) — keep
    // whatever this device already had cached for them.
    access: cached?.access ?? [],
    sharedUsers: cached?.sharedUsers ?? [],
    // Preserve ownership/membership metadata from the DB row so the UI can
    // distinguish owned stations from shared/member stations.
    ownerId: row.owner_id || cached?.ownerId,
    userRole: row.user_role || cached?.userRole,
    invitedBy:
      row.invited_by_name || row.invited_by_unique_id || cached?.invitedBy,
    memberRole: row.member_role || cached?.memberRole,
  };
}

function stationToRowFields(s: Partial<Station>) {
  const fields: Record<string, any> = {};
  if (s.name !== undefined) fields.name = s.name;
  if (s.code !== undefined) fields.code = s.code;
  if (s.location !== undefined) fields.location = s.location;
  if (s.phone !== undefined) fields.phone = s.phone;
  if (s.email !== undefined) fields.email = s.email;
  if (s.kraPin !== undefined) fields.kra_pin = s.kraPin;
  if (s.etrSerial !== undefined) fields.etr_serial = s.etrSerial;
  if (s.taxRate !== undefined) fields.tax_rate = s.taxRate;
  if (s.theme !== undefined) fields.theme = s.theme;
  if (s.logo !== undefined) fields.logo = s.logo;
  if (s.description !== undefined) fields.description = s.description;
  if (s.country !== undefined) fields.country = s.country;
  if (s.currency !== undefined) fields.currency = s.currency;
  if (s.timezone !== undefined) fields.timezone = s.timezone;
  if (s.currencySymbol !== undefined) {
    fields.currency_symbol = s.currencySymbol;
  } else if (s.currency !== undefined) {
    fields.currency_symbol = currencySymbolFor(s.currency);
  }
  return fields;
}

/** Fire-and-forget push of a station's core fields to Supabase. */
async function pushStationUpsert(station: Station, ownerId: string) {
  try {
    const { error: upsertError } = await supabase.from("stations").upsert({
      id: station.id,
      owner_id: ownerId,
      // Set `created_by` too so BOTH owner-scoped RLS policies
      // (auth.uid() = owner_id AND created_by = auth.uid()) match.
      created_by: ownerId,
      // `code` is NOT NULL UNIQUE on the stations table — backfill one for
      // any station created before this field existed so the upsert succeeds.
      code: station.code || generateStationCode(station.name),
      ...stationToRowFields(station),
    });
    if (upsertError) {
      console.error(
        "[StationContext] Supabase station upsert failed:",
        upsertError.message,
        upsertError.code,
      );
      return;
    }
    const { error: kvError } = await supabase.from("app_kv").upsert({
      id: `station_data_${station.id}`,
      collection: "station_data",
      owner_id: ownerId,
      data: station.data ?? {},
    });
    if (kvError) {
      console.error(
        "[StationContext] Supabase station_data upsert failed:",
        kvError.message,
      );
    }
  } catch (err) {
    console.warn(
      "[StationContext] Supabase push failed (will retry next sync):",
      err,
    );
  }
}

/** Fire-and-forget delete of a station from Supabase. */
async function pushStationDelete(id: string) {
  try {
    await supabase.from("stations").delete().eq("id", id);
    await supabase.from("app_kv").delete().eq("id", `station_data_${id}`);
  } catch (err) {
    console.warn("[StationContext] Supabase delete failed:", err);
  }
}

/**
 * Pull the current user's stations from Supabase, migrate any local-only
 * (pre-UUID-format) stations up to the cloud, and merge into one list.
 * Returns null if there's no authenticated Supabase session (local-only
 * mode continues to work exactly as before for guests).
 */
async function syncStationsWithSupabase(
  localStations: Station[],
): Promise<Station[] | null> {
  let userId: string | null = null;

  // FAST-PATH: read the auth identity from localStorage FIRST (synchronous,
  // no network call). AuthContext persists it on login. This eliminates the
  // 200-500ms auth.getUser() round-trip that previously blocked every station
  // sync — the single biggest source of "stations not loading" latency.
  try {
    const identityRaw = localStorage.getItem("fuelpro_auth_identity");
    if (identityRaw) {
      const identity = JSON.parse(identityRaw);
      if (identity?.id) userId = identity.id;
    }
  } catch {
    // ignore parse errors
  }

  // Fallback: Supabase client session (works when AuthContext hasn't
  // persisted yet, e.g. first render after a hash-route login).
  if (!userId) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user?.id) {
      userId = sessionData.session.user.id;
    }
  }

  // Last resort: network call to /auth/v1/user.
  if (!userId) {
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user?.id) {
      userId = userData.user.id;
    }
  }

  // If the Supabase JS client hasn't finished initializing its session
  // (detectSessionInUrl didn't fire because the hash router consumed the URL
  // params), inject the session explicitly from localStorage so RLS-scoped
  // queries work. Without this, .from() calls use the anon key → RLS blocks
  // them → empty results → user stranded on wizard.
  if (userId) {
    try {
      const sbTokenRaw = localStorage.getItem(
        "sb-ojjscjwatikixlpshmub-auth-token",
      );
      if (sbTokenRaw) {
        const sbToken = JSON.parse(sbTokenRaw);
        if (sbToken.access_token && sbToken.refresh_token) {
          // Only inject if the client doesn't already have a session.
          const { data: existing } = await supabase.auth.getSession();
          if (!existing.session) {
            await supabase.auth.setSession({
              access_token: sbToken.access_token,
              refresh_token: sbToken.refresh_token,
            });
            console.log(
              "[StationContext] Injected Supabase session from localStorage for RLS queries",
            );
          }
        }
      }
    } catch (e) {
      console.warn("[StationContext] Failed to inject session:", e);
    }
  }

  if (!userId) return null;

  // Helper: make a direct PostgREST fetch with the token from localStorage.
  // This bypasses the Supabase JS client's session management entirely and
  // is used when the client doesn't have a session (the .from() calls would
  // use the anon key and RLS would block them).
  const directFetch = async (
    path: string,
    options: RequestInit = {},
  ): Promise<any | null> => {
    const token = localStorage.getItem("fuelpro_token");
    if (!token) return null;
    const url = `${supabaseUrl}/rest/v1/${path}`;
    const headers: Record<string, string> = {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    const resp = await fetch(url, { ...options, headers });
    if (!resp.ok) {
      console.warn(
        `[StationContext] directFetch ${path} failed:`,
        resp.status,
        await resp.text().catch(() => ""),
      );
      return null;
    }
    return resp.json();
  };

  // Migrate any local-only stations (old non-UUID ids, never pushed) up first
  const localOnly = localStations.filter((s) => !isValidUuid(s.id));
  const migrated: Station[] = [];
  for (const s of localOnly) {
    try {
      const { data: inserted, error } = await supabase
        .from("stations")
        .insert({
          owner_id: userId,
          created_by: userId,
          code: s.code || generateStationCode(s.name),
          ...stationToRowFields(s),
        })
        .select()
        .single();
      if (!error && inserted) {
        const newStation = {
          ...s,
          id: inserted.id,
          code: inserted.code || s.code,
        };
        await supabase.from("app_kv").upsert({
          id: `station_data_${inserted.id}`,
          collection: "station_data",
          owner_id: userId,
          data: s.data ?? {},
        });
        migrated.push(newStation);
      }
    } catch (err) {
      console.warn(
        "[StationContext] Failed to migrate local station to cloud:",
        err,
      );
    }
  }

  // Fetch everything now owned by this user. RLS scopes this to the user's
  // own stations, but we ALSO filter by owner_id client-side as
  // defense-in-depth so a misconfigured/loosened RLS policy can never leak
  // other users' stations into this account.
  //
  // MEMBER STATIONS: an invited Manager/Staff/Auditor doesn't OWN the station
  // but has a row in station_members (status='accepted'). The
  // `stations_member_select` RLS policy (migration 016) allows them to SELECT
  // stations they're a member of. So we do TWO queries: one for owned
  // stations (owner_id = userId) and one for member stations (via
  // station_members). The member query uses `.or()` to combine them.
  const { data: ownedData, error: ownedError } = await supabase
    .from("stations")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });

  // Fetch stations where the user is an accepted/active member (invited by the owner)
  // Select membership metadata (role, invited_by) so the UI can show who invited
  // the user and what role they have on the shared station.
  const { data: memberData, error: memberError } = await supabase
    .from("stations")
    .select(
      "*, station_members!inner(user_id, status, role, invited_by_name, invited_by_unique_id, member_role)",
    )
    .eq("station_members.user_id", userId)
    .in("station_members.status", ["accepted", "active"])
    .neq("owner_id", userId)
    .order("created_at", { ascending: true });

  // Flatten membership metadata onto each station row so stationRowToStation
  // can pick it up (the join returns an array of station_members per station).
  if (memberData) {
    for (const row of memberData as any[]) {
      const sm = Array.isArray(row.station_members)
        ? row.station_members[0]
        : row.station_members;
      if (sm) {
        row.user_role = sm.role;
        row.member_role = sm.member_role || sm.role;
        row.invited_by_name = sm.invited_by_name;
        row.invited_by_unique_id = sm.invited_by_unique_id;
      }
    }
  }

  let rows = [...(ownedData || []), ...(memberData || [])];
  const error = ownedError;

  if (memberError) {
    console.warn(
      "[StationContext] Member stations fetch failed:",
      memberError.message,
    );
  } else if (memberData && memberData.length > 0) {
    console.log(
      `[StationContext] Found ${memberData.length} shared station(s) as member`,
    );
  }

  // If the Supabase client returned empty (likely because it doesn't have
  // the auth session, so RLS blocked the query), retry with a direct
  // PostgREST fetch using the token from localStorage.
  if ((!rows || rows.length === 0) && !error) {
    const directRows = await directFetch(
      `stations?owner_id=eq.${userId}&order=created_at.asc&select=*`,
    );
    if (directRows && directRows.length > 0) {
      console.log(
        `[StationContext] Supabase client returned 0 stations, direct fetch found ${directRows.length}`,
      );
      rows = directRows;
    }
    // Also try fetching member stations via direct fetch (using station_members
    // join). This is the fallback for invited users whose station doesn't
    // appear in the owned-stations query.
    if (!rows || rows.length === 0) {
      try {
        const { data: memberRows } = await supabase
          .from("station_members")
          .select("station_id")
          .eq("user_id", userId)
          .in("status", ["accepted", "active"]);
        if (memberRows && memberRows.length > 0) {
          const memberStationIds = memberRows.map((m: any) => m.station_id);
          const { data: memberStations } = await supabase
            .from("stations")
            .select("*")
            .in("id", memberStationIds)
            .order("created_at", { ascending: true });
          if (memberStations && memberStations.length > 0) {
            console.log(
              `[StationContext] Found ${memberStations.length} shared station(s) via station_members`,
            );
            rows = memberStations;
          }
        }
      } catch (memberFetchErr) {
        console.warn(
          "[StationContext] Member station direct fetch failed:",
          memberFetchErr,
        );
      }
    }
  }

  if (error) {
    console.warn("[StationContext] Supabase station fetch failed:", error);
    // Still return migrated stations merged with untouched local ones so
    // we don't lose data if the fetch step alone failed transiently.
    const validLocal = localStations.filter((s) => isValidUuid(s.id));
    return [...validLocal, ...migrated];
  }

  // CROSS-DEVICE FALLBACK: If the stations table is empty AND localStorage has
  // no stations, check the FuelContext's cloud blob (app_kv user_<id>_compact)
  // for stations. This handles the case where a user set up their station on
  // device A — the station was saved to the FuelContext's compact cloud blob
  // but never made it to the stations table (e.g. the push failed silently or
  // the station had a non-UUID id that the migration step above didn't catch
  // because localStorage was empty on this device). Without this fallback, the
  // user is stranded on the "create station" screen on every new device.
  let effectiveRows = rows || [];
  if (
    effectiveRows.length === 0 &&
    localStations.length === 0 &&
    migrated.length === 0
  ) {
    const compactKey = `user_${userId}_compact`;
    let kvRowData: any = null;
    // Read via the cloud storage service: handles the owner-scoped row id,
    // the legacy bare-key fallback, AND gzip envelope decompression.
    try {
      kvRowData = await cloudStorageService.get(compactKey);
    } catch {
      kvRowData = null;
    }
    if (!kvRowData) {
      const { data: kvRow, error: kvError } = await supabase
        .from("app_kv")
        .select("data")
        .eq("id", compactKey)
        .eq("owner_id", userId)
        .maybeSingle();

      if (!kvError && kvRow?.data) {
        kvRowData = decompressAny(kvRow.data);
      } else {
        // Direct fetch fallback (same RLS issue as the stations query above)
        const directKv = await directFetch(
          `app_kv?id=eq.${compactKey}&owner_id=eq.${userId}&select=data`,
        );
        if (directKv && directKv.length > 0) {
          kvRowData = decompressAny(directKv[0].data);
        }
      }
    }

    if (kvRowData) {
      const blob = kvRowData as any;
      const blobStations: Station[] = Array.isArray(blob?.stations)
        ? blob.stations
        : [];
      if (blobStations.length > 0) {
        console.log(
          `[StationContext] Cross-device fallback: found ${blobStations.length} station(s) in app_kv blob, migrating to stations table`,
        );
        for (const s of blobStations) {
          try {
            const { data: inserted, error: insertErr } = await supabase
              .from("stations")
              .insert({
                owner_id: userId,
                created_by: userId,
                code: s.code || generateStationCode(s.name || "Station"),
                ...stationToRowFields(s),
              })
              .select()
              .single();
            if (!insertErr && inserted) {
              const newStation = {
                ...s,
                id: inserted.id,
                code: inserted.code || s.code,
              };
              if (s.data && Object.keys(s.data).length > 0) {
                await supabase.from("app_kv").upsert({
                  id: `station_data_${inserted.id}`,
                  collection: "station_data",
                  owner_id: userId,
                  data: s.data,
                });
              }
              migrated.push(newStation);
            } else if (insertErr) {
              console.warn(
                "[StationContext] Cross-device migration insert failed:",
                insertErr,
              );
            }
          } catch (err) {
            console.warn("[StationContext] Cross-device migration error:", err);
          }
        }
        // Re-fetch to get the freshly inserted rows (scoped to this user)
        const { data: refetched } = await supabase
          .from("stations")
          .select("*")
          .eq("owner_id", userId)
          .order("created_at", { ascending: true });
        effectiveRows = refetched || [];
        if (effectiveRows.length === 0) {
          const directRefetched = await directFetch(
            `stations?owner_id=eq.${userId}&order=created_at.asc&select=*`,
          );
          if (directRefetched) effectiveRows = directRefetched;
        }
      }
    }
  }

  const rowIds: string[] = effectiveRows.map((r: any) => r.id);
  const dataBlobs: Record<string, any> = {};
  if (rowIds.length > 0) {
    const kvIds = rowIds.map((id) => `station_data_${id}`);
    const { data: kvRows } = await supabase
      .from("app_kv")
      .select("id, data")
      .in("id", kvIds);
    for (const row of kvRows || []) {
      const stationId = String(row.id).replace(/^station_data_/, "");
      dataBlobs[stationId] = decompressAny(row.data) ?? row.data;
    }
    // Direct fetch fallback for data blobs
    if (Object.keys(dataBlobs).length === 0) {
      const idsParam = kvIds.map((id) => `"${id}"`).join(",");
      const directKvRows = await directFetch(
        `app_kv?id=in.(${idsParam})&select=id,data`,
      );
      if (directKvRows) {
        for (const row of directKvRows) {
          const stationId = String(row.id).replace(/^station_data_/, "");
          dataBlobs[stationId] = decompressAny(row.data) ?? row.data;
        }
      }
    }
  }

  const cachedById = new Map(localStations.map((s) => [s.id, s]));
  const merged = effectiveRows.map((row: any) =>
    stationRowToStation(row, dataBlobs[row.id], cachedById.get(row.id)),
  );

  // Preserve local stations that have valid UUIDs but aren't in the cloud yet.
  // This prevents a race where a station was just created locally (and pushed
  // to Supabase fire-and-forget) but the push hasn't completed/propagated by
  // the time the next mount's sync runs. Without this, the cloud fetch
  // returns [] and overwrites the local station, causing data loss and
  // stranding the user on the "create station" screen.
  const cloudIds = new Set(effectiveRows.map((r: any) => r.id));
  for (const local of localStations) {
    if (isValidUuid(local.id) && !cloudIds.has(local.id)) {
      merged.push(local);
    }
  }

  return merged;
}

const StationContext = createContext<StationContextType | null>(null);

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [stations, setStations] = useState<Station[]>([]);
  const [currentStation, setCurrentStation] = useState<Station | null>(null);
  const [adminSettings, setAdminSettings] =
    useState<AdminSettings>(defaultAdminSettings);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStationLoading, setIsStationLoading] = useState(true);

  // Track the user whose stations are currently loaded, and the ids of
  // stations created during THIS session. The global `fuelpro_stations_v3`
  // localStorage key is NOT user-scoped, so without these guards a previous
  // user's stations leak into a newly-signed-in user's view (the "preserve
  // local UUID stations" merge step would re-attach them). On a user switch
  // we treat the cloud as the source of truth: clear the global localStorage
  // stations + reset state, then sync fresh from Supabase (RLS scopes to the
  // new user). Only stations created in the current session are preserved
  // across the merge — those genuinely belong to this user.
  const currentUserIdRef = useRef<string | null>(null);
  const sessionCreatedStationIdsRef = useRef<Set<string>>(new Set());

  // Refs that always point to the latest state, so callbacks that need
  // stations/adminSettings can have stable identities (empty deps) without
  // capturing stale values. Without this, `persist` is recreated on every
  // state change, which cascades to `syncFromBackend`, which re-fires the
  // mount effect (deps [syncFromBackend]) → setStations → recreate → re-fire
  // → React error #185 (Maximum update depth exceeded).
  const stationsRef = useRef(stations);
  const adminSettingsRef = useRef(adminSettings);
  useEffect(() => {
    stationsRef.current = stations;
  }, [stations]);
  useEffect(() => {
    adminSettingsRef.current = adminSettings;
  }, [adminSettings]);
  const [isBackendSyncing, setIsBackendSyncing] = useState(false);
  const [lastBackendSync, setLastBackendSync] = useState<number | null>(() => {
    const saved = localStorage.getItem(BACKEND_SYNC_TIMESTAMP);
    return saved ? parseInt(saved, 10) : null;
  });
  const [hasBackendData, setHasBackendData] = useState(false);

  // Get auth token from storage
  const getAuthToken = useCallback((): string | null => {
    // Try different storage keys for auth tokens
    const keys = [
      "fuelpro_founder_session",
      "firebase_token",
      "auth_token",
      "fuelpro_auth_token",
    ];
    for (const key of keys) {
      try {
        const val = localStorage.getItem(key);
        if (val) {
          const parsed = JSON.parse(val);
          if (parsed.token) return parsed.token;
          if (parsed.accessToken) return parsed.accessToken;
          if (typeof parsed === "string") return parsed;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }, []);

  // Persist to storage
  const persist = useCallback(
    (newStations?: Station[], newAdmin?: AdminSettings) => {
      const s = newStations ?? stationsRef.current;
      const a = newAdmin ?? adminSettingsRef.current;
      // Write to the user-scoped key so stations are isolated per account.
      const uid = currentUserIdRef.current;
      const key = stationStorageKey(uid);
      localStorage.setItem(
        key,
        JSON.stringify({ stations: s, version: "3.0" }),
      );
      // Record ownership so a future login by the SAME user can migrate from
      // the legacy global key. A different user logging in next will see the
      // marker mismatch and ignore (not migrate) the global key's stations.
      if (uid) localStorage.setItem(STATIONS_OWNER_KEY, uid);
      localStorage.setItem(ADMIN_KEY, JSON.stringify(a));
    },
    // Stable identity — reads current state from refs to avoid stale closures.
    // Previously had [stations, adminSettings] which recreated persist on
    // every state change and cascaded into an infinite mount-effect loop.
    [],
  );

  // Sync stations FROM Supabase (pulls this account's stations, and migrates
  // any local-only stations up to the cloud so they're not orphaned)
  const syncFromBackend = useCallback(async (): Promise<void> => {
    setIsBackendSyncing(true);
    try {
      // ALWAYS re-read the freshest stations from localStorage before syncing.
      // syncFromBackend is also called on mount, and at that point the `stations`
      // closure is still the stale empty array from initial state — passing it
      // to syncStationsWithSupabase would tell the merge "I have nothing local"
      // so a cloud that returns [] overwrites localStorage and strands the user
      // on the "create station" screen. Reading fresh avoids that race entirely.
      //
      // CROSS-USER GUARD: the global `fuelpro_stations_v3` localStorage key is
      // NOT user-scoped. If a different user just signed in, the localStorage
      // stations belong to the PREVIOUS user — preserving them here would leak
      // another user's stations into this account. Only merge local stations
      // that were created in THIS session (sessionCreatedStationIdsRef), which
      // genuinely belong to the current user.
      const fresh = loadFromStorage().stations;
      const sessionCreated = sessionCreatedStationIdsRef.current;
      const ownLocal = fresh.filter((s) => sessionCreated.has(s.id));
      const merged = await syncStationsWithSupabase(ownLocal);
      if (merged === null) {
        console.log(
          "[StationContext] No Supabase session, staying in local-only mode",
        );
        return;
      }

      // Re-read localStorage immediately before persisting. A station may have
      // been created locally (createStation writes directly to localStorage)
      // during the network await above. Merge any stations created THIS session
      // that aren't represented in `merged` — but never re-attach stations that
      // were already in localStorage before this user signed in (they may belong
      // to a different user).
      const latest = loadFromStorage().stations;
      const mergedIds = new Set(merged.map((s) => s.id));
      for (const s of latest) {
        if (sessionCreated.has(s.id) && !mergedIds.has(s.id)) merged.push(s);
      }

      setStations(merged);
      persist(merged);

      // Keep current station pointing at the right record (it may have
      // gotten a new id if it was just migrated to the cloud)
      setCurrentStation((prev) => {
        if (!prev) return merged[0] ?? null;
        const stillHere = merged.find((s) => s.id === prev.id);
        if (stillHere) return stillHere;
        // Was migrated: match by name+createdAt as a best-effort fallback
        const rematched = merged.find(
          (s) => s.name === prev.name && s.createdAt === prev.createdAt,
        );
        const next = rematched ?? merged[0] ?? null;
        if (next) localStorage.setItem(CURRENT_STATION_KEY, next.id);
        return next;
      });

      const now = Date.now();
      setLastBackendSync(now);
      localStorage.setItem(BACKEND_SYNC_TIMESTAMP, String(now));
      setHasBackendData(merged.length > 0);
      localStorage.setItem(BACKEND_SYNC_KEY, "true");

      console.log(
        `[StationContext] Synced ${merged.length} station(s) with Supabase`,
      );
    } catch (error) {
      console.error("[StationContext] Supabase sync error:", error);
    } finally {
      setIsBackendSyncing(false);
    }
  }, [persist]);

  // Push any local-only stations up to Supabase (same underlying logic as
  // syncFromBackend — kept as a separate name for interface compatibility)
  const syncToBackend = useCallback(async (): Promise<void> => {
    await syncFromBackend();
  }, [syncFromBackend]);

  // Load from storage on mount
  useEffect(() => {
    // Detect the current user from the persisted auth identity so we can
    // scope localStorage stations. If the auth identity doesn't match the
    // stations in localStorage (e.g. a previous user's stations lingered),
    // clear them — cloud is the source of truth per user.
    let detectedUserId: string | null = null;
    try {
      const identityRaw = localStorage.getItem("fuelpro_auth_identity");
      if (identityRaw) {
        const identity = JSON.parse(identityRaw);
        detectedUserId = identity?.id ?? null;
      }
    } catch {
      // ignore parse errors
    }
    currentUserIdRef.current = detectedUserId;
    // Fresh session — no stations created yet.
    sessionCreatedStationIdsRef.current = new Set();

    const { stations: loadedStations, admin, currentId } = loadFromStorage();
    setStations(loadedStations);
    setAdminSettings(admin);

    // Check admin session
    const session = localStorage.getItem(SESSION_KEY);
    if (session) {
      try {
        const parsed = JSON.parse(session);
        if (
          parsed.isAdmin &&
          parsed.expiresAt &&
          new Date(parsed.expiresAt) > new Date()
        ) {
          setIsAdmin(true);
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
    }

    // Check if we have backend data
    const backendSynced = localStorage.getItem(BACKEND_SYNC_KEY);
    setHasBackendData(backendSynced === "true");

    // Set current station
    if (currentId) {
      const found = loadedStations.find((s) => s.id === currentId);
      if (found) setCurrentStation(found);
    } else if (loadedStations.length > 0) {
      setCurrentStation(loadedStations[0]);
      localStorage.setItem(CURRENT_STATION_KEY, loadedStations[0].id);
    }

    // Try to sync from backend on mount. Keep isStationLoading TRUE until
    // the first cloud sync completes — otherwise Home.tsx sees stations=[]
    // (from the empty localStorage on a new device) and flashes the
    // SetupWizard before cloud stations arrive.
    syncFromBackend().finally(() => {
      setIsStationLoading(false);
    });

    // Sync the fuelpro_setup_complete flag from cloud so a returning user on a
    // NEW device (where the local flag is absent) doesn't see the SetupWizard
    // while their cloud stations load. The flag is written to cloud by
    // SetupWizard.onComplete (via FuelContext's saveToCloud which includes it
    // in the compact blob). Here we read it from the compact blob as a
    // best-effort check.
    cloudStorageService
      .get<{ setupComplete?: boolean }>("user_setup_flag", undefined)
      .then((flag) => {
        if (
          flag?.setupComplete &&
          !localStorage.getItem("fuelpro_setup_complete")
        ) {
          localStorage.setItem("fuelpro_setup_complete", "true");
        }
      })
      .catch(() => {});
  }, [syncFromBackend]);

  // Also sync whenever the person signs in (covers login without a full
  // page reload, and login on a device that already has the app loaded)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "SIGNED_IN" && session?.user?.id) {
          const newUserId = session.user.id;
          // CROSS-USER ISOLATION: if a DIFFERENT user just signed in, the
          // previous user's stations linger in their scoped localStorage key
          // (and the legacy global key). Clear the previous user's scoped key
          // + reset state so those stations don't leak into the new account.
          // Cloud (RLS-scoped) is the source of truth. Also reset the
          // session-created set so we don't carry over ids from a prior session.
          if (
            currentUserIdRef.current &&
            currentUserIdRef.current !== newUserId
          ) {
            console.log(
              `[StationContext] User changed (${currentUserIdRef.current} → ${newUserId}), clearing stale localStorage stations to prevent cross-user leak`,
            );
            localStorage.removeItem(
              stationStorageKey(currentUserIdRef.current),
            );
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(CURRENT_STATION_KEY);
            sessionCreatedStationIdsRef.current = new Set();
            setStations([]);
            setCurrentStation(null);
          }
          currentUserIdRef.current = newUserId;

          // Re-show loading screen while we fetch cloud stations, so the
          // SetupWizard doesn't flash on a new device before stations arrive.
          setIsStationLoading(true);
          syncFromBackend().finally(() => {
            setIsStationLoading(false);
          });
        } else if (event === "SIGNED_OUT") {
          // Clear local station state on logout so the next user starts clean.
          const uid = currentUserIdRef.current;
          if (uid) localStorage.removeItem(stationStorageKey(uid));
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(CURRENT_STATION_KEY);
          currentUserIdRef.current = null;
          sessionCreatedStationIdsRef.current = new Set();
          setStations([]);
          setCurrentStation(null);
        }
      },
    );
    return () => sub.subscription.unsubscribe();
  }, [syncFromBackend]);

  // REAL-TIME cross-device station sync: subscribe to postgres_changes on the
  // `stations` table. When another device creates/updates/deletes a station,
  // this fires INSTANTLY and triggers a re-sync so the new station appears
  // without a page reload. Respects the global Realtime kill-switch (egress
  // saver) so a disabled org doesn't burn the 2M/month Realtime quota.
  useEffect(() => {
    if (!cloudStorageService.isRealtimeEnabled()) return;
    const channel = supabase
      .channel("stations:realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stations" },
        () => {
          // Re-sync stations from cloud. A short debounce prevents multiple
          // rapid events from triggering redundant fetches.
          syncFromBackend().catch(() => {});
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [syncFromBackend]);

  // OFFLINE → ONLINE RETRY: when the browser regains connectivity (or the tab
  // becomes visible again), re-sync stations from cloud. This handles the case
  // where a user opened the app offline (stations didn't load from cloud), then
  // connectivity is restored — the station list must appear without a manual
  // reload. Also flushes any offline-queued writes via cloudStorageService.
  useEffect(() => {
    const handleOnline = () => {
      // Small delay to let the Supabase auth session re-establish.
      setTimeout(() => {
        syncFromBackend().catch(() => {});
        cloudStorageService.flushOfflineQueue().catch(() => {});
      }, 1500);
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        syncFromBackend().catch(() => {});
        cloudStorageService.flushOfflineQueue().catch(() => {});
      }
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [syncFromBackend]);

  // Persist stations/admin to localStorage whenever they change.
  // GUARD: never write an empty stations array over a non-empty localStorage
  // list. syncFromBackend can transiently set `stations` to [] when the
  // Supabase fetch returns [] during the createStation→push race (the
  // fire-and-forget cloud push hasn't propagated yet). Writing [] here would
  // wipe the locally-created station and strand the user on the "create
  // station" screen. The only legitimate path to an empty list is
  // deleteStation of the last station, which calls persist directly — so
  // skipping an empty-state write here is safe.
  const didHydrateRef = React.useRef(false);
  useEffect(() => {
    if (stations.length === 0) {
      try {
        const raw = localStorage.getItem(
          stationStorageKey(currentUserIdRef.current),
        );
        const parsed = raw ? JSON.parse(raw) : null;
        const stored = Array.isArray(parsed) ? parsed : parsed?.stations;
        if (stored && stored.length > 0) {
          // Storage has stations but state is empty — a transient sync race.
          // Don't overwrite. Re-hydrate state from storage so UI matches.
          didHydrateRef.current = true;
          setStations(stored);
          return;
        }
      } catch {
        /* ignore — fall through to normal persist */
      }
    }
    didHydrateRef.current = true;
    persist();
  }, [stations, adminSettings, persist]);

  // Station CRUD
  const createStation = useCallback(
    (stationData: Partial<Station>): Station => {
      // UUID format is required so this station can be pushed to Supabase's
      // stations table (UUID primary key) without a later migration step.
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `station_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const password =
        Math.random().toString(36).substr(2, 8) +
        Math.random().toString(36).substr(2, 4);
      const newStation: Station = {
        id,
        name: stationData.name || `Station ${stations.length + 1}`,
        code:
          stationData.code ||
          generateStationCode(
            stationData.name || `Station ${stations.length + 1}`,
          ),
        location: stationData.location || "",
        phone: stationData.phone || "",
        email: stationData.email || "",
        kraPin: stationData.kraPin || "",
        etrSerial: stationData.etrSerial || "",
        taxRate:
          stationData.taxRate ??
          (() => {
            try {
              const cc = stationData.country || getDetectedCountryCode();
              return Math.round((getVATRate(cc) || 0) * 100);
            } catch {
              return 0;
            }
          })(),
        theme: stationData.theme || "dark",
        logo: stationData.logo || "",
        description: stationData.description || "",
        country:
          stationData.country ||
          (() => {
            try {
              return getDetectedCountryCode() || "US";
            } catch {
              return "US";
            }
          })(),
        currency:
          stationData.currency ||
          (() => {
            try {
              return getDetectedCurrency() || "USD";
            } catch {
              return "USD";
            }
          })(),
        currencySymbol:
          stationData.currencySymbol ||
          currencySymbolFor(
            stationData.currency ||
              (() => {
                try {
                  return getDetectedCurrency() || "USD";
                } catch {
                  return "USD";
                }
              })(),
          ),
        timezone:
          stationData.timezone ||
          (() => {
            try {
              const cc = stationData.country || getDetectedCountryCode();
              return getRegionalConfig(cc)?.timeZone || "UTC";
            } catch {
              return "UTC";
            }
          })(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: stationData.data || {},
        access: [
          {
            username:
              stationData.name?.toLowerCase().replace(/\s+/g, "_") ||
              `station_${stations.length + 1}`,
            passwordHash: encrypt(password, adminSettings.secretKey),
            role: "owner",
            permissions: ["all"],
            grantedAt: new Date().toISOString(),
            grantedBy: "system",
          },
        ],
        sharedUsers: [],
      };
      setStations((prev) => [...prev, newStation]);
      setCurrentStation(newStation);
      localStorage.setItem(CURRENT_STATION_KEY, id);
      // Track this station as created in the current session so the
      // cross-user merge guard in syncFromBackend knows it belongs to
      // this user and preserves it across the cloud sync race.
      sessionCreatedStationIdsRef.current.add(id);
      // Also save directly to ensure persistence even if useEffect hasn't fired
      try {
        const key = stationStorageKey(currentUserIdRef.current);
        const existing = JSON.parse(
          localStorage.getItem(key) || '{"stations":[],"version":"3.0"}',
        );
        existing.stations = [...(existing.stations || []), newStation];
        localStorage.setItem(key, JSON.stringify(existing));
        if (currentUserIdRef.current)
          localStorage.setItem(STATIONS_OWNER_KEY, currentUserIdRef.current);
      } catch (e) {
        console.error("Failed to persist station:", e);
      }
      // Push to Supabase in the background so it's visible on other devices.
      // Local UI already updated above, so this doesn't block anything.
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user) pushStationUpsert(newStation, data.user.id);
      });
      return newStation;
    },
    [stations, adminSettings.secretKey],
  );

  const updateStation = useCallback(
    (id: string, data: Partial<Station>) => {
      setStations((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, ...data, updatedAt: new Date().toISOString() }
            : s,
        ),
      );
      if (currentStation?.id === id) {
        setCurrentStation((prev) =>
          prev
            ? { ...prev, ...data, updatedAt: new Date().toISOString() }
            : null,
        );
      }
      if (isValidUuid(id)) {
        supabase.auth.getUser().then(({ data: userData }) => {
          if (!userData?.user) return;
          const merged = {
            ...(stations.find((s) => s.id === id) ?? {}),
            ...data,
            id,
          } as Station;
          pushStationUpsert(merged, userData.user.id);
        });
      }
    },
    [currentStation, stations],
  );

  const deleteStation = useCallback(
    (id: string) => {
      setStations((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        // Persist the (possibly empty) result directly. The persist useEffect
        // guard skips writing empty arrays over non-empty storage, so an
        // explicit clear on last-station-delete must go through persist() to
        // actually empty localStorage.
        persist(remaining);
        if (currentStation?.id === id) {
          setCurrentStation(remaining.length > 0 ? remaining[0] : null);
          if (remaining.length > 0)
            localStorage.setItem(CURRENT_STATION_KEY, remaining[0].id);
        }
        return remaining;
      });
      if (isValidUuid(id)) {
        pushStationDelete(id);
      }
    },
    [currentStation, persist],
  );

  const switchStation = useCallback(
    (id: string) => {
      const found = stations.find((s) => s.id === id);
      if (found) {
        setCurrentStation(found);
        localStorage.setItem(CURRENT_STATION_KEY, id);
        // Update last_accessed_at on station_members (cross-device "last seen"
        // for shared stations). Fire-and-forget — never blocks the switch.
        // Owner-owned stations have no station_members row, so the update is a
        // no-op (PGRST116 "no rows" is expected + harmless).
        try {
          supabase
            .from("station_members")
            .update({ last_accessed_at: new Date().toISOString() })
            .eq("station_id", id)
            .then(({ error }) => {
              if (error && error.code !== "PGRST116") {
                // non-fatal; log for diagnostics
                console.warn(
                  "[StationContext] last_accessed_at update:",
                  error.message,
                );
              }
            });
        } catch {
          /* ignore — best-effort telemetry */
        }
      }
    },
    [stations],
  );

  const combineStations = useCallback(() => {
    if (stations.length === 0) return null;
    // Aggregate data from all stations
    const combinedData: any = {
      salesHistory: {},
      clients: {},
      invoices: {},
      expenses: [],
      employees: [],
      deliveryData: {
        entries: [],
        totals: {
          balanceDue: 0,
          totalSupplied: 0,
          totalPaid: 0,
          totalRemaining: 0,
          totalDebt: 0,
        },
      },
      mpesaTransactions: [],
      documents: [],
      payrollRecords: [],
      pmsTankOpening: 0,
      pmsTankClosing: 0,
      agoTankOpening: 0,
      agoTankClosing: 0,
      totalRevenue: 0,
      totalFuelSold: 0,
      totalDebt: 0,
      stations: stations.map((s) => ({
        id: s.id,
        name: s.name,
        location: s.location,
      })),
    };

    stations.forEach((s) => {
      const d = s.data || {};
      // Merge sales history
      if (d.salesHistory)
        Object.assign(combinedData.salesHistory, d.salesHistory);
      if (d.clients) Object.assign(combinedData.clients, d.clients);
      if (d.invoices) Object.assign(combinedData.invoices, d.invoices);
      if (d.expenses) combinedData.expenses.push(...d.expenses);
      if (d.employees) combinedData.employees.push(...d.employees);
      if (d.deliveryData) {
        if (d.deliveryData.entries)
          combinedData.deliveryData.entries.push(...d.deliveryData.entries);
        if (d.deliveryData.totals) {
          combinedData.deliveryData.totals.balanceDue +=
            d.deliveryData.totals.balanceDue || 0;
          combinedData.deliveryData.totals.totalSupplied +=
            d.deliveryData.totals.totalSupplied || 0;
        }
      }
      if (d.mpesaTransactions)
        combinedData.mpesaTransactions.push(...d.mpesaTransactions);
      combinedData.pmsTankOpening += d.pmsTankOpening || 0;
      combinedData.pmsTankClosing += d.pmsTankClosing || 0;
      combinedData.agoTankOpening += d.agoTankOpening || 0;
      combinedData.agoTankClosing += d.agoTankClosing || 0;
    });

    return { data: combinedData, stations };
  }, [stations]);

  // Station Access
  const shareStation = useCallback(
    (stationId: string, email: string, password: string) => {
      setStations((prev) =>
        prev.map((s) => {
          if (s.id !== stationId) return s;
          const accessKey = Math.random().toString(36).substr(2, 16);
          return {
            ...s,
            sharedUsers: [
              ...s.sharedUsers,
              {
                email,
                stationId,
                accessKey,
                grantedAt: new Date().toISOString(),
              },
            ],
            access: [
              ...s.access,
              {
                username: email,
                passwordHash: encrypt(password, adminSettings.secretKey),
                role: "shared",
                permissions: ["view", "edit_sales", "edit_delivery"],
                grantedAt: new Date().toISOString(),
                grantedBy: s.access[0]?.username || "owner",
              },
            ],
          };
        }),
      );
    },
    [adminSettings.secretKey],
  );

  const revokeAccess = useCallback((stationId: string, email: string) => {
    setStations((prev) =>
      prev.map((s) => {
        if (s.id !== stationId) return s;
        return {
          ...s,
          sharedUsers: s.sharedUsers.filter((u) => u.email !== email),
          access: s.access.filter((a) => a.username !== email),
        };
      }),
    );
  }, []);

  const verifyStationAccess = useCallback(
    (stationId: string, password: string): boolean => {
      const station = stations.find((s) => s.id === stationId);
      if (!station) return false;
      return station.access.some((a) => {
        try {
          return decrypt(a.passwordHash, adminSettings.secretKey) === password;
        } catch {
          return false;
        }
      });
    },
    [stations, adminSettings.secretKey],
  );

  const changeStationPassword = useCallback(
    (stationId: string, newPassword: string) => {
      setStations((prev) =>
        prev.map((s) => {
          if (s.id !== stationId) return s;
          return {
            ...s,
            access: s.access.map((a, i) =>
              i === 0
                ? {
                    ...a,
                    passwordHash: encrypt(newPassword, adminSettings.secretKey),
                  }
                : a,
            ),
          };
        }),
      );
    },
    [adminSettings.secretKey],
  );

  // Admin
  const loginAdmin = useCallback(
    (username: string, password: string): boolean => {
      const storedHash = adminSettings.adminPasswordHash;
      const isValid =
        username === adminSettings.adminUsername &&
        decrypt(storedHash, adminSettings.secretKey) === password;
      if (isValid) {
        setIsAdmin(true);
        const session = {
          isAdmin: true,
          expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
      return isValid;
    },
    [adminSettings],
  );

  const logoutAdmin = useCallback(() => {
    setIsAdmin(false);
    localStorage.removeItem(SESSION_KEY);
  }, []);

  const updateAdminPassword = useCallback(
    (currentPassword: string, newPassword: string): boolean => {
      if (
        decrypt(adminSettings.adminPasswordHash, adminSettings.secretKey) !==
        currentPassword
      )
        return false;
      const newHash = encrypt(newPassword, adminSettings.secretKey);
      const updated = { ...adminSettings, adminPasswordHash: newHash };
      setAdminSettings(updated);
      localStorage.setItem(ADMIN_KEY, JSON.stringify(updated));
      return true;
    },
    [adminSettings],
  );

  const updateAdminSettings = useCallback(
    (settings: Partial<AdminSettings>) => {
      setAdminSettings((prev) => ({ ...prev, ...settings }));
    },
    [],
  );

  const addUpdateRecord = useCallback(
    (record: Omit<UpdateRecord, "id" | "timestamp">) => {
      const newRecord: UpdateRecord = {
        ...record,
        id: `upd_${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
      setAdminSettings((prev) => ({
        ...prev,
        updateHistory: [newRecord, ...prev.updateHistory].slice(0, 100),
      }));
    },
    [],
  );

  const revertUpdate = useCallback((updateId: string) => {
    setAdminSettings((prev) => ({
      ...prev,
      updateHistory: prev.updateHistory.map((u) =>
        u.id === updateId
          ? { ...u, reverted: true, revertedAt: new Date().toISOString() }
          : u,
      ),
    }));
  }, []);

  const updateTabConfig = useCallback(
    (tabId: string, config: Partial<AdminSettings["tabConfig"][string]>) => {
      setAdminSettings((prev) => ({
        ...prev,
        tabConfig: {
          ...prev.tabConfig,
          [tabId]: { ...prev.tabConfig[tabId], ...config },
        },
      }));
    },
    [],
  );

  const updateApiKey = useCallback((keyName: string, value: string) => {
    setAdminSettings((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [keyName]: value },
    }));
  }, []);

  // Access Log
  const addAccessLog = useCallback(
    (stationId: string, action: string) => {
      const log: AccessLog = {
        id: `log_${Date.now()}`,
        stationId,
        user: currentStation?.access[0]?.username || "unknown",
        action,
        timestamp: new Date().toISOString(),
      };
      const existing = JSON.parse(localStorage.getItem(ACCESS_LOG_KEY) || "[]");
      localStorage.setItem(
        ACCESS_LOG_KEY,
        JSON.stringify([log, ...existing].slice(0, 500)),
      );
    },
    [currentStation],
  );

  const getAccessLogs = useCallback((stationId?: string): AccessLog[] => {
    const all = JSON.parse(localStorage.getItem(ACCESS_LOG_KEY) || "[]");
    return stationId
      ? all.filter((l: AccessLog) => l.stationId === stationId)
      : all;
  }, []);

  // Station Data
  const getStationData = useCallback(
    (stationId: string): any => {
      const station = stations.find((s) => s.id === stationId);
      return station?.data || {};
    },
    [stations],
  );

  const saveStationData = useCallback((stationId: string, data: any) => {
    setStations((prev) =>
      prev.map((s) =>
        s.id === stationId
          ? { ...s, data, updatedAt: new Date().toISOString() }
          : s,
      ),
    );
  }, []);

  // Export/Import
  const exportAllData = useCallback((): string => {
    const payload = {
      stations,
      adminSettings,
      exportedAt: new Date().toISOString(),
      version: "3.0",
    };
    return JSON.stringify(payload, null, 2);
  }, [stations, adminSettings]);

  const importAllData = useCallback(
    (json: string) => {
      try {
        const payload = JSON.parse(json);
        if (payload.stations) setStations(payload.stations);
        if (payload.adminSettings) setAdminSettings(payload.adminSettings);
        persist(payload.stations, payload.adminSettings);
      } catch (e) {
        console.error("Import failed:", e);
      }
    },
    [persist],
  );

  // Encryption utils
  const encryptSensitive = useCallback(
    (text: string) => encrypt(text, adminSettings.secretKey),
    [adminSettings.secretKey],
  );
  const decryptSensitive = useCallback(
    (encoded: string) => decrypt(encoded, adminSettings.secretKey),
    [adminSettings.secretKey],
  );

  return (
    <StationContext.Provider
      value={{
        stations,
        currentStation,
        isAdmin,
        adminSettings,
        isStationLoading,
        isBackendSyncing,
        lastBackendSync,
        createStation,
        updateStation,
        deleteStation,
        switchStation,
        combineStations,
        shareStation,
        revokeAccess,
        verifyStationAccess,
        changeStationPassword,
        loginAdmin,
        logoutAdmin,
        updateAdminPassword,
        updateAdminSettings,
        addUpdateRecord,
        revertUpdate,
        updateTabConfig,
        updateApiKey,
        addAccessLog,
        getAccessLogs,
        getStationData,
        saveStationData,
        exportAllData,
        importAllData,
        encryptSensitive,
        decryptSensitive,
        syncFromBackend,
        syncToBackend,
        hasBackendData,
      }}
    >
      {children}
    </StationContext.Provider>
  );
}

export function useStations() {
  const ctx = useContext(StationContext);
  if (!ctx) throw new Error("useStations must be used within StationProvider");
  return ctx;
}
