/**
 * Customer account link — a SECOND, separate mini site.
 *
 * Distinct from the station mini site (`mini-site-service.ts`) on every axis:
 *
 *            station mini site            customer account link
 *  ─────────────────────────────────────────────────────────────────────────
 *  audience  the public                   ONE named customer
 *  content   marketing (prices, hours)    that customer's balance + history
 *  address   /site/<slug>                 /account/<token>
 *  key       chosen & memorable           crypto-random & unguessable
 *  lifetime  until unpublished            expires, and is revocable
 *
 * The distinction drives the security design. A station page is MEANT to be
 * found; a customer's balance is not — so the address is a 12-char crypto-random
 * token (~72 bits) and the document is NOT written to the public bucket. It lives
 * in `app_kv` under an owner-scoped, code-keyed row and is read server-side by
 * the resolver with the service role. That gives, in one mechanism:
 *
 *  • unguessable  — enumerating links is infeasible
 *  • revocable    — delete the row and the link is dead immediately
 *  • expiring     — enforced server-side, not just in the UI
 *  • not enumerable — nothing appears in any listing an anonymous visitor can read
 *
 * The published document is deliberately NARROW: one customer's balance, limit
 * and a capped slice of their own transactions. It never carries another
 * customer's rows, internal notes, or operator-only fields — asserted in tests.
 */

import cloudStorageService from "./cloud-storage-service";
import { grantApiBase } from "./company-grant-service";
import { randomBase62, isCapabilityCode } from "./random-code";

/**
 * A 2-letter country for the analytics counter, or "" when undetectable.
 *
 * Deliberately coarse and never blocking: it only labels a view, so an
 * unavailable value must not stop the page rendering.
 */
function analyticsCountry(): string {
  try {
    const locale = navigator?.language || "";
    const region = /-([A-Za-z]{2})$/.exec(locale)?.[1];
    return region ? region.toUpperCase() : "";
  } catch {
    return "";
  }
}

/** Logical key prefix; the stored row id is `<prefix><code>__<ownerId>`. */
const LINK_PREFIX = "customer_portal_";

/** Config (station-scoped) recording the owner's link preferences. */
const CONFIG_KEY = "customer_portal_config";

/** How many transactions a link exposes. Keeps the document small and bounded. */
export const PORTAL_TX_LIMIT = 20;

/** Default link lifetime, in days. */
export const PORTAL_DEFAULT_EXPIRY_DAYS = 30;

export interface CustomerPortalLinkRecord {
  /** The customer this link belongs to (display + audit only). */
  customerName: string;
  accountId: string;
  /** Station the link was issued from. */
  stationId?: string;
  stationName?: string;
  createdAt: string;
  expiresAt: string;
  /** Set when the owner revokes explicitly (belt-and-braces with deletion). */
  revoked?: boolean;
}

/** One transaction, reduced to what a customer is entitled to see. */
export interface PortalTransaction {
  date: string;
  type: "purchase" | "payment" | "other";
  amount: number;
  description?: string;
}

/** The document served to the customer. */
export interface CustomerPortalDocument {
  /** Issued link token; carried so the client can detect a mismatch. */
  token: string;
  customerName: string;
  accountId: string;
  currencySymbol: string;
  balance: number;
  creditLimit: number;
  /** 0–100+, or null when no limit is set (never divide by zero). */
  utilisation: number | null;
  status: string;
  /** Snapshot time — makes clear this is an as-at figure, not live. */
  asAt: string;
  periodDays: number;
  transactions: PortalTransaction[];
  /** Issued-from station identity, so the customer knows the sender. */
  stationName: string;
  stationPhone?: string;
  stationEmail?: string;
  /** Payment instructions, ONLY if the station configured them. */
  paymentInstructions?: string;
  expiresAt: string;
}

export interface CustomerPortalConfig {
  expiryDays: number;
}

export const DEFAULT_CUSTOMER_PORTAL_CONFIG: CustomerPortalConfig = {
  expiryDays: PORTAL_DEFAULT_EXPIRY_DAYS,
};

// ── config ────────────────────────────────────────────────────────────────

export function normalizePortalConfig(
  raw: Partial<CustomerPortalConfig> | null | undefined,
): CustomerPortalConfig {
  const days = Number(raw?.expiryDays);
  return {
    expiryDays: Number.isFinite(days)
      ? Math.min(365, Math.max(1, Math.trunc(days)))
      : PORTAL_DEFAULT_EXPIRY_DAYS,
  };
}

export async function loadPortalConfig(
  stationId?: string,
): Promise<CustomerPortalConfig> {
  try {
    const raw = await cloudStorageService.get<Partial<CustomerPortalConfig>>(
      CONFIG_KEY,
      stationId,
    );
    return normalizePortalConfig(raw);
  } catch {
    return { ...DEFAULT_CUSTOMER_PORTAL_CONFIG };
  }
}

export async function savePortalConfig(
  config: CustomerPortalConfig,
  stationId?: string,
): Promise<boolean> {
  try {
    await cloudStorageService.set(
      CONFIG_KEY,
      normalizePortalConfig(config),
      stationId,
    );
    return true;
  } catch (err) {
    console.warn("[customer-portal] save config failed:", err);
    return false;
  }
}

// ── address ───────────────────────────────────────────────────────────────

/** In-app hash route. Works on every host with no server involvement. */
export function customerPortalHashRoute(token: string): string {
  return `#/account/${token}`;
}

/** The shareable URL a customer opens. */
export function customerPortalUrl(token: string): string {
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return `${origin}/account/${token}`;
}

/** Extract a token from either a bare token or a pasted URL. */
export function parsePortalToken(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const fromUrl = raw.match(/\/account\/([A-Za-z0-9]{10,16})/);
  const token = fromUrl ? fromUrl[1] : raw;
  return isCapabilityCode(token) ? token : null;
}

// ── document ──────────────────────────────────────────────────────────────

export interface CreditAccountInput {
  id: string;
  customerName?: string;
  name?: string;
  balance?: number;
  creditLimit?: number;
  status?: string;
  phone?: string;
  email?: string;
  paymentInstructions?: string;
}

export interface CreditTransactionInput {
  id: string;
  accountId: string;
  type: string;
  amount: number;
  description?: string;
  date?: string;
  createdAt?: string;
  /** Internal-only author; must never be published. */
  recordedBy?: string;
}

interface StationInput {
  name?: string;
  phone?: string;
  email?: string;
}

interface BuildPortalDocInput {
  token: string;
  account: CreditAccountInput;
  transactions: CreditTransactionInput[];
  station?: StationInput;
  currencySymbol: string;
  expiresAt: string;
  now?: number;
}

/**
 * Reduce one account (plus only ITS transactions) to the published document.
 *
 * The filter is by `accountId`, and that is the single most important line
 * here: publishing another customer's transactions would leak one customer's
 * spending to another. It is asserted directly in tests.
 */
export function buildCustomerPortalDoc(
  input: BuildPortalDocInput,
): CustomerPortalDocument {
  const now = input.now ?? Date.now();
  const account = input.account;
  const balance = Number.isFinite(Number(account.balance))
    ? Number(account.balance)
    : 0;
  const limit = Number.isFinite(Number(account.creditLimit))
    ? Number(account.creditLimit)
    : 0;

  const mine = (input.transactions || [])
    .filter((t) => t && t.accountId === account.id)
    .map<PortalTransaction>((t) => {
      const raw = String(t.type || "").toLowerCase();
      const type = raw.includes("pay")
        ? "payment"
        : raw.includes("purch")
          ? "purchase"
          : "other";
      return {
        date: String(t.date || t.createdAt || ""),
        type,
        amount: Number.isFinite(Number(t.amount)) ? Number(t.amount) : 0,
        description: t.description ? String(t.description) : undefined,
      };
    })
    // Newest first, then capped: a link should not carry years of history.
    .sort((a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""))
    .slice(0, PORTAL_TX_LIMIT);

  const station = input.station || {};
  const instructions = account.paymentInstructions
    ? String(account.paymentInstructions).trim()
    : "";

  void now;
  return {
    token: input.token,
    customerName: String(account.customerName || account.name || "Customer"),
    accountId: account.id,
    currencySymbol: input.currencySymbol || "",
    balance,
    creditLimit: limit,
    // A limit of 0 (or absent) means "no limit", not "0% used" — reporting 0%
    // would be a misleading statement about the customer's headroom.
    utilisation: limit > 0 ? Math.round((balance / limit) * 100) : null,
    status: String(account.status || "active"),
    asAt: new Date(now).toISOString(),
    periodDays: PORTAL_DEFAULT_EXPIRY_DAYS,
    transactions: mine,
    stationName: String(station.name || ""),
    stationPhone: station.phone ? String(station.phone) : undefined,
    stationEmail: station.email ? String(station.email) : undefined,
    // Only ever a real configured instruction — never invented bank details.
    paymentInstructions: instructions || undefined,
    expiresAt: input.expiresAt,
  };
}

// ── lifecycle ─────────────────────────────────────────────────────────────

/**
 * Issue a link for one customer.
 *
 * The document is written first and the record second, so a link that appears
 * in the UI always has something behind it — a record with no document would
 * hand the customer a dead page.
 */
export async function createCustomerPortalLink(opts: {
  account: CreditAccountInput;
  transactions: CreditTransactionInput[];
  station?: StationInput;
  stationId?: string;
  currencySymbol: string;
  expiryDays?: number;
}): Promise<{ token: string; url: string; expiresAt: string } | null> {
  const config = normalizePortalConfig({
    expiryDays: opts.expiryDays ?? PORTAL_DEFAULT_EXPIRY_DAYS,
  });
  const token = randomBase62(12);
  const expiresAt = new Date(
    Date.now() + config.expiryDays * 86400000,
  ).toISOString();

  const doc = buildCustomerPortalDoc({
    token,
    account: opts.account,
    transactions: opts.transactions,
    station: opts.station,
    currencySymbol: opts.currencySymbol,
    expiresAt,
  });

  const record: CustomerPortalLinkRecord = {
    customerName: doc.customerName,
    accountId: doc.accountId,
    stationId: opts.stationId,
    stationName: doc.stationName,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  try {
    await cloudStorageService.set(LINK_PREFIX + token, doc, opts.stationId);
    await cloudStorageService.set(
      LINK_PREFIX + token + "_meta",
      record,
      opts.stationId,
    );
  } catch (err) {
    console.warn("[customer-portal] create failed:", err);
    return null;
  }
  return { token, url: customerPortalUrl(token), expiresAt };
}

/** Revoke one link. Deleting the document is what actually kills it. */
export async function revokeCustomerPortalLink(
  token: string,
  stationId?: string,
): Promise<boolean> {
  if (!isCapabilityCode(token)) return false;
  try {
    await cloudStorageService.delete(LINK_PREFIX + token, stationId);
    await cloudStorageService.delete(LINK_PREFIX + token + "_meta", stationId);
    return true;
  } catch (err) {
    console.warn("[customer-portal] revoke failed:", err);
    return false;
  }
}

/** Every link this owner has issued, newest first. */
export async function listCustomerPortalLinks(options?: {
  accountId?: string;
  stationId?: string;
}): Promise<
  Array<CustomerPortalLinkRecord & { token: string; expired: boolean }>
> {
  try {
    const all = await cloudStorageService.getAll();
    const out: Array<
      CustomerPortalLinkRecord & { token: string; expired: boolean }
    > = [];
    const now = Date.now();
    for (const [key, value] of Object.entries(all || {})) {
      if (!key.startsWith(LINK_PREFIX) || key.endsWith("_meta")) continue;
      const token = key.slice(LINK_PREFIX.length);
      if (!isCapabilityCode(token)) continue;
      const meta = all[LINK_PREFIX + token + "_meta"] as unknown as
        CustomerPortalLinkRecord | undefined;
      const docLike = value as unknown as
        Partial<CustomerPortalDocument> | undefined;
      // Fall back to the document when the meta row is missing, so a
      // half-written link still lists rather than vanishing.
      const customerName = String(
        meta?.customerName || docLike?.customerName || "Customer",
      );
      const accountId = String(meta?.accountId || docLike?.accountId || "");
      const expiresAt = String(meta?.expiresAt || docLike?.expiresAt || "");
      if (options?.accountId && accountId !== options.accountId) continue;
      if (
        options?.stationId &&
        meta?.stationId &&
        meta.stationId !== options.stationId
      )
        continue;
      out.push({
        token,
        customerName,
        accountId,
        stationId: meta?.stationId,
        stationName: meta?.stationName,
        createdAt: String(meta?.createdAt || ""),
        expiresAt,
        revoked: meta?.revoked === true,
        expired: expiresAt ? Date.parse(expiresAt) < now : false,
      });
    }
    return out.sort(
      (a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""),
    );
  } catch (err) {
    console.warn("[customer-portal] list failed:", err);
    return [];
  }
}

/** Whether a record is currently usable. */
export function isPortalRecordLive(
  record: { expiresAt?: string; revoked?: boolean } | null | undefined,
  now = Date.now(),
): boolean {
  if (!record) return false;
  if (record.revoked) return false;
  if (record.expiresAt && Date.parse(record.expiresAt) < now) return false;
  return true;
}

/**
 * Read a link's document through the resolver endpoint.
 *
 * The document is NOT fetchable from the public bucket, so this must go through
 * the server-side resolver on both hosts (Vercel serves it directly; Cloudflare
 * relays /api/* there). A visitor therefore cannot bypass the expiry or
 * revocation checks by fetching storage directly.
 */
export async function fetchCustomerPortalDoc(
  token: string,
): Promise<CustomerPortalDocument | null> {
  if (!isCapabilityCode(token)) return null;
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  try {
    const res = await fetch(
      `${origin}/api/customer-portal?token=${encodeURIComponent(token)}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      document?: CustomerPortalDocument;
    };
    if (!data?.success || !data.document) return null;
    if (data.document.token !== token) return null;
    return data.document;
  } catch (err) {
    console.warn("[customer-portal] fetch failed:", err);
    return null;
  }
}

/**
 * Record an anonymous view of a link (best-effort).
 *
 * The customer has no session, so this goes through the public
 * `customer-portal-view` action, which writes only a counter. Analytics must
 * never break the page, so every failure is swallowed.
 */
export async function recordCustomerPortalView(
  token: string,
  country?: string,
): Promise<void> {
  if (!isCapabilityCode(token)) return;
  const base = grantApiBase();
  if (!base) return;
  try {
    await fetch(`${base}/api/integrations?action=customer-portal-view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, country: country || analyticsCountry() }),
      keepalive: true,
    });
  } catch {
    /* analytics must never break the page */
  }
}

/**
 * Owner-side read of a link's view counter (never increments).
 *
 * A convenience tile, so a failure returns null rather than throwing — the
 * owner's panel must still render when analytics is unavailable.
 */
export async function fetchCustomerPortalViewStats(token: string): Promise<{
  views: number;
  countries: string[];
  lastViewedAt: number;
} | null> {
  if (!isCapabilityCode(token)) return null;
  const base = grantApiBase();
  if (!base) return null;
  try {
    const res = await fetch(
      `${base}/api/integrations?action=customer-portal-stats`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      views?: number;
      countries?: string[];
      lastViewedAt?: string | null;
    };
    if (!data || data.success === false) return null;
    // `views: null` is the server saying "could not read" — surface that as
    // unknown (null), NOT as 0, so the panel never claims "not opened yet"
    // when it simply does not know.
    if (data.views === null || data.views === undefined) return null;
    return {
      views: Math.max(0, Number(data.views) || 0),
      countries: Array.isArray(data.countries) ? data.countries : [],
      lastViewedAt: data.lastViewedAt ? Date.parse(data.lastViewedAt) || 0 : 0,
    };
  } catch {
    return null;
  }
}

/** One line of share text carrying the link, or "" when the token is unusable. */
export function customerPortalShareLine(
  token: string | null | undefined,
  intro = "View your account:",
): string {
  if (!token || !isCapabilityCode(token)) return "";
  return `${intro} ${customerPortalUrl(token)}`;
}

/** Human label for a link row. */
export function portalLinkStateText(link: {
  expired: boolean;
  revoked?: boolean;
}): string {
  if (link.revoked) return "Revoked";
  if (link.expired) return "Expired";
  return "Active";
}
