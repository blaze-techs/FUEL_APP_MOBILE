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
}

export interface GrantCreateParams {
  memberName: string;
  memberRole?: string;
  allowedTabs: string[];
  readOnly?: boolean;
  /** Owner-decided mode: read / edit / full. Defaults to read. */
  accessMode?: GrantAccessMode;
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
  try {
    const ownerId = await currentOwnerId();
    if (!ownerId) return [];
    const stored = await cloudStorageService.get<unknown[] | null>(
      GRANTS_KEY,
      stationId,
    );
    const grants = (Array.isArray(stored) ? stored : [])
      .map((r) => normalizeStoredGrant(r as Record<string, unknown>))
      .filter((g): g is CompanyGrant => g !== null)
      .filter((g) => g.ownerId === ownerId && g.stationId === stationId);
    writeGrantsCache(grants);
    return grants;
  } catch (e) {
    console.warn("[company-grants] list failed:", e);
    return readGrantsCache().filter((g) => g.stationId === stationId);
  }
}

/** Owner: create a grant. Returns the full grant INCLUDING the secret code
 *  so the caller can build the share link + QR. */
export async function createCompanyGrant(
  params: GrantCreateParams,
  stationId?: string,
): Promise<CompanyGrant> {
  if (!stationId) throw new Error("No station selected.");
  const ownerId = await currentOwnerId();
  if (!ownerId)
    throw new Error("You must be signed in to create a company QR grant.");

  const code = generateGrantCode();
  const id = `grant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt =
    params.expiresInDays && params.expiresInDays > 0
      ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
      : null;
  const mode = normalizeGrantMode(
    params.accessMode ?? (params.readOnly === false ? "full" : "read"),
  );
  const grant: CompanyGrant = {
    id,
    code,
    stationId,
    ownerId,
    memberName: (params.memberName || "Team Member").trim(),
    memberRole: params.memberRole || "Staff",
    allowedTabs: params.allowedTabs || [],
    readOnly: mode === "read",
    accessMode: mode,
    enabled: true,
    revoked: false,
    createdAt: Date.now(),
    expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
    maxUses: params.maxUses ?? null,
    uses: 0,
    lastRedeemedAt: null,
  };

  const stored = await cloudStorageService.get<unknown[] | null>(
    GRANTS_KEY,
    stationId,
  );
  const current = Array.isArray(stored) ? stored : [];
  const next = [grant, ...current]
    .map((r) => normalizeStoredGrant(r as Record<string, unknown>))
    .filter((g): g is CompanyGrant => g !== null);
  await cloudStorageService.set(GRANTS_KEY, next as unknown[], stationId);

  // ALSO persist a code-keyed row so the serverless redeemer can look it up
  // by code with an O(1) `like.` query (no owner/station known server-side).
  // The endpoint never echoes the code; it just validates + reads the config.
  try {
    await cloudStorageService.set(
      `company_grant_${code}`,
      grant as unknown as Record<string, unknown>,
      stationId,
    );
  } catch (e) {
    console.warn("[company-grants] code row write failed:", e);
  }

  writeGrantsCache(next);
  return grant;
}

/** Owner: revoke a grant (server-side revoked=true → the redeem path refuses
 *  it even on replay). */
export async function revokeCompanyGrant(
  id: string,
  stationId?: string,
): Promise<void> {
  if (!stationId) return;
  const ownerId = await currentOwnerId();
  if (!ownerId) return;
  const current = (await listCompanyGrants(stationId)).map((g) => {
    if (g.id !== id) return g;
    // Also drop the code-keyed row so a replayed old code can't be found.
    try {
      void cloudStorageService.delete(`company_grant_${g.code}`, stationId);
    } catch {
      /* best-effort */
    }
    return { ...g, revoked: true, enabled: false };
  });
  await cloudStorageService.set(GRANTS_KEY, current as unknown[], stationId);
  writeGrantsCache(current);
  void ownerId;
}

/** Owner: hard-delete a grant row (removes it entirely). */
export async function deleteCompanyGrant(
  id: string,
  stationId?: string,
): Promise<void> {
  if (!stationId) return;
  const current = (await listCompanyGrants(stationId)).filter((g) => {
    if (g.id !== id) return true;
    try {
      void cloudStorageService.delete(`company_grant_${g.code}`, stationId);
    } catch {
      /* best-effort */
    }
    return false;
  });
  await cloudStorageService.set(GRANTS_KEY, current as unknown[], stationId);
  writeGrantsCache(current);
}

/** Owner: rotate — create a brand-new code/grant and revoke the old one in
 *  one step (the old link dies immediately). */
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

/** Owner: change a grant's access mode (read / edit / full). */
export async function updateGrantMode(
  id: string,
  mode: GrantAccessMode,
  stationId?: string,
): Promise<void> {
  if (!stationId) return;
  const m = normalizeGrantMode(mode);
  const current = (await listCompanyGrants(stationId)).map((g) => {
    if (g.id !== id) return g;
    // Keep the code-keyed row in sync so the serverless redeemer returns
    // the same mode.
    try {
      void cloudStorageService.set(
        `company_grant_${g.code}`,
        { ...g, readOnly: m === "read", accessMode: m } as Record<
          string,
          unknown
        >,
        stationId,
      );
    } catch {
      /* best-effort */
    }
    return { ...g, readOnly: m === "read", accessMode: m };
  });
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
export async function redeemCompanyGrant(
  code: string,
): Promise<GrantRedeemResult | null> {
  const clean = code.trim();
  if (!clean) return null;

  // 1) Integrations dispatcher first (works without the migration).
  try {
    const base = redeemApiBase();
    if (base) {
      const res = await fetch(
        `${base}/api/integrations?action=company-grant-redeem`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: clean }),
        },
      );
      if (res.ok) {
        const r = (await res.json()) as Record<string, unknown>;
        if (r && r.grantId) {
          return {
            grantId: String(r.grantId),
            memberName: String(r.memberName ?? ""),
            memberRole: String(r.memberRole ?? "Staff"),
            allowedTabs: Array.isArray(r.allowedTabs)
              ? (r.allowedTabs as string[])
              : [],
            readOnly: r.readOnly !== false,
            accessMode: normalizeGrantMode(r.accessMode),
            stationId: String(r.stationId ?? ""),
            stationOwnerId: String(r.stationOwnerId ?? ""),
            expiresAt: r.expiresAt ? String(r.expiresAt) : null,
          };
        }
      }
      // 4xx is a definitive answer (invalid/revoked/expired/maxed) — the
      // RPC would say the same thing, so stop here.
      if (res.status >= 400 && res.status < 500) return null;
    }
  } catch (e) {
    // Network hiccup → try the RPC path below.
    console.warn("[company-grants] redeem dispatcher unavailable:", e);
  }

  // 2) RPC fallback (migration 027 applied).
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("redeem_company_grant", {
      p_code: clean,
    });
    if (error) {
      // PGRST202 = RPC not deployed yet → not found.
      console.warn("[company-grants] redeem RPC unavailable:", error.message);
      return null;
    }
    if (!data) return null;
    const r = data as Record<string, unknown>;
    if (r.locked === true) {
      throw new Error(
        "Too many attempts. This link is temporarily locked — contact the station owner.",
      );
    }
    if (!r.grantId) return null;
    return {
      grantId: String(r.grantId),
      memberName: String(r.memberName ?? ""),
      memberRole: String(r.memberRole ?? "Staff"),
      allowedTabs: Array.isArray(r.allowedTabs)
        ? (r.allowedTabs as string[])
        : [],
      readOnly: r.readOnly !== false,
      accessMode: normalizeGrantMode(r.accessMode),
      stationId: String(r.stationId ?? ""),
      stationOwnerId: String(r.stationOwnerId ?? ""),
      expiresAt: r.expiresAt ? String(r.expiresAt) : null,
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes("locked")) throw e;
    console.warn("[company-grants] redeem failed:", e);
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
