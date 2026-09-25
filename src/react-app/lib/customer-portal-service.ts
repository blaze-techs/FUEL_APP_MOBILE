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
import { getMpesaConfig, getKopokopoConfig } from "./mpesa-integration-service";
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

/**
 * A saved invoice belonging to this customer.
 *
 * Deliberately a SUMMARY, not the line items: the page's job is "which
 * invoices are outstanding and for how much". Item descriptions and unit
 * prices carry internal costing and are not needed to answer that.
 */
export interface PortalInvoice {
  number: string;
  date: string;
  amount: number;
  status: "paid" | "unpaid";
}

/**
 * A payment channel the customer can actually use — Paybill/Till number or
 * bank details. Only ever what the station configured; a wrong paybill number
 * sends the customer's money to a stranger, so nothing is ever inferred.
 */
export interface PortalPaymentMethod {
  kind: "paybill" | "till" | "bank";
  label: string;
  number: string;
  accountRef?: string;
}

/**
 * Totals over the transactions shown on the page.
 *
 * Computed over the SAME list the customer sees, so the figures reconcile
 * with the rows beneath them — a summary that silently covers a wider window
 * than the visible list is worse than no summary.
 */
export interface PortalStatement {
  from: string;
  to: string;
  purchases: number;
  payments: number;
  net: number;
  count: number;
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
  /** This customer's invoices, newest first and capped like transactions. */
  invoices: PortalInvoice[];
  /** Payment channels the customer can use — configured only. */
  paymentMethods: PortalPaymentMethod[];
  /** Totals over the transactions shown, or null when there are none. */
  statement: PortalStatement | null;
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

/** How many invoices a link may carry, matching the transaction cap. */
export const PORTAL_INVOICE_LIMIT = 20;

interface BuildPortalDocInput {
  token: string;
  account: CreditAccountInput;
  transactions: CreditTransactionInput[];
  /** Saved invoices; only this customer's are published. */
  invoices?: InvoiceInput[];
  /** Payment channels the station configured (Paybill/Till/bank). */
  paymentMethods?: PortalPaymentMethod[];
  station?: StationInput;
  currencySymbol: string;
  expiresAt: string;
  now?: number;
}

/** A saved invoice, in the shape the app stores them. */
export interface InvoiceInput {
  number?: string;
  customerName?: string;
  customer?: { name?: string };
  date?: string;
  totalAmount?: number;
  status?: string;
}

/**
 * Match an invoice to a customer by name.
 *
 * Saved invoices store the customer as free text typed at billing time, with
 * no link to the credit account — so name is the only join available. It is
 * matched case-insensitively and trimmed, and an EMPTY name never matches:
 * a blank name would otherwise sweep every unnamed invoice into whichever
 * customer happens to open a link.
 */
export function invoiceBelongsTo(
  invoice: InvoiceInput,
  accountName: string,
): boolean {
  const norm = (v: unknown) =>
    String(v ?? "")
      .trim()
      .toLowerCase();
  const target = norm(accountName);
  const onInvoice = norm(invoice.customerName || invoice.customer?.name);
  // An empty name on either side never matches: invoices saved without a
  // customer, and an account saved without one, would otherwise agree on the
  // empty string and put every unnamed invoice on that account's page.
  if (target === "" || onInvoice === "") return false;
  return onInvoice === target;
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
  const accountName = String(
    account.customerName || account.name || "Customer",
  );
  // Match invoices against the account's REAL name. Using `accountName` here
  // would match every invoice literally billed to "Customer", which is a name
  // people do type — so the fallback stays for display only.
  const matchName = String(account.customerName || account.name || "");

  // This customer's invoices, newest first. The match is by name because that
  // is the only join the invoice record offers (see `invoiceBelongsTo`).
  const invoices = (input.invoices || [])
    .filter((inv) => inv && invoiceBelongsTo(inv, matchName))
    .map<PortalInvoice>((inv) => ({
      number: String(inv.number || ""),
      date: String(inv.date || ""),
      amount: Number.isFinite(Number(inv.totalAmount))
        ? Number(inv.totalAmount)
        : 0,
      status:
        String(inv.status || "").toLowerCase() === "paid" ? "paid" : "unpaid",
    }))
    .sort((a, b) => Date.parse(b.date || "") - Date.parse(a.date || ""))
    .slice(0, PORTAL_INVOICE_LIMIT);

  // Payment channels, from configuration only. A method with no number is
  // dropped rather than shown as a blank the customer might mistype into.
  const paymentMethods = (input.paymentMethods || [])
    .filter((m) => m && String(m.number || "").trim() !== "")
    .map<PortalPaymentMethod>((m) => ({
      kind: m.kind,
      label: String(m.label || ""),
      number: String(m.number).trim(),
      accountRef: m.accountRef ? String(m.accountRef).trim() : undefined,
    }));

  // Totals over exactly the rows published above, so the figures and the list
  // cannot disagree.
  const statement: PortalStatement | null =
    mine.length === 0
      ? null
      : {
          from: mine[mine.length - 1].date,
          to: mine[0].date,
          purchases: mine
            .filter((t) => t.type === "purchase")
            .reduce((sum, t) => sum + t.amount, 0),
          payments: mine
            .filter((t) => t.type === "payment")
            .reduce((sum, t) => sum + t.amount, 0),
          net: mine.reduce(
            (sum, t) => sum + (t.type === "payment" ? -t.amount : t.amount),
            0,
          ),
          count: mine.length,
        };

  void now;
  return {
    token: input.token,
    customerName: accountName,
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
    invoices,
    paymentMethods,
    statement,
    expiresAt: input.expiresAt,
  };
}

/**
 * Build the payment channels worth showing, from the station's own
 * integration config.
 *
 * Only an ENABLED integration with a non-empty shortcode/till qualifies: a
 * disabled or half-configured gateway must not appear as a way to pay, or the
 * customer sends money into a void. Kenya-station data, so it is offered only
 * when the config exists at all — a US station has none and simply gets no
 * payment section.
 */
export function buildPaymentMethods(input: {
  mpesa?: {
    enabled?: boolean;
    shortcode?: string;
    type?: string;
    accountReference?: string;
  } | null;
  kopokopo?: { enabled?: boolean; tillNumber?: string } | null;
}): PortalPaymentMethod[] {
  const out: PortalPaymentMethod[] = [];
  const mpesa = input.mpesa;
  if (mpesa?.enabled && String(mpesa.shortcode || "").trim()) {
    out.push({
      kind: mpesa.type === "buy_goods" ? "till" : "paybill",
      label: mpesa.type === "buy_goods" ? "M-PESA Buy Goods" : "M-PESA Paybill",
      number: String(mpesa.shortcode).trim(),
      accountRef: mpesa.accountReference
        ? String(mpesa.accountReference).trim()
        : undefined,
    });
  }
  const kopo = input.kopokopo;
  if (kopo?.enabled && String(kopo.tillNumber || "").trim()) {
    out.push({
      kind: "till",
      label: "M-PESA Till (Kopo Kopo)",
      number: String(kopo.tillNumber).trim(),
    });
  }
  return out;
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
  /** Saved invoices; filtered to this customer inside the builder. */
  invoices?: InvoiceInput[];
  /** Otherwise the station's configured channels are read from the cloud. */
  paymentMethods?: PortalPaymentMethod[];
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

  // Default to the station's OWN configured channels. Reading them here (not
  // at each call site) keeps every link consistent, and they are published as
  // a snapshot so the page cannot show a channel the station later disabled.
  let paymentMethods = opts.paymentMethods;
  if (!paymentMethods) {
    try {
      const [mpesa, kopokopo] = await Promise.all([
        getMpesaConfig(opts.stationId),
        getKopokopoConfig(opts.stationId),
      ]);
      paymentMethods = buildPaymentMethods({ mpesa, kopokopo });
    } catch {
      // A config read failure must not block issuing a link; the customer
      // simply gets the page without a payment section.
      paymentMethods = [];
    }
  }

  const doc = buildCustomerPortalDoc({
    token,
    account: opts.account,
    transactions: opts.transactions,
    invoices: opts.invoices,
    paymentMethods,
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
    // Links issued before invoices/paymentMethods existed have neither field.
    // Normalise here so the page can render unconditionally instead of
    // guarding every access — a missing array is empty, not an error.
    return {
      ...data.document,
      transactions: data.document.transactions || [],
      invoices: data.document.invoices || [],
      paymentMethods: data.document.paymentMethods || [],
      statement: data.document.statement ?? null,
    };
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
