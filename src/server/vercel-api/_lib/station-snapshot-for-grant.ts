/**
 * Authoritative station data for a Company-QR / shared-grant member.
 *
 * WHY THIS EXISTS
 * The member portal used to render a *published snapshot* — a partial copy the
 * owner's browser uploaded to Storage. That copy went stale the moment the
 * owner changed a price or completed a sale, and it was built from FuelContext
 * state fields that are `null` for salesHistory/employees/expenses/offloading,
 * so the member saw "Total Revenue 0", no staff and no payments while the owner
 * saw real figures. Two views of one station therefore contradicted each other.
 *
 * Instead, the member now reads the SAME authoritative station rows the owner
 * reads, resolved server-side with the service role and authorised by the grant
 * code itself. One source of truth, no copy to drift, and no RLS secret is ever
 * handed to the browser — only the specific station-scoped operational data.
 *
 * Authorisation: the grant code is the credential. Revocation, disablement,
 * expiry and the use cap are enforced here (and in `redeem_company_grant`)
 * before any row is read, so a revoked link can never read station data.
 */
import zlib from "node:zlib";
// Relative + explicit `.js` extension: this module is compiled by the Vercel
// function bundler (node16 resolution), which does not resolve the `@/` path
// alias. Both targets are dependency-free reference tables, so they are safe
// to pull into the serverless bundle.
import {
  getCountryPrice,
  normalizeFuelType,
} from "../../../react-app/config/pricing.js";
import {
  getCountryByCode,
  getCountryByCurrency,
  normalizeCurrencyCode,
} from "../../../react-app/lib/world-country-utils.js";

/**
 * Role-default tab sets. MUST stay identical to
 * `MemberPortal.ROLE_DEFAULT_TABS` — the member UI filters tabs by those, and
 * this decides which sections the payload actually carries. A drift between
 * the two would either hide data the member should see or ship data the owner
 * never granted.
 */
const ROLE_DEFAULT_TABS: Record<string, string[]> = {
  manager: [
    "dashboard",
    "sales",
    "pos",
    "inventory",
    "livetransaction",
    "offloading",
    "delivery",
    "invoice",
    "credit",
    "mpesa",
    "payroll",
    "shifts",
    "customers",
    "fuelsalesreport",
    "reports",
    "analytics",
    "communication",
    "news",
    "data",
    "fueltypes",
    "team",
    "suppliers",
    "maintenance",
    "expenses",
  ],
  staff: [
    "dashboard",
    "sales",
    "pos",
    "inventory",
    "livetransaction",
    "offloading",
    "delivery",
    "mpesa",
    "shifts",
    "customers",
    "communication",
    "news",
    "credit",
  ],
  auditor: [
    "dashboard",
    "sales",
    "inventory",
    "mpesa",
    "payroll",
    "shifts",
    "fuelsalesreport",
    "reports",
    "analytics",
    "audit",
    "customers",
    "credit",
    "communication",
    "news",
    "expenses",
    "delivery",
    "fueltypes",
  ],
};

function normalizeRole(role: string): string {
  const r = (role || "").toLowerCase();
  if (r.includes("manager")) return "manager";
  if (r.includes("staff") || r.includes("cashier") || r.includes("attendant"))
    return "staff";
  if (r.includes("audit")) return "auditor";
  if (r.includes("owner")) return "manager";
  return "staff";
}

export interface GrantIdentity {
  grantId: string;
  stationId: string;
  ownerId: string;
  memberName: string;
  memberRole: string;
  readOnly: boolean;
  accessMode: string;
  allowedTabs: string[];
  expiresAt: string | null;
  /** How the grant was resolved — surfaced only for diagnostics. */
  source: "table" | "mirror";
}

export type GrantResolveFailure =
  "invalid" | "disabled" | "revoked" | "expired" | "used_up";

export interface GrantResolveResult {
  grant: GrantIdentity | null;
  reason?: GrantResolveFailure;
}

/** Unwrap the `{__compressed,c,o}` / `{__c,d}` / double-encoded envelopes. */
export function decodeStored(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { __compressed?: boolean }).__compressed === true &&
    typeof (raw as { c?: unknown }).c === "string"
  ) {
    try {
      return JSON.parse(
        zlib
          .gunzipSync(Buffer.from((raw as { c: string }).c, "base64"))
          .toString(),
      );
    } catch {
      /* fall through */
    }
  }
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { __c?: number }).__c === 1 &&
    typeof (raw as { d?: unknown }).d === "string"
  ) {
    try {
      return JSON.parse(
        zlib
          .gunzipSync(Buffer.from((raw as { d: string }).d, "base64"))
          .toString(),
      );
    } catch {
      /* fall through */
    }
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

interface GrantRowLike {
  id?: unknown;
  revoked?: unknown;
  enabled?: unknown;
  expires_at?: unknown;
  expiresAt?: unknown;
  max_uses?: unknown;
  maxUses?: unknown;
  uses?: unknown;
  station_id?: unknown;
  stationId?: unknown;
  owner_id?: unknown;
  ownerId?: unknown;
  member_name?: unknown;
  memberName?: unknown;
  member_role?: unknown;
  memberRole?: unknown;
  read_only?: unknown;
  readOnly?: unknown;
  access_mode?: unknown;
  accessMode?: unknown;
  allowed_tabs?: unknown;
  allowedTabs?: unknown;
}

/** Numeric ms epoch from an ISO string OR a numeric ms value. */
function toEpochMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  const t = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(t) ? t : null;
}

/**
 * Authorise a grant code and return the station it grants access to.
 *
 * Order matters: the relational `company_grants` table is the source of truth,
 * and the `app_kv` mirror is only consulted for grants created before the
 * table existed.
 */
export async function resolveGrantForAccess(
  code: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<GrantResolveResult> {
  const clean = String(code || "").trim();
  if (!clean) return { grant: null, reason: "invalid" };

  const fromRow = (row: GrantRowLike, source: "table" | "mirror") => {
    const expiresMs = toEpochMs(row.expires_at ?? row.expiresAt);
    if (row.revoked === true)
      return { grant: null, reason: "revoked" as const };
    if (row.enabled === false)
      return { grant: null, reason: "disabled" as const };
    if (expiresMs != null && expiresMs <= Date.now())
      return { grant: null, reason: "expired" as const };
    const maxUses = row.max_uses == null ? null : Number(row.max_uses);
    const uses = Number(row.uses ?? 0);
    if (maxUses != null && Number.isFinite(maxUses) && uses >= maxUses)
      return { grant: null, reason: "used_up" as const };

    const readOnly = row.read_only !== false && row.readOnly !== false;
    return {
      grant: {
        grantId: String(row.id ?? ""),
        stationId: String(row.station_id ?? row.stationId ?? ""),
        ownerId: String(row.owner_id ?? row.ownerId ?? ""),
        memberName: String(row.member_name ?? row.memberName ?? "Team Member"),
        memberRole: String(row.member_role ?? row.memberRole ?? "Staff"),
        readOnly,
        accessMode: String(
          row.access_mode ?? row.accessMode ?? (readOnly ? "read" : "full"),
        ),
        allowedTabs: Array.isArray(row.allowed_tabs)
          ? (row.allowed_tabs as string[])
          : Array.isArray(row.allowedTabs)
            ? (row.allowedTabs as string[])
            : [],
        expiresAt: expiresMs != null ? new Date(expiresMs).toISOString() : null,
        source,
      } as GrantIdentity,
    };
  };

  // 1) Relational table (case-insensitive; QR codes are mixed case).
  const authUrl = new URL("/rest/v1/company_grants", supabaseUrl);
  authUrl.searchParams.set("select", "*");
  authUrl.searchParams.set("code", `ilike.${clean}`);
  authUrl.searchParams.set("limit", "1");
  const authResp = await fetch(authUrl, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (authResp.ok) {
    const rows = (await authResp.json()) as GrantRowLike[];
    if (rows.length) return fromRow(rows[0], "table");
  }

  // 2) Legacy app_kv mirror (pre-relational grants).
  const mirrorUrl = new URL("/rest/v1/app_kv", supabaseUrl);
  mirrorUrl.searchParams.set("select", "data");
  // `ilike` treats `_` as a single-char wildcard, so the exact-code check
  // below is what actually authorises — never the pattern match alone.
  mirrorUrl.searchParams.set(
    "id",
    `ilike.company_grant_${clean.replace(/[%_\\]/g, (c) => `\\${c}`)}__%`,
  );
  mirrorUrl.searchParams.set("limit", "1");
  const mirrorResp = await fetch(mirrorUrl, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (mirrorResp.ok) {
    const rows = (await mirrorResp.json()) as { data: unknown }[];
    if (rows.length) {
      const decoded = decodeStored(rows[0].data) as
        (GrantRowLike & { code?: unknown }) | null;
      if (decoded && typeof decoded === "object") {
        if (String(decoded.code ?? "").toLowerCase() !== clean.toLowerCase()) {
          return { grant: null, reason: "invalid" };
        }
        return fromRow(decoded, "mirror");
      }
    }
  }

  return { grant: null, reason: "invalid" };
}

/** All station-scoped app_kv rows, keyed by their logical (unscoped) name. */
async function readStationRows(
  ownerId: string,
  stationId: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Map<string, unknown>> {
  const out = new Map<string, unknown>();
  const url = new URL("/rest/v1/app_kv", supabaseUrl);
  url.searchParams.set("select", "id,data");
  url.searchParams.set("owner_id", `eq.${ownerId}`);
  url.searchParams.set("station_id", `eq.${stationId}`);
  url.searchParams.set("limit", "500");
  const resp = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!resp.ok) return out;
  const rows = (await resp.json()) as { id: string; data: unknown }[];
  for (const row of rows) {
    const id = String(row.id || "");
    let logical = id.split("__")[0];
    // FuelContext's per-station compact blob is named by construction.
    if (/^user_.+_compact$/.test(logical)) logical = "__compact__";
    if (!out.has(logical)) out.set(logical, decodeStored(row.data));
  }
  return out;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/**
 * The station's own market, from the station's own record. Never the reader's
 * locale: a member in a different country must be judged against the station's
 * prices, not their own reference band.
 */
function resolveStationMarketCountry(
  company: Record<string, unknown>,
  compact: Record<string, unknown>,
): string {
  const explicit = str(company.country, compact.country).toUpperCase();
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  // A symbol is accepted here as a last resort: if "KSh" is the only signal a
  // record carries, Kenya is the honest inference. The DISPLAY currency is
  // held to a stricter rule (see resolveStationCurrencyCode) because that is
  // the value the member actually reads.
  const byCurrency = getCountryByCurrency(
    str(company.companyCurrency, company.currency, compact.currency),
  );
  return (byCurrency || "").toUpperCase();
}

/**
 * The currency CODE to hand the member UI. The owner's app runs the same
 * resolution (`resolveCurrencySymbol`): a stale symbol is discarded in favour
 * of the station's country, so the member can never render "KSh 1.42" for a
 * USD station.
 */
function resolveStationCurrencyCode(
  company: Record<string, unknown>,
  compact: Record<string, unknown>,
  marketCountry: string,
): string {
  const code = normalizeCurrencyCode(
    str(company.companyCurrency, compact.companyCurrency),
  );
  if (code) return code;
  const fromCountry = marketCountry
    ? getCountryByCode(marketCountry)?.currency
    : undefined;
  return (fromCountry || "USD").toUpperCase();
}

/**
 * Same band `isPlausibleStationPrice` applies on the client (25%..400% of the
 * country reference for that fuel). Kept to the shared reference tables so
 * server and client cannot drift; an unknown country is never rejected.
 */
function isPlausibleForMarket(
  price: number,
  countryCode: string,
  fuelType: string,
): boolean {
  if (!Number.isFinite(price) || price <= 0) return false;
  const cc = (countryCode || "").toUpperCase();
  if (!cc) return true;
  const reference = getCountryPrice(
    cc,
    normalizeFuelType(fuelType) || fuelType,
  );
  if (!reference || !Number.isFinite(reference.price) || reference.price <= 0) {
    return true;
  }
  return price >= reference.price * 0.25 && price <= reference.price * 4;
}

function num(...candidates: unknown[]): number {
  for (const c of candidates) {
    const n = typeof c === "number" ? c : parseFloat(String(c ?? ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function str(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
    if (typeof c === "number") return String(c);
  }
  return "";
}

/**
 * Build the member-facing station payload from the SAME authoritative rows the
 * owner's app reads. Shape matches the client's `StationSnapshot` so the
 * existing read-only portal renders unchanged.
 */
export async function buildStationSnapshotForGrant(
  grant: GrantIdentity,
  supabaseUrl: string,
  serviceKey: string,
): Promise<Record<string, unknown>> {
  const { stationId, ownerId } = grant;
  const rows = await readStationRows(
    ownerId,
    stationId,
    supabaseUrl,
    serviceKey,
  );
  const compact = (rows.get("__compact__") || {}) as Record<string, unknown>;
  const compactCompany = (compact.companyData || {}) as Record<string, unknown>;

  // ── Fuel prices + pumps (canonical fuel_types_config) ──────────────────
  const fuelConfig = asArray(rows.get("fuel_types_config"));
  const stationCountry = resolveStationMarketCountry(
    compactCompany,
    compact as Record<string, unknown>,
  );
  const fuelPrices = fuelConfig
    .filter((f) => f.active !== false)
    .map((f) => {
      const raw = num(f.price);
      const label = str(f.localName, f.name);
      // Mirror `useStationFuelTypes`: a price that cannot be right for the
      // station's OWN market is "unknown" (0), never silently replaced. The
      // member must see exactly what the owner sees.
      const price = isPlausibleForMarket(raw, stationCountry, label) ? raw : 0;
      return { label, price, code: str(f.code) };
    });
  const pumps = fuelConfig
    .filter((f) => f.active !== false)
    .map((f) => ({ fuel: str(f.localName, f.name), count: num(f.pumpCount) }))
    .filter((p) => p.fuel);

  // ── Sales: canonical POS ledger (same source the owner's KPIs read) ────
  const posTxns = asArray(rows.get("pos_transactions"));
  const recentSales = posTxns
    .slice()
    .sort(
      (a, b) =>
        Date.parse(String(a.timestamp ?? a.createdAt ?? "")) -
        Date.parse(String(b.timestamp ?? b.createdAt ?? "")),
    )
    .slice(-30)
    .reverse()
    .map((t) => {
      const items = asArray(t.items);
      const litres = items.reduce((s, i) => s + num(i.litres, i.quantity), 0);
      const firstFuel = items.find((i) => str(i.fuelType));
      return {
        invoice: str(t.invoiceNumber, t.receiptNumber, t.id),
        date: str(t.timestamp, t.createdAt),
        total: num(t.total),
        fuel: str(firstFuel?.fuelType),
        litres,
        payment: str(t.paymentMethod, t.payment),
      };
    });
  const salesKpis = {
    totalRevenue: posTxns.reduce((s, t) => s + num(t.total), 0),
    totalFuelSold: posTxns.reduce(
      (s, t) =>
        s + asArray(t.items).reduce((a, i) => a + num(i.litres, i.quantity), 0),
      0,
    ),
    transactionCount: posTxns.length,
  };

  // ── Invoices / customers (compact blob — the authoritative store) ──────
  const invoicesObj = (compact.invoices || {}) as Record<string, unknown>;
  const invoices = Object.values(invoicesObj)
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .slice(-30)
    .reverse()
    .map((inv) => {
      const customer = inv.customer as Record<string, unknown> | undefined;
      // `status` is the field of record. Never derive it from a truthy
      // fallback: `status || paid` made every non-paid invoice render "paid".
      const status =
        typeof inv.status === "string" && inv.status
          ? inv.status
          : inv.paid === true
            ? "paid"
            : "unpaid";
      return {
        number: str(inv.invoiceNumber, inv.number, inv.id),
        customer: str(customer?.name, inv.customerName, inv.clientName),
        total: num(inv.totalAmount, inv.total, inv.amount),
        date: str(inv.date, inv.issueDate, inv.createdAt),
        status,
      };
    });

  const clientsObj = (compact.clients || {}) as Record<string, unknown>;
  const customers = Object.values(clientsObj)
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .slice(0, 100)
    .map((c) => ({
      name: str(c.name, c.customerName),
      phone: str(c.phone, c.contact),
      email: str(c.email),
    }))
    .filter((c) => c.name);

  // ── Credit, expenses, payments, suppliers, staff, maintenance ──────────
  const creditAccounts = asArray(rows.get("credit_accounts"))
    .slice(0, 100)
    .map((a) => ({
      name: str(a.customerName, a.name),
      balance: num(a.balance, a.outstandingBalance),
      limit: num(a.creditLimit, a.limit),
      status: str(a.status) || "active",
    }))
    .filter((a) => a.name);

  const expenses = asArray(rows.get("expenses_data"))
    .slice(-50)
    .reverse()
    .map((e) => ({
      category: str(e.category, e.type) || "Other",
      amount: num(e.amount, e.cost),
      date: str(e.date, e.createdAt),
    }));

  const payments = asArray(rows.get("mpesa_transactions"))
    .slice(-50)
    .reverse()
    .map((p) => ({
      ref: str(p.transaction_ref, p.reference, p.ref, p.receipt),
      amount: num(p.amount),
      status: str(p.status),
      origin: str(p.origin, p.source),
      date: str(p.transaction_time, p.date, p.createdAt),
    }));

  const purchases: Record<string, unknown>[] = [];
  asArray(rows.get("suppliers_data"))
    .slice(0, 50)
    .forEach((s) =>
      purchases.push({
        type: "supplier",
        name: str(s.name, s.supplierName),
        amount: num(s.balance, s.totalDue),
        date: str(s.createdAt, s.date),
        status: str(s.status) || "active",
      }),
    );
  asArray(rows.get("purchase_orders"))
    .slice(0, 50)
    .forEach((po) =>
      purchases.push({
        type: "purchase-order",
        name: str(po.supplierName, po.supplier) || "Purchase Order",
        amount: num(po.total, po.amount),
        date: str(po.createdAt, po.date),
        status: str(po.status) || "open",
      }),
    );

  const employees = asArray(rows.get("payroll_employees")).map((e) => ({
    name: str(e.fullName, e.full_name, e.name, e.employeeName),
    role: str(e.role, e.position),
    status: str(e.status) || (e.active === false ? "inactive" : "active"),
  }));

  const shifts = asArray(rows.get("shift_employees")).map((e) => ({
    name: str(e.fullName, e.full_name, e.name, e.employeeName),
    role: str(e.role, e.position),
    phone: str(e.phone),
    active: e.active !== false,
  }));

  const maintenance = asArray(rows.get("maintenance_records"))
    .slice(0, 50)
    .map((m) => ({
      title: str(m.title, m.description, m.equipment) || "Maintenance",
      equipment: str(m.equipment, m.category),
      cost: num(m.cost, m.amount),
      status: str(m.status) || "open",
      date: str(m.date, m.createdAt),
    }));

  const contacts = asArray(rows.get("comm_contacts"))
    .slice(0, 50)
    .map((c) => ({
      name: str(c.name),
      phone: str(c.phone),
      email: str(c.email),
      tags: Array.isArray(c.tags)
        ? (c.tags as string[]).join(", ")
        : str(c.tags),
      starred: Boolean(c.starred),
    }));

  const quality = asArray(rows.get("fuel_quality_tests"))
    .slice(0, 50)
    .map((q) => ({
      fuel: str(q.fuelType, q.fuel),
      testType: str(q.testType, q.test, q.type) || "Quality Test",
      result: str(q.result, q.reading),
      status: q.passed ? "Pass" : str(q.status) || "Pending",
      date: str(q.date, q.createdAt),
    }));

  // ── Deliveries / offloading (compact blob) ─────────────────────────────
  const deliveryRows = asArray(
    (compact.deliveryData as Record<string, unknown> | undefined)?.rows,
  );
  const deliveries = deliveryRows
    .slice(-50)
    .reverse()
    .map((d) => ({
      date: str(d.date),
      reg: str(d.reg, d.vehicle, d.truck),
      fuel: str(d.fuel),
      litres: num(d.litres),
      amount: num(d.amount),
      name: str(d.name),
      debt: num(d.debt),
    }));

  const offloading = asArray(compact.offloadingRecords)
    .slice(-50)
    .reverse()
    .map((o) => ({
      truck: str(o.truckNumber, o.truck, o.vehicle),
      fuel: str(o.fuelType),
      litres: num(o.litres, o.quantity, o.volume),
      date: str(o.date, o.offloadDate),
    }));

  const payable = purchases
    .filter((p) => p.type === "purchase-order")
    .reduce((s, p) => s + num(p.amount), 0);
  const balanceDue = num(
    (compact.deliveryData as Record<string, unknown> | undefined)?.totals &&
      (
        (compact.deliveryData as Record<string, unknown>).totals as Record<
          string,
          unknown
        >
      ).balanceDue,
  );

  const full: Record<string, unknown> = {
    stationId,
    stationName: str(compactCompany.name) || "Station",
    stationLocation: str(compactCompany.physicalAddress),
    currency: resolveStationCurrencyCode(
      compactCompany,
      compact as Record<string, unknown>,
      stationCountry,
    ),
    updatedAt: Date.now(),
    fuelPrices,
    pumps,
    tankLevels: [],
    recentSales,
    salesKpis,
    creditAccounts,
    expenses,
    invoices,
    offloading,
    employees,
    companyData: {
      name: str(compactCompany.name) || "Station",
      phone: str(compactCompany.contacts),
      email: str(compactCompany.email),
      kraPin: str(compactCompany.kraPin),
      vatNumber: str(compactCompany.vatRegNo),
    },
    deliveries,
    customers,
    purchases,
    maintenance,
    contacts,
    quality,
    shifts,
    payments,
    reportKpis: {
      totalDebt: balanceDue,
      totalExpenses: expenses.reduce((s, e) => s + num(e.amount), 0),
      totalCreditOutstanding: creditAccounts.reduce(
        (s, c) => s + num(c.balance),
        0,
      ),
      totalPayables: payable,
      totalDeliveries: deliveries.length,
      totalOffloading: offloading.length,
      totalTeamMembers: employees.length,
      totalActiveShifts: shifts.filter((s) => s.active !== false).length,
    },
    /** Advisory only — the member UI already filters tabs by this. */
    allowedTabs: grant.allowedTabs,
    dataSource: "live",
  };

  // ── Section gating (server-enforced) ─────────────────────────────────
  // The member UI filters which TABS it renders, but the payload itself must
  // not carry data for sections the owner did not grant. Otherwise a member
  // could read the response directly and see everything. Mirror the client's
  // role-default tab sets here so both sides agree.
  const hasGrantedTabs = grant.allowedTabs.length > 0;
  const effective = new Set<string>(
    hasGrantedTabs
      ? [...grant.allowedTabs, "dashboard"]
      : ROLE_DEFAULT_TABS[normalizeRole(grant.memberRole)] ||
          ROLE_DEFAULT_TABS.staff,
  );

  const gate = <T>(tabIds: string[], value: T): T | [] =>
    tabIds.some((id) => effective.has(id)) ? value : [];

  return {
    ...full,
    fuelPrices: gate(["dashboard", "price-finder", "fueltypes"], fuelPrices),
    pumps: gate(["dashboard", "pos", "pumpmapping"], pumps),
    recentSales: gate(
      ["sales", "pos", "reports", "fuelsalesreport", "analytics"],
      recentSales,
    ),
    salesKpis: gate(
      ["sales", "pos", "reports", "dashboard", "fuelsalesreport", "analytics"],
      salesKpis,
    ),
    creditAccounts: gate(["credit"], creditAccounts),
    expenses: gate(["expenses", "reports", "analytics"], expenses),
    invoices: gate(["invoice"], invoices),
    offloading: gate(["offloading", "delivery"], offloading),
    employees: gate(["payroll", "team"], employees),
    shifts: gate(["team", "shifts"], shifts),
    maintenance: gate(["maintenance"], maintenance),
    contacts: gate(["communication"], contacts),
    quality: gate(["fueltypes", "quality"], quality),
    customers: gate(["customers"], customers),
    purchases: gate(["suppliers"], purchases),
    deliveries: gate(["delivery"], deliveries),
    payments: gate(["mpesa", "livetransaction"], payments),
    // Aggregates are derived from gated sections — gate each one by the same
    // section so a member cannot read a total for a section they can't see.
    reportKpis: {
      totalDebt: effective.has("delivery") ? balanceDue : 0,
      totalExpenses: effective.has("expenses")
        ? expenses.reduce((s, e) => s + num(e.amount), 0)
        : 0,
      totalCreditOutstanding: effective.has("credit")
        ? creditAccounts.reduce((s, c) => s + num(c.balance), 0)
        : 0,
      totalPayables: effective.has("suppliers") ? payable : 0,
      totalDeliveries: effective.has("delivery") ? deliveries.length : 0,
      totalOffloading: effective.has("delivery") ? offloading.length : 0,
      totalTeamMembers:
        effective.has("team") || effective.has("payroll")
          ? employees.length
          : 0,
      totalActiveShifts: effective.has("team") ? shifts.length : 0,
    },
  };
}
