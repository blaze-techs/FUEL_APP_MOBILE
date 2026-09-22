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

export type GrantAccessMode = "read" | "edit" | "full";

export function grantModeLabel(
  mode: GrantAccessMode | undefined | null,
): string {
  switch (mode) {
    case "edit":
      return "Edit only";
    case "full":
      return "Normal";
    case "read":
    default:
      return "Read only";
  }
}

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
  /** Stable recipient identity used to guarantee one active link per user. */
  recipientKey: string;
}

export interface GrantCreateParams {
  memberName: string;
  memberRole?: string;
  allowedTabs: string[];
  readOnly?: boolean;
  /** Owner-decided mode: read / edit / full. Defaults to read. */
  accessMode?: GrantAccessMode;
  expiresInDays?: number; // null = never
  maxUses?: number | null; // null = unlimited (defaults to one-time)
  /** Stable user identifier (email, username, auth id, etc.). */
  recipientKey: string;
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

/** Normalize a grant access-mode value read from a cloud/DB row. */
function normalizeGrantMode(raw: unknown): GrantAccessMode {
  const v = String(raw || "read").toLowerCase();
  return v === "edit" ? "edit" : v === "full" ? "full" : "read";
}

function rowToGrant(
  r: Record<string, unknown> | undefined | null,
): CompanyGrant | null {
  if (!r) return null;
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
    readOnly: pick("read_only", "readOnly") !== false,
    accessMode: normalizeGrantMode(pick("access_mode", "accessMode")),
    enabled: pick("enabled", "enabled") !== false,
    revoked: pick("revoked", "revoked") === true,
    createdAt: ts(pick("created_at", "createdAt")) ?? Date.now(),
    expiresAt: ts(pick("expires_at", "expiresAt")),
    maxUses: num(pick("max_uses", "maxUses")) ?? 1,
    uses: num(pick("uses", "uses")) ?? 0,
    lastRedeemedAt: ts(pick("last_redeemed_at", "lastRedeemedAt")),
    recipientKey: String(pick("recipient_key", "recipientKey") ?? ""),
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

function readGrantsCache(): CompanyGrant[] {
  try {
    const raw = localStorage.getItem(GRANTS_CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeGrantsCache(grants: CompanyGrant[]) {
  try {
    localStorage.setItem(GRANTS_CACHE_KEY, JSON.stringify(grants));
  } catch {
    /* read-through cache only */
  }
}

/** Owner: list all grants for a station. Only the owner's session can see
 *  them (RLS). Never include the code when it would matter — but we include
 *  the code here because the owner needs it to copy the share link; the
 *  cloud row's RLS already limits reads to the owner. */
export async function listCompanyGrants(
  stationId?: string,
): Promise<CompanyGrant[]> {
  if (!stationId) return [];
  const ownerId = await currentOwnerId();
  if (!ownerId) return [];

  // CANONICAL SOURCE: public.company_grants. app_kv is only a legacy
  // migration source and is never consulted after relational rows exist.
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("company_grants")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("station_id", stationId)
      .order("created_at", { ascending: false });

    if (!error && Array.isArray(data)) {
      const grants = data
        .map((r) => rowToGrant(r as Record<string, unknown>))
        .filter((g): g is CompanyGrant => g !== null);

      // One-time compatibility migration for existing app_kv grants.
      // Imported legacy links become one-time links so an old unlimited
      // QR cannot continue to be reused by multiple people.
      if (grants.length === 0) {
        try {
          const legacy = await cloudStorageService.get<unknown[] | null>(
            GRANTS_KEY,
            stationId,
          );
          const legacyGrants = (Array.isArray(legacy) ? legacy : [])
            .map((r) => normalizeStoredGrant(r as Record<string, unknown>))
            .filter((g): g is CompanyGrant => g !== null)
            .filter((g) => g.ownerId === ownerId && g.stationId === stationId);

          for (const legacyGrant of legacyGrants) {
            const { error: migrateError } = await supabase
              .from("company_grants")
              .upsert({
                id: legacyGrant.id,
                code: legacyGrant.code,
                station_id: stationId,
                owner_id: ownerId,
                member_name: legacyGrant.memberName,
                member_role: legacyGrant.memberRole,
                allowed_tabs: legacyGrant.allowedTabs,
                read_only: legacyGrant.accessMode === "read",
                access_mode: legacyGrant.accessMode,
                enabled: legacyGrant.enabled,
                revoked: legacyGrant.revoked,
                created_at: new Date(legacyGrant.createdAt).toISOString(),
                expires_at: legacyGrant.expiresAt
                  ? new Date(legacyGrant.expiresAt).toISOString()
                  : null,
                max_uses: legacyGrant.maxUses ?? 1,
                uses: legacyGrant.uses,
                last_redeemed_at: legacyGrant.lastRedeemedAt
                  ? new Date(legacyGrant.lastRedeemedAt).toISOString()
                  : null,
                recipient_key: legacyGrant.recipientKey || ("legacy:" + legacyGrant.id),
              }, { onConflict: "id" });
            if (migrateError) {
              console.warn("[company-grants] legacy migration failed:", migrateError.message);
            }
          }

          if (legacyGrants.length) {
            const { data: migrated } = await supabase
              .from("company_grants")
              .select("*")
              .eq("owner_id", ownerId)
              .eq("station_id", stationId)
              .order("created_at", { ascending: false });
            const migratedGrants = (Array.isArray(migrated) ? migrated : [])
              .map((r) => rowToGrant(r as Record<string, unknown>))
              .filter((g): g is CompanyGrant => g !== null);
            writeGrantsCache(migratedGrants);
            return migratedGrants;
          }
        } catch (migrationError) {
          console.warn("[company-grants] legacy migration skipped:", migrationError);
        }
      }

      writeGrantsCache(grants);
      return grants;
    }

    if (error) throw error;
  } catch (e) {
    console.warn("[company-grants] canonical table unavailable:", e);
  }

  // Compatibility fallback only when the relational migration is unavailable.
  const stored = await cloudStorageService.get<unknown[] | null>(GRANTS_KEY, stationId);
  const grants = (Array.isArray(stored) ? stored : [])
    .map((r) => normalizeStoredGrant(r as Record<string, unknown>))
    .filter((g): g is CompanyGrant => g !== null)
    .filter((g) => g.ownerId === ownerId && g.stationId === stationId);
  writeGrantsCache(grants);
  return grants;
}

/** Owner: create a grant. The relational table is the canonical SOR.
 * Every new grant gets a fresh secret and is one-time by default. */
export async function createCompanyGrant(
  params: GrantCreateParams,
  stationId?: string,
): Promise<CompanyGrant> {
  if (!stationId) throw new Error("No station selected.");
  const ownerId = await currentOwnerId();
  if (!ownerId) throw new Error("You must be signed in to create a company QR grant.");
  const recipientKey = String(params.recipientKey || "").trim().toLowerCase();
  if (!recipientKey) throw new Error("A unique recipient identifier is required for each QR grant.");

  const mode = normalizeGrantMode(params.accessMode ?? (params.readOnly === false ? "full" : "read"));
  const expiresAt = params.expiresInDays && params.expiresInDays > 0
    ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
    : null;
  const requestedMaxUses = params.maxUses == null || Number(params.maxUses) <= 0 ? 1 : Math.floor(Number(params.maxUses));
  const maxUses = Math.min(requestedMaxUses, 1);

  const supabase = getSupabaseClient();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGrantCode();
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? "grant_" + crypto.randomUUID()
      : "grant_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
    try {
      const { data, error } = await supabase
        .from("company_grants")
        .insert({
          id, code, station_id: stationId, owner_id: ownerId,
          member_name: (params.memberName || "Team Member").trim(),
          member_role: params.memberRole || "Staff",
          allowed_tabs: params.allowedTabs || [],
          read_only: mode === "read", access_mode: mode,
          enabled: true, revoked: false, expires_at: expiresAt,
          max_uses: maxUses, uses: 0, recipient_key: recipientKey,
        })
        .select("*")
        .single();
      if (!error && data) {
        const grant = rowToGrant(data as Record<string, unknown>);
        if (!grant) throw new Error("The server returned an invalid QR grant.");
        writeGrantsCache([grant, ...readGrantsCache().filter((g) => g.id !== grant.id)]);
        return grant;
      }
      lastError = error;
      if (error && /duplicate|unique/i.test(error.message || "")) continue;
      break;
    } catch (e) {
      lastError = e;
      if (e instanceof TypeError) break;
      throw e;
    }
  }

  // Compatibility fallback only when the canonical table is not deployed.
  if (lastError && /relation .*company_grants|schema cache|not found/i.test(String((lastError as { message?: string })?.message || ""))) {
    const code = generateGrantCode();
    const id = "grant_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const grant: CompanyGrant = {
      id, code, stationId, ownerId, memberName: (params.memberName || "Team Member").trim(),
      memberRole: params.memberRole || "Staff", allowedTabs: params.allowedTabs || [],
      readOnly: mode === "read", accessMode: mode, enabled: true, revoked: false,
      createdAt: Date.now(), expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
      maxUses, uses: 0, lastRedeemedAt: null, recipientKey,
    };
    const stored = await cloudStorageService.get<unknown[] | null>(GRANTS_KEY, stationId);
    const current = Array.isArray(stored) ? stored : [];
    const next = [grant, ...current].map((r) => normalizeStoredGrant(r as Record<string, unknown>)).filter((g): g is CompanyGrant => g !== null);
    await cloudStorageService.set(GRANTS_KEY, next as unknown[], stationId);
    await cloudStorageService.set("company_grant_" + code, grant as unknown as Record<string, unknown>, stationId);
    writeGrantsCache(next);
    return grant;
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to create the QR grant.");
}

/** Owner: revoke a grant. Canonical table mutation. */
export async function revokeCompanyGrant(id: string, stationId?: string): Promise<void> {
  if (!stationId) return;
  const ownerId = await currentOwnerId();
  if (!ownerId) return;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("company_grants")
      .update({ revoked: true, enabled: false })
      .eq("id", id).eq("station_id", stationId).eq("owner_id", ownerId);
    if (!error) return;
    throw error;
  } catch (e) {
    console.warn("[company-grants] canonical revoke unavailable:", e);
  }
  const current = (await listCompanyGrants(stationId)).map((g) => g.id === id ? { ...g, revoked: true, enabled: false } : g);
  await cloudStorageService.set(GRANTS_KEY, current as unknown[], stationId);
  writeGrantsCache(current);
}

/** Owner: hard-delete a grant row. */
export async function deleteCompanyGrant(id: string, stationId?: string): Promise<void> {
  if (!stationId) return;
  const ownerId = await currentOwnerId();
  if (!ownerId) return;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("company_grants")
      .delete().eq("id", id).eq("station_id", stationId).eq("owner_id", ownerId);
    if (!error) {
      writeGrantsCache(readGrantsCache().filter((g) => g.id !== id));
      return;
    }
    throw error;
  } catch (e) {
    console.warn("[company-grants] canonical delete unavailable:", e);
  }
  const current = (await listCompanyGrants(stationId)).filter((g) => g.id !== id);
  await cloudStorageService.set(GRANTS_KEY, current as unknown[], stationId);
  writeGrantsCache(current);
}

/** Owner: rotate — revoke the old grant and create a brand-new one. */
export async function rotateCompanyGrant(id: string, stationId?: string): Promise<CompanyGrant> {
  const grants = await listCompanyGrants(stationId);
  const old = grants.find((g) => g.id === id);
  if (!old) throw new Error("Grant not found.");
  await revokeCompanyGrant(id, stationId);
  return createCompanyGrant({
    memberName: old.memberName, memberRole: old.memberRole, allowedTabs: old.allowedTabs,
    readOnly: old.readOnly, accessMode: old.accessMode,
    expiresInDays: old.expiresAt ? Math.max(1, Math.ceil((old.expiresAt - Date.now()) / 86400000)) : undefined,
    maxUses: 1, recipientKey: old.recipientKey || old.memberName,
  }, stationId);
}

/** Owner: change a grant's access mode without changing its identity/code. */
export async function updateGrantMode(id: string, mode: GrantAccessMode, stationId?: string): Promise<void> {
  if (!stationId) return;
  const ownerId = await currentOwnerId();
  if (!ownerId) return;
  const m = normalizeGrantMode(mode);
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("company_grants")
      .update({ read_only: m === "read", access_mode: m })
      .eq("id", id).eq("station_id", stationId).eq("owner_id", ownerId);
    if (!error) return;
    throw error;
  } catch (e) {
    console.warn("[company-grants] canonical mode update unavailable:", e);
  }
  const current = (await listCompanyGrants(stationId)).map((g) => g.id === id ? { ...g, readOnly: m === "read", accessMode: m } : g);
  await cloudStorageService.set(GRANTS_KEY, current as unknown[], stationId);
  writeGrantsCache(current);
}
/** Same-origin / Vercel absolute base for the redemption dispatcher (mirrors
 *  the HLS-proxy pattern: relative on Vercel, absolute cross-origin from CF). */
function redeemApiBase(): string {
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
 * Returns null on any failure (invalid / revoked / expired / disabled).
 */
export async function redeemCompanyGrant(code: string): Promise<GrantRedeemResult | null> {
  const clean = code.trim();
  if (!clean) return null;

  // CANONICAL PATH: the SECURITY DEFINER RPC is first. It operates on
  // public.company_grants and atomically enforces expiry, revocation and
  // the one-use cap. The legacy HTTP endpoint is only a compatibility
  // fallback when the RPC has not been deployed.
  let rpcUnavailable = false;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("redeem_company_grant", { p_code: clean });
    if (!error) {
      if (!data) return null;
      const r = data as Record<string, unknown>;
      if (r.locked === true) {
        throw new Error("Too many attempts. This link is temporarily locked — contact the station owner.");
      }
      if (!r.grantId) return null;
      return {
        grantId: String(r.grantId),
        memberName: String(r.memberName ?? ""),
        memberRole: String(r.memberRole ?? "Staff"),
        allowedTabs: Array.isArray(r.allowedTabs) ? (r.allowedTabs as string[]) : [],
        readOnly: r.readOnly !== false,
        accessMode: normalizeGrantMode(r.accessMode),
        stationId: String(r.stationId ?? ""),
        stationOwnerId: String(r.stationOwnerId ?? ""),
        expiresAt: r.expiresAt ? String(r.expiresAt) : null,
      };
    }
    rpcUnavailable = /PGRST202|function .* does not exist|schema cache|not found/i.test(error.message || "");
    if (!rpcUnavailable) {
      console.warn("[company-grants] redeem RPC failed:", error.message);
      return null;
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("locked")) throw e;
    if (!rpcUnavailable) {
      console.warn("[company-grants] redeem RPC unavailable:", e);
      rpcUnavailable = true;
    }
  }

  if (!rpcUnavailable) return null;

  // Compatibility only: legacy app_kv grants. These are migrated to the
  // canonical table when the owner opens Company QR. Never prefer this path
  // when the canonical RPC exists, because app_kv redemption is not atomic.
  try {
    const base = redeemApiBase();
    if (!base) return null;
    const res = await fetch(
      base + "/api/integrations?action=company-grant-redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clean }),
      },
    );
    if (!res.ok) return null;
    const r = (await res.json()) as Record<string, unknown>;
    if (!r || !r.grantId) return null;
    return {
      grantId: String(r.grantId),
      memberName: String(r.memberName ?? ""),
      memberRole: String(r.memberRole ?? "Staff"),
      allowedTabs: Array.isArray(r.allowedTabs) ? (r.allowedTabs as string[]) : [],
      readOnly: r.readOnly !== false,
      accessMode: normalizeGrantMode(r.accessMode),
      stationId: String(r.stationId ?? ""),
      stationOwnerId: String(r.stationOwnerId ?? ""),
      expiresAt: r.expiresAt ? String(r.expiresAt) : null,
    };
  } catch (e) {
    console.warn("[company-grants] legacy redeem failed:", e);
    return null;
  }
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
