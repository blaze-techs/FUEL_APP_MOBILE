/**
 * Company Grant Service — the secure backbone of the "Company QR Code"
 * feature (Header → Branding & Tools → Company QR Code).
 *
 * A company grant is a crypto-random, revocable, expiring credential that
 * lets anyone with the shared link view this station's read-only data for a
 * specified period, WITHOUT an account or password.
 *
 * SECURITY MODEL (mirrors the station access-code system):
 *  - The grant network is the `code` (~93 bits, crypto-random, generated
 *    client-side with Web Crypto and stored hashed-side in the table as the
 *    literal code — only the RPC ever matches on it; other rows never reveal
 *    it because we never SELECT codes out).
 *  - The owner CRUDs grants through their own RLS-guarded Supabase session
 *    (company_grants.owner_id = auth.uid()).
 *  - An UNAUTHENTICATED member redeems a link through the SECURITY DEFINER
 *    RPC `redeem_company_grant` (callable by anon), exactly like
 *    `verify_access_code`.
 *  - Revocation: revoking a grant sets revoked=true (server-side, so even a
 *    replayed old code fails). Rotating deletes the old code and issues a
 *    new one.
 *  - Expiry is enforced SERVER-side by the RPC (expires_at) — the client
 *    display of expiry is informational only.
 *
 * The redeemed member has NO Supabase session, so they read the station's
 * data through the public station snapshot (station-snapshots/…), which the
 * owner publishes from Team Manager / the QR modal.
 */

import { getSupabaseClient } from "@/supabase/client";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  ACCESS_MODE_CAPABILITIES,
  accessModeLabel as grantModeLabel,
  modeToReadOnly,
  normalizeAccessCapabilities,
  normalizeAccessMode,
  resolveAccessMode,
  type AccessCapability,
  type AccessMode as CanonicalAccessMode,
} from "@/react-app/lib/access-mode";

/**
 * Storage: grants live in the station-scoped `app_kv` collection under the
 * logical key `company_grants` (row id `company_grants__<ownerId>__<stationId>`,
 * RLS-guarded, cross-device, compressed envelope handled transparently).
 *
 * The owner CRUDs them through their own authenticated session's
 * cloudStorageService (the SAME mechanism every component in the app uses).
 * An UNAUTHENTICATED member redeems a link through the serverless endpoint
 * `GET /api/company-grant-redeem?code=<code>` which validates the code
 * SERVER-side with the service role (expiry / revoked / enabled / max-uses)
 * and — once migrations/027 is applied — prefers the atomic
 * `redeem_company_grant` RPC. Either path works; no schema is required.
 */
const GRANTS_KEY = "company_grants";
const GRANTS_CACHE_KEY = "fuelpro_company_grants_cache";

/** Allowed-tab shortcut presets offered in the QR modal. */
export const GRANT_TAB_PRESETS: Array<{
  id: string;
  label: string;
  tabs: string[];
}> = [
  { id: "dashboard", label: "Dashboard", tabs: ["dashboard"] },
  { id: "prices", label: "Prices", tabs: ["dashboard", "fueltypes"] },
  {
    id: "sales",
    label: "Sales & Reports",
    tabs: ["sales", "fuelsalesreport", "reports"],
  },
  { id: "payments", label: "Payments", tabs: ["livetransaction", "mpesa"] },
  { id: "all", label: "All sections", tabs: [] },
];

export type GrantAccessMode = CanonicalAccessMode;

export { grantModeLabel };

export interface CompanyGrant {
  id: string;
  code: string;
  stationId: string;
  ownerId: string;
  memberName: string;
  memberRole: string;
  allowedTabs: string[];
  readOnly: boolean;
  enabled: boolean;
  revoked: boolean;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  uses: number;
  lastRedeemedAt: number | null;
  /** Owner-decided mode: read / edit / full. Backs `readOnly`. */
  accessMode: GrantAccessMode;
  /** Owner-authored restriction ON TOP of the level (tabs + capabilities).
   *  Empty arrays mean "no further restriction". */
  scopeTabs: string[];
  scopeCapabilities: AccessCapability[];
}

export interface GrantCreateParams {
  memberName: string;
  memberRole?: string;
  allowedTabs: string[];
  readOnly?: boolean;
  /** Owner-decided mode: read / edit / full. Defaults to read. */
  accessMode?: GrantAccessMode;
  /** Optional tab restriction; may only NARROW what the level allows. */
  scopeTabs?: string[];
  /** Optional capability restriction; may only NARROW the level. */
  scopeCapabilities?: AccessCapability[];
  expiresInDays?: number; // null = never
  maxUses?: number | null; // null = unlimited
}

export interface GrantRedeemResult {
  grantId: string;
  memberName: string;
  memberRole: string;
  allowedTabs: string[];
  readOnly: boolean;
  stationId: string;
  stationOwnerId: string;
  expiresAt: string | null;
  /** Owner-decided mode: read / edit / full. */
  accessMode?: GrantAccessMode;
  /** Owner-authored restriction on top of the level. */
  scopeTabs?: string[];
  scopeCapabilities?: AccessCapability[];
}

/**
 * Why a grant link could not be redeemed. Surfaced so the member page can
 * tell the truth ("already used") instead of always claiming the owner
 * revoked the link.
 */
export type GrantRedeemFailure =
  | "invalid"
  | "disabled"
  | "revoked"
  | "expired"
  | "used_up"
  | "locked"
  | "unknown";

/** Human-readable explanation for a redemption failure. */
export function grantRedeemFailureMessage(reason: GrantRedeemFailure): string {
  switch (reason) {
    case "revoked":
      return "This link has been revoked by the station owner.";
    case "expired":
      return "This link has expired. Ask the station owner for a new one.";
    case "used_up":
      return "This link has already been used the number of times the owner allowed. Ask them for a new one.";
    case "disabled":
      return "This link has been disabled by the station owner.";
    case "locked":
      return "Too many attempts. This link is temporarily locked — contact the station owner.";
    case "invalid":
    default:
      return "This link is not valid. Check the link, or ask the station owner for a new one.";
  }
}

/** Thrown when a grant cannot be redeemed, carrying the precise reason. */
export class GrantRedeemError extends Error {
  reason: GrantRedeemFailure;
  constructor(reason: GrantRedeemFailure) {
    super(grantRedeemFailureMessage(reason));
    this.name = "GrantRedeemError";
    this.reason = reason;
  }
}

/** Crypto-random URL-safe code (~93 bits of entropy → 15 chars × 6.2 bits). */
export function generateGrantCode(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous 0/O/1/l/I
    let out = "";
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }
  // Fallback (tests / older runtimes): Math.random in chunks.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 18; i++)
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function rowToGrant(
  r: Record<string, unknown> | undefined | null,
): CompanyGrant | null {
  if (!r) return null;
  // One resolver decides the mode for the whole app; `read_only` is only a
  // legacy fallback and can never override a canonical access_mode.
  const accessMode = resolveAccessMode({
    access_mode: r.access_mode,
    accessMode: r.accessMode,
    read_only: r.read_only,
    readOnly: r.readOnly,
  });
  const pick = (snake: string, camel: string): unknown =>
    r[snake] !== undefined ? r[snake] : r[camel];
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const ts = (v: unknown): number | null => {
    if (!v) return null;
    // Accept ISO strings OR numeric ms-epochs (the client writes
    // `new Date(...).getTime()`); never stringify a bare number into an
    // unsupported date format ("1725…" → NaN → null → "Never expires").
    const t = typeof v === "number" ? v : new Date(String(v)).getTime();
    return Number.isFinite(t) ? t : null;
  };
  return {
    id: String(pick("id", "id") ?? ""),
    code: String(pick("code", "code") ?? ""),
    stationId: String(pick("station_id", "stationId") ?? ""),
    ownerId: String(pick("owner_id", "ownerId") ?? ""),
    memberName: String(pick("member_name", "memberName") ?? ""),
    memberRole: String(pick("member_role", "memberRole") ?? "Staff"),
    allowedTabs: Array.isArray(pick("allowed_tabs", "allowedTabs"))
      ? (pick("allowed_tabs", "allowedTabs") as string[])
      : [],
    readOnly: modeToReadOnly(accessMode),
    accessMode,
    scopeTabs: Array.isArray(pick("scope_tabs", "scopeTabs"))
      ? (pick("scope_tabs", "scopeTabs") as string[])
      : [],
    scopeCapabilities: normalizeAccessCapabilities(
      pick("scope_capabilities", "scopeCapabilities"),
    ),
    enabled: pick("enabled", "enabled") !== false,
    revoked: pick("revoked", "revoked") === true,
    createdAt: ts(pick("created_at", "createdAt")) ?? Date.now(),
    expiresAt: ts(pick("expires_at", "expiresAt")),
    maxUses: num(pick("max_uses", "maxUses")),
    uses: num(pick("uses", "uses")) ?? 0,
    lastRedeemedAt: ts(pick("last_redeemed_at", "lastRedeemedAt")),
  };
}

async function currentOwnerId(): Promise<string | null> {
  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

/** Normalize an app_kv-stored grant record into the typed CompanyGrant. Both
 *  snake_case (table-shaped) and camelCase (client-shaped) keys are accepted. */
function normalizeStoredGrant(
  raw: Record<string, unknown> | undefined | null,
): CompanyGrant | null {
  return rowToGrant(raw as Record<string, unknown> | undefined);
}

function grantsCacheKey(stationId?: string, ownerId?: string): string {
  return stationId && ownerId
    ? `${GRANTS_CACHE_KEY}__${ownerId}__${stationId}`
    : GRANTS_CACHE_KEY;
}

function readGrantsCache(stationId?: string, ownerId?: string): CompanyGrant[] {
  try {
    const raw = localStorage.getItem(grantsCacheKey(stationId, ownerId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeGrantsCache(
  grants: CompanyGrant[],
  stationId?: string,
  ownerId?: string,
) {
  try {
    localStorage.setItem(
      grantsCacheKey(stationId, ownerId),
      JSON.stringify(grants),
    );
  } catch {
    /* read-through cache only */
  }
}

/** Owner: list all grants for a station. Only the owner's session can see
 *  them (RLS). Never include the code when it would matter — but we include
 *  the code here because the owner needs it to copy the share link; the
 *  cloud row's RLS already limits reads to the owner. */
async function migrateLegacyGrantsToAuthoritativeTable(
  stationId: string,
  ownerId: string,
): Promise<void> {
  // app_kv is legacy compatibility storage only. Existing grants are copied
  // once into the relational grant table; thereafter the table is authoritative
  // for identity, code, revocation, expiry and usage.
  try {
    const stored = await cloudStorageService.get<unknown[] | null>(
      GRANTS_KEY,
      stationId,
    );
    if (!Array.isArray(stored) || stored.length === 0) return;

    const supabase = getSupabaseClient();
    const rows = stored
      .map((r) => normalizeStoredGrant(r as Record<string, unknown>))
      .filter((g): g is CompanyGrant => !!g)
      .filter((g) => g.ownerId === ownerId && g.stationId === stationId)
      .map((g) => ({
        id: g.id,
        code: g.code,
        station_id: g.stationId,
        owner_id: g.ownerId,
        member_name: g.memberName,
        member_role: g.memberRole,
        allowed_tabs: g.allowedTabs,
        read_only: g.readOnly,
        enabled: g.enabled,
        revoked: g.revoked,
        created_at: new Date(g.createdAt).toISOString(),
        expires_at: g.expiresAt ? new Date(g.expiresAt).toISOString() : null,
        max_uses: g.maxUses,
        uses: g.uses,
        last_redeemed_at: g.lastRedeemedAt
          ? new Date(g.lastRedeemedAt).toISOString()
          : null,
        access_mode: g.accessMode,
        recipient_key: g.memberName.trim().toLowerCase(),
      }));

    if (rows.length) {
      const { error } = await supabase
        .from("company_grants")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error) {
        console.warn(
          "[company-grants] legacy migration skipped:",
          error.message,
        );
      }
    }
  } catch (e) {
    console.warn("[company-grants] legacy migration unavailable:", e);
  }
}

async function authoritativeGrants(
  stationId: string,
  ownerId: string,
): Promise<CompanyGrant[]> {
  const supabase = getSupabaseClient();
  await migrateLegacyGrantsToAuthoritativeTable(stationId, ownerId);

  const { data, error } = await supabase
    .from("company_grants")
    .select("*")
    .eq("station_id", stationId)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (Array.isArray(data) ? data : [])
    .map((r) => rowToGrant(r as Record<string, unknown>))
    .filter((g): g is CompanyGrant => !!g);
}

/** Owner: list grants from the relational authoritative table. */
export async function listCompanyGrants(
  stationId?: string,
): Promise<CompanyGrant[]> {
  if (!stationId) return [];
  const ownerId = await currentOwnerId();
  if (!ownerId) return [];
  try {
    const grants = await authoritativeGrants(stationId, ownerId);
    writeGrantsCache(grants, stationId, ownerId);
    return grants;
  } catch (e) {
    console.warn("[company-grants] authoritative list failed:", e);
    // Cache is only an emergency display fallback. It is never used for
    // writes/revocation decisions.
    return readGrantsCache(stationId, ownerId).filter(
      (g) => g.stationId === stationId && g.ownerId === ownerId,
    );
  }
}

/** Owner: create a brand-new independent grant for ONE recipient. */
export async function createCompanyGrant(
  params: GrantCreateParams,
  stationId?: string,
): Promise<CompanyGrant> {
  if (!stationId) throw new Error("No station selected.");
  const ownerId = await currentOwnerId();
  if (!ownerId)
    throw new Error("You must be signed in to create a company QR grant.");

  const supabase = getSupabaseClient();
  const memberName = (params.memberName || "Team Member").trim();
  const mode = resolveAccessMode(params);
  // Scope may only NARROW the level: keep the intersection with the mode's
  // ceiling so a grant can never be stored with a capability its level
  // forbids (e.g. a read-only grant carrying `manage`).
  const scopeCapabilities = normalizeAccessCapabilities(
    params.scopeCapabilities,
  ).filter((c) => ACCESS_MODE_CAPABILITIES[mode].includes(c));
  // No use cap unless the owner explicitly sets one. A default of ONE
  // redemption looked safer but silently killed the link after a single
  // scan — the member page re-redeems on every load, so a refresh exhausted
  // it and the (still-active) grant was then reported as "revoked". A link
  // stays a shareable, revocable credential; the owner can still cap it.
  const requestedMaxUses = params.maxUses;
  const maxUses =
    requestedMaxUses == null ||
    String(requestedMaxUses).trim() === "" ||
    !Number.isFinite(Number(requestedMaxUses))
      ? null
      : Math.max(1, Math.floor(Number(requestedMaxUses)));

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGrantCode();
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `grant_${crypto.randomUUID()}`
        : `grant_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt =
      params.expiresInDays && params.expiresInDays > 0
        ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
        : null;

    const grant: CompanyGrant = {
      id,
      code,
      stationId,
      ownerId,
      memberName,
      memberRole: params.memberRole || "Staff",
      allowedTabs: params.allowedTabs || [],
      readOnly: modeToReadOnly(mode),
      accessMode: mode,
      scopeTabs: params.scopeTabs || [],
      scopeCapabilities,
      enabled: true,
      revoked: false,
      createdAt: Date.now(),
      expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
      maxUses,
      uses: 0,
      lastRedeemedAt: null,
    };

    const { error } = await supabase.from("company_grants").insert({
      id: grant.id,
      code: grant.code,
      station_id: grant.stationId,
      owner_id: grant.ownerId,
      member_name: grant.memberName,
      member_role: grant.memberRole,
      allowed_tabs: grant.allowedTabs,
      read_only: grant.readOnly,
      enabled: true,
      revoked: false,
      created_at: new Date(grant.createdAt).toISOString(),
      expires_at: expiresAt,
      max_uses: grant.maxUses,
      uses: 0,
      access_mode: grant.accessMode,
      scope_tabs: grant.scopeTabs,
      scope_capabilities: grant.scopeCapabilities,
      recipient_key: memberName.toLowerCase(),
    });

    if (!error) {
      // Keep the legacy endpoint compatible while all new redemption/revocation
      // decisions come from company_grants.
      try {
        await cloudStorageService.set(
          `company_grant_${code}`,
          grant as unknown as Record<string, unknown>,
          stationId,
        );
      } catch {
        /* compatibility write only */
      }
      writeGrantsCache(
        [grant, ...readGrantsCache(stationId, ownerId)],
        stationId,
        ownerId,
      );
      return grant;
    }

    // Pre-migration schema: the `scope_*` columns do not exist yet (42703).
    // Retry WITHOUT them — the app_kv mirror above still carries the scope, so
    // the owner's own device honours it; the DB column only mirrors it for
    // cross-device reads. Creating a link must never break on an older schema.
    if (error.code === "42703" || /scope_/.test(String(error.message))) {
      const { scope_tabs: _st, scope_capabilities: _sc, ...legacyRow } = {
        id: grant.id,
        code: grant.code,
        station_id: grant.stationId,
        owner_id: grant.ownerId,
        member_name: grant.memberName,
        member_role: grant.memberRole,
        allowed_tabs: grant.allowedTabs,
        read_only: grant.readOnly,
        enabled: true,
        revoked: false,
        created_at: new Date(grant.createdAt).toISOString(),
        expires_at: expiresAt,
        max_uses: grant.maxUses,
        uses: 0,
        access_mode: grant.accessMode,
        scope_tabs: grant.scopeTabs,
        scope_capabilities: grant.scopeCapabilities,
        recipient_key: memberName.toLowerCase(),
      };
      const { error: legacyErr } = await supabase
        .from("company_grants")
        .insert(legacyRow);
      if (!legacyErr) {
        try {
          await cloudStorageService.set(
            `company_grant_${code}`,
            grant as unknown as Record<string, unknown>,
            stationId,
          );
        } catch {
          /* compatibility write only */
        }
        writeGrantsCache(
          [grant, ...readGrantsCache(stationId, ownerId)],
          stationId,
          ownerId,
        );
        return grant;
      }
      if (!/duplicate|unique/i.test(legacyErr.message || "")) {
        throw new Error(
          `Failed to create unique QR grant: ${legacyErr.message}`,
        );
      }
      continue;
    }

    // A globally unique code/id collision is exceptionally unlikely. Retry
    // with a new credential rather than ever reusing an existing user's link.
    if (!/duplicate|unique/i.test(error.message || "")) {
      throw new Error(`Failed to create unique QR grant: ${error.message}`);
    }
  }

  throw new Error("Could not generate a unique QR grant. Please try again.");
}

/** Owner: revoke exactly ONE grant in the authoritative table. */
export async function revokeCompanyGrant(
  id: string,
  stationId?: string,
): Promise<void> {
  if (!stationId) throw new Error("No station selected.");
  const ownerId = await currentOwnerId();
  if (!ownerId) throw new Error("You must be signed in.");

  const supabase = getSupabaseClient();
  const { data: row, error: readError } = await supabase
    .from("company_grants")
    .select("id, code")
    .eq("id", id)
    .eq("station_id", stationId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error("Grant not found.");

  const { error } = await supabase
    .from("company_grants")
    .update({ revoked: true, enabled: false })
    .eq("id", id)
    .eq("station_id", stationId)
    .eq("owner_id", ownerId);
  if (error) throw error;

  // Compatibility cleanup only; this cannot revoke another grant because the
  // key contains this exact grant code.
  try {
    await cloudStorageService.delete(
      `company_grant_${String(row.code)}`,
      stationId,
    );
  } catch {
    /* */
  }
  writeGrantsCache(
    readGrantsCache(stationId, ownerId).map((g) =>
      g.id === id ? { ...g, revoked: true, enabled: false } : g,
    ),
    stationId,
    ownerId,
  );
}

/** Owner: hard-delete exactly ONE grant. */
export async function deleteCompanyGrant(
  id: string,
  stationId?: string,
): Promise<void> {
  if (!stationId) throw new Error("No station selected.");
  const ownerId = await currentOwnerId();
  if (!ownerId) throw new Error("You must be signed in.");

  const supabase = getSupabaseClient();
  const { data: row, error: readError } = await supabase
    .from("company_grants")
    .select("id, code")
    .eq("id", id)
    .eq("station_id", stationId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error("Grant not found.");

  const { error } = await supabase
    .from("company_grants")
    .delete()
    .eq("id", id)
    .eq("station_id", stationId)
    .eq("owner_id", ownerId);
  if (error) throw error;

  try {
    await cloudStorageService.delete(
      `company_grant_${String(row.code)}`,
      stationId,
    );
  } catch {
    /* */
  }
  writeGrantsCache(
    readGrantsCache(stationId, ownerId).filter((g) => g.id !== id),
    stationId,
    ownerId,
  );
}

/** Owner: rotate — create a brand-new code/grant and revoke the old one. */
export async function rotateCompanyGrant(
  id: string,
  stationId?: string,
): Promise<CompanyGrant> {
  const grants = await listCompanyGrants(stationId);
  const old = grants.find((g) => g.id === id);
  if (!old) throw new Error("Grant not found.");
  const fresh = await createCompanyGrant(
    {
      memberName: old.memberName,
      memberRole: old.memberRole,
      allowedTabs: old.allowedTabs,
      readOnly: old.readOnly,
      accessMode: old.accessMode,
      expiresInDays: old.expiresAt
        ? Math.max(1, Math.ceil((old.expiresAt - Date.now()) / 86400000))
        : undefined,
      maxUses: old.maxUses,
    },
    stationId,
  );
  await revokeCompanyGrant(id, stationId);
  return fresh;
}

/** Owner: change exactly ONE grant's access mode. */
export async function updateGrantMode(
  id: string,
  mode: GrantAccessMode,
  stationId?: string,
): Promise<void> {
  const m = normalizeAccessMode(mode);
  await patchGrant(
    id,
    stationId,
    { read_only: modeToReadOnly(m), access_mode: m },
    { readOnly: modeToReadOnly(m), accessMode: m },
  );
}

/**
 * Reset a grant's redemption counter back to zero.
 *
 * A capped grant that reached its limit is *still active* — it was never
 * revoked. Owners hit this constantly because a page refresh used to consume a
 * use, so the link appeared dead. Resetting restores it without inventing a new
 * code, so an already-shared QR keeps working.
 */
export async function resetGrantUsage(
  id: string,
  stationId?: string,
): Promise<void> {
  await patchGrant(
    id,
    stationId,
    { uses: 0, last_redeemed_at: null },
    { uses: 0, lastRedeemedAt: null },
  );
}

/** Shared owner-scoped update + compatibility mirror for a grant. */
async function patchGrant(
  id: string,
  stationId: string | undefined,
  tablePatch: Record<string, unknown>,
  mirrorPatch: Record<string, unknown>,
): Promise<void> {
  if (!stationId) throw new Error("No station selected.");
  const ownerId = await currentOwnerId();
  if (!ownerId) throw new Error("You must be signed in.");

  const supabase = getSupabaseClient();
  const { data: row, error: readError } = await supabase
    .from("company_grants")
    .select("code")
    .eq("id", id)
    .eq("station_id", stationId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (readError) throw readError;
  if (!row) throw new Error("Grant not found.");

  const { error } = await supabase
    .from("company_grants")
    .update(tablePatch)
    .eq("id", id)
    .eq("station_id", stationId)
    .eq("owner_id", ownerId);
  if (error) throw error;

  try {
    await cloudStorageService.set(
      `company_grant_${String(row.code)}`,
      { id, code: String(row.code), ...mirrorPatch },
      stationId,
    );
  } catch {
    /* compatibility only */
  }
}

/** Same-origin / Vercel absolute base for the redemption dispatcher (mirrors
 *  the HLS-proxy pattern: relative on Vercel, absolute cross-origin from CF). */
export function grantApiBase(): string {
  if (typeof window === "undefined") return "";
  const { origin, hostname } = window.location;
  if (
    hostname === "fuel-app-mobile.vercel.app" ||
    hostname.endsWith(".vercel.app") ||
    hostname === "fuel-app-mobile.pages.dev" ||
    hostname.endsWith(".pages.dev")
  ) {
    return origin;
  }
  return "https://fuel-app-mobile.vercel.app";
}

/**
 * Member-side redemption — an UNAUTHENTICATED member redeems the code from
 * the shared link through the existing integrations dispatcher
 * `POST /api/integrations?action=company-grant-redeem` (server-side
 * validation with the service role; works TODAY with zero migration, and on
 * BOTH hosts — the CF Pages Function relays to the same dispatcher). If the
 * dispatcher is unreachable but the `redeem_company_grant` SECURITY DEFINER
 * RPC exists (migration 027 applied), we fall back to the RPC. On success we
 * get the owner + station ids (to fetch the snapshot) + the access config.
 * Throws a {@link GrantRedeemError} carrying the precise failure reason
 * (invalid / revoked / expired / used_up / disabled / locked) so the member
 * page can state the truth rather than always blaming a revocation.
 */
export async function redeemCompanyGrant(
  code: string,
): Promise<GrantRedeemResult> {
  const clean = code.trim();
  if (!clean) throw new GrantRedeemError("invalid");

  const toResult = (r: Record<string, unknown>): GrantRedeemResult => {
    // The redemption payload can carry BOTH a canonical accessMode and a
    // legacy readOnly. Resolve once, then derive readOnly from it, so the
    // member can never be shown/labelled a mode the server did not grant.
    const mode = resolveAccessMode({
      accessMode: r.accessMode,
      access_mode: r.access_mode,
      readOnly: r.readOnly,
      read_only: r.read_only,
    });
    return {
      grantId: String(r.grantId),
      memberName: String(r.memberName ?? ""),
      memberRole: String(r.memberRole ?? "Staff"),
      allowedTabs: Array.isArray(r.allowedTabs)
        ? (r.allowedTabs as string[])
        : [],
      readOnly: modeToReadOnly(mode),
      accessMode: mode,
      // Scope is resolved the same defensive way as the mode: unknown
      // capabilities are dropped, and anything the level forbids is stripped,
      // so a redemption payload can never widen what the grant allows.
      scopeTabs: Array.isArray(r.scopeTabs)
        ? (r.scopeTabs as string[])
        : Array.isArray(r.scope_tabs)
          ? (r.scope_tabs as string[])
          : [],
      scopeCapabilities: normalizeAccessCapabilities(
        r.scopeCapabilities ?? r.scope_capabilities,
      ).filter((c) => ACCESS_MODE_CAPABILITIES[mode].includes(c)),
      stationId: String(r.stationId ?? ""),
      stationOwnerId: String(r.stationOwnerId ?? ""),
      expiresAt: r.expiresAt ? String(r.expiresAt) : null,
    };
  };

  const reasonOf = (r: Record<string, unknown>): GrantRedeemFailure => {
    const raw = String(r.reason ?? "").toLowerCase();
    if (
      raw === "revoked" ||
      raw === "expired" ||
      raw === "used_up" ||
      raw === "disabled" ||
      raw === "locked" ||
      raw === "invalid"
    ) {
      return raw;
    }
    // Legacy contract (no `reason`): only the locked shape is distinguishable.
    if (r.locked === true) return "locked";
    return "unknown";
  };

  // 1) Authoritative relational grant table. This is the only source that
  // can redeem NEW grants and it enforces revocation/expiry/max-uses inside
  // Postgres with a row lock, so two people cannot redeem the same credential
  // concurrently and accidentally share one user's access.
  //
  // A structured outcome is DEFINITIVE, EXCEPT 'invalid': that is also what
  // the authoritative table says for a grant that only exists in the legacy
  // mirror, so it must fall through to the compatibility paths below.
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("redeem_company_grant", {
      p_code: clean,
    });
    if (!error && data && typeof data === "object") {
      const r = data as Record<string, unknown>;
      if (r.grantId) return toResult(r);
      const reason = reasonOf(r);
      if (reason !== "invalid") throw new GrantRedeemError(reason);
    }
  } catch (e) {
    if (e instanceof GrantRedeemError) throw e;
    console.warn("[company-grants] authoritative redeem unavailable:", e);
  }

  // 2) Legacy compatibility path for grants created before the relational
  // migration. These grants are still isolated by their exact code.
  try {
    const base = grantApiBase();
    if (base) {
      const res = await fetch(
        `${base}/api/integrations?action=company-grant-redeem`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: clean }),
        },
      );
      const r = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && r && r.grantId) return toResult(r);
      if (res.status >= 400 && res.status < 500) {
        const reason = reasonOf(r);
        if (reason !== "invalid") throw new GrantRedeemError(reason);
      }
    }
  } catch (e) {
    if (e instanceof GrantRedeemError) throw e;
    console.warn("[company-grants] legacy redeem dispatcher unavailable:", e);
  }

  // 3) Final legacy RPC fallback for environments where only migration 027
  // exists. New installations use the hardened migration above.
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("redeem_company_grant", {
      p_code: clean,
    });
    // Distinguish an infrastructure failure from a genuinely missing grant:
    // an RPC error is NOT proof that the link is invalid.
    if (error) throw new GrantRedeemError("unknown");
    if (!data || typeof data !== "object") {
      throw new GrantRedeemError("invalid");
    }
    const r = data as Record<string, unknown>;
    if (!r.grantId) throw new GrantRedeemError(reasonOf(r));
    return toResult(r);
  } catch (e) {
    if (e instanceof GrantRedeemError) throw e;
    throw new GrantRedeemError("unknown");
  }
}

export type GrantDataOutcome =
  | { state: "ok"; snapshot: Record<string, unknown> }
  | { state: "denied"; reason: GrantRedeemFailure }
  | { state: "unavailable" };

/**
 * Fetch the member's station data from the AUTHORITATIVE source.
 *
 * Previously the member page rendered a *published snapshot* — a partial copy
 * the owner's browser uploaded to Storage. It went stale the moment the owner
 * changed a price or recorded a sale, and it was built from FuelContext fields
 * that are null for sales/staff/expenses, so the member saw "Revenue 0" and no
 * staff while the owner saw real figures. The two views of one station
 * therefore contradicted each other.
 *
 * This reads the SAME station rows the owner's app reads, resolved server-side
 * and authorised by the grant code (re-validated on every call).
 *
 * The OUTCOME is discriminated because the caller must not treat a definitive
 * denial the same as an outage: falling back to a stale published copy after
 * the owner revoked/exhausted a link is what produced contradictory prices.
 *  - `ok`          → authoritative rows.
 *  - `denied`      → the grant is invalid / revoked / expired / used up.
 *                    The caller must NOT fall back; show the reason.
 *  - `unavailable` → the backend could not be reached. A stale offline copy may
 *                    be shown, clearly labelled as such.
 */
export async function fetchGrantStationDataOutcome(
  code: string,
): Promise<GrantDataOutcome> {
  const clean = String(code || "").trim();
  if (!clean) return { state: "denied", reason: "invalid" };
  const base = grantApiBase();
  if (!base) return { state: "unavailable" };
  try {
    const res = await fetch(
      `${base}/api/integrations?action=company-grant-data`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clean }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    // A definitive denial carries both a 4xx status and a `reason`. Check the
    // reason FIRST: the relay can normalise the status code, and a body that
    // states the reason is authoritative regardless of how it was transported.
    const reason = String(json.reason ?? "").toLowerCase();
    const isDenial =
      reason === "invalid" ||
      reason === "revoked" ||
      reason === "expired" ||
      reason === "used_up" ||
      reason === "disabled" ||
      reason === "locked";
    if (isDenial)
      return { state: "denied", reason: reason as GrantRedeemFailure };
    if (res.status >= 400 && res.status < 500) {
      return { state: "denied", reason: "invalid" };
    }

    if (!res.ok) return { state: "unavailable" };
    if (!json || json.success !== true) return { state: "unavailable" };
    const snap = json.snapshot as Record<string, unknown> | undefined;
    if (!snap || typeof snap !== "object") return { state: "unavailable" };
    return { state: "ok", snapshot: snap };
  } catch {
    return { state: "unavailable" };
  }
}

/**
 * Back-compat wrapper. Prefer {@link fetchGrantStationDataOutcome} so a revoked
 * link is never silently rendered from a stale offline copy.
 */
export async function fetchGrantStationData(
  code: string,
): Promise<Record<string, unknown> | null> {
  const outcome = await fetchGrantStationDataOutcome(code);
  return outcome.state === "ok" ? outcome.snapshot : null;
}

/** Build the share link for a grant (the same link the QR encodes). */
export function buildGrantLink(code: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "https://fuel-app-mobile.pages.dev";
  return `${origin}/#/station-access?grant=${encodeURIComponent(code)}`;
}

/** Official WhatsApp deep link (wa.me) — opens WhatsApp Web on desktop and
 *  the WhatsApp app on mobile, with the message pre-filled. No API key. */
export function buildWhatsAppShareUrl(
  phoneDigits: string,
  message: string,
): string {
  const to = String(phoneDigits || "").replace(/\D/g, "");
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/** mailto: deep link — opens the default mail client with the recipient,
 *  subject and body pre-filled. mailto cannot attach files, so the body
 *  carries the share link. */
export function buildMailtoShareUrl(opts: {
  to: string;
  subject: string;
  body: string;
}): string {
  const q = new URLSearchParams({
    subject: opts.subject,
    body: opts.body,
  }).toString();
  return `mailto:${encodeURIComponent(opts.to)}?${q}`;
}
