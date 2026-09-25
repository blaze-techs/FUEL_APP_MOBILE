import cloudStorageService from "./cloud-storage-service";
import { grantApiBase, getMpesaConfig, getKopokopoConfig } from "./company-grant-service";
import { isCapabilityCode, randomBase62 } from "./random-code";
import { buildPaymentMethods, type PortalPaymentMethod } from "./customer-portal-service";

export type ExternalMiniSiteKind =
  | "customer"
  | "fleet-customer"
  | "driver"
  | "supplier"
  | "invoice"
  | "communication"
  | "support"
  | "loyalty"
  | "service";

export interface ExternalMiniSiteRow {
  label: string;
  value: string | number;
}

export interface ExternalMiniSiteSection {
  key: string;
  title: string;
  rows?: ExternalMiniSiteRow[];
  columns?: string[];
  data?: Array<Array<string | number>>;
}

export interface ExternalMiniSiteDocument {
  token: string;
  kind: ExternalMiniSiteKind;
  title: string;
  subtitle?: string;
  entityId: string;
  entityName: string;
  stationId?: string;
  stationName: string;
  stationPhone?: string;
  stationEmail?: string;
  currencySymbol: string;
  asAt: string;
  expiresAt: string;
  paymentInstructions?: string;
  paymentMethods: PortalPaymentMethod[];
  sections: ExternalMiniSiteSection[];
}

export interface ExternalMiniSiteLinkRecord {
  token: string;
  kind: ExternalMiniSiteKind;
  entityId: string;
  entityName: string;
  stationId?: string;
  stationName?: string;
  createdAt: string;
  expiresAt: string;
  revoked?: boolean;
}

export const EXTERNAL_PORTAL_DEFAULT_EXPIRY_DAYS = 30;
const PREFIX = "external_mini_site_";

export const EXTERNAL_PORTAL_LABELS: Record<ExternalMiniSiteKind, string> = {
  customer: "Customer Portal",
  "fleet-customer": "Fleet Customer Portal",
  driver: "Driver Portal",
  supplier: "Supplier Portal",
  invoice: "Invoice Portal",
  communication: "Customer Communication Portal",
  support: "Support Portal",
  loyalty: "Loyalty Portal",
  service: "Service Portal",
};

export function externalMiniSiteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/portal/${token}`;
}

export function externalMiniSiteShareLine(
  token: string | null | undefined,
  intro = "Open your FuelPro portal:",
): string {
  return token && isCapabilityCode(token)
    ? `${intro} ${externalMiniSiteUrl(token)}`
    : "";
}

export function normalizeExternalExpiry(days?: number): number {
  const n = Number(days);
  return Number.isFinite(n)
    ? Math.min(365, Math.max(1, Math.trunc(n)))
    : EXTERNAL_PORTAL_DEFAULT_EXPIRY_DAYS;
}

async function resolvePaymentMethods(stationId?: string) {
  try {
    const [mpesa, kopokopo] = await Promise.all([
      getMpesaConfig(stationId),
      getKopokopoConfig(stationId),
    ]);
    return buildPaymentMethods({ mpesa, kopokopo });
  } catch {
    return [];
  }
}

export async function createExternalMiniSiteLink(input: {
  kind: ExternalMiniSiteKind;
  entityId: string;
  entityName: string;
  stationId?: string;
  stationName?: string;
  stationPhone?: string;
  stationEmail?: string;
  currencySymbol?: string;
  paymentInstructions?: string;
  paymentMethods?: PortalPaymentMethod[];
  sections: ExternalMiniSiteSection[];
  expiryDays?: number;
}): Promise<{ token: string; url: string; expiresAt: string } | null> {
  if (!input.entityId || !input.entityName || !input.kind) return null;

  const token = randomBase62(12);
  const expiresAt = new Date(
    Date.now() + normalizeExternalExpiry(input.expiryDays) * 86400000,
  ).toISOString();

  const paymentMethods =
    input.paymentMethods ?? (await resolvePaymentMethods(input.stationId));

  const doc: ExternalMiniSiteDocument = {
    token,
    kind: input.kind,
    title: EXTERNAL_PORTAL_LABELS[input.kind],
    subtitle: input.entityName,
    entityId: String(input.entityId),
    entityName: String(input.entityName),
    stationId: input.stationId,
    stationName: String(input.stationName || ""),
    stationPhone: input.stationPhone ? String(input.stationPhone) : undefined,
    stationEmail: input.stationEmail ? String(input.stationEmail) : undefined,
    currencySymbol: String(input.currencySymbol || ""),
    asAt: new Date().toISOString(),
    expiresAt,
    paymentInstructions: input.paymentInstructions
      ? String(input.paymentInstructions).trim()
      : undefined,
    paymentMethods,
    sections: input.sections.slice(0, 12).map((section) => ({
      key: String(section.key),
      title: String(section.title),
      rows: (section.rows || []).slice(0, 30).map((row) => ({
        label: String(row.label),
        value: row.value,
      })),
      columns: section.columns?.slice(0, 12).map(String),
      data: section.data?.slice(0, 60).map((row) =>
        row.slice(0, 12).map((cell) =>
          typeof cell === "number" ? cell : String(cell ?? ""),
        ),
      ),
    })),
  };

  const meta: ExternalMiniSiteLinkRecord = {
    token,
    kind: input.kind,
    entityId: String(input.entityId),
    entityName: String(input.entityName),
    stationId: input.stationId,
    stationName: doc.stationName,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  try {
    await cloudStorageService.set(PREFIX + token, doc, input.stationId);
    await cloudStorageService.set(
      PREFIX + token + "_meta",
      meta,
      input.stationId,
    );
    return { token, url: externalMiniSiteUrl(token), expiresAt };
  } catch (err) {
    console.warn("[external-mini-site] create failed:", err);
    return null;
  }
}

export async function listExternalMiniSiteLinks(options?: {
  kind?: ExternalMiniSiteKind;
  entityId?: string;
  stationId?: string;
}) {
  try {
    const all = await cloudStorageService.getAll();
    const now = Date.now();
    const out: Array<ExternalMiniSiteLinkRecord & { expired: boolean }> = [];
    for (const [key, value] of Object.entries(all || {})) {
      if (!key.startsWith(PREFIX) || key.endsWith("_meta")) continue;
      const token = key.slice(PREFIX.length);
      if (!isCapabilityCode(token)) continue;
      const doc = value as Partial<ExternalMiniSiteDocument>;
      const meta = all[PREFIX + token + "_meta"] as ExternalMiniSiteLinkRecord | undefined;
      const record = meta || {
        token,
        kind: doc.kind as ExternalMiniSiteKind,
        entityId: String(doc.entityId || ""),
        entityName: String(doc.entityName || ""),
        stationId: doc.stationId,
        stationName: doc.stationName,
        createdAt: String(doc.asAt || ""),
        expiresAt: String(doc.expiresAt || ""),
      };
      if (options?.kind && record.kind !== options.kind) continue;
      if (options?.entityId && record.entityId !== options.entityId) continue;
      if (options?.stationId && record.stationId && record.stationId !== options.stationId) continue;
      out.push({ ...record, expired: Boolean(record.expiresAt && Date.parse(record.expiresAt) < now) });
    }
    return out.sort((a,b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  } catch (err) {
    console.warn("[external-mini-site] list failed:", err);
    return [];
  }
}

export async function revokeExternalMiniSiteLink(
  token: string,
  stationId?: string,
): Promise<boolean> {
  if (!isCapabilityCode(token)) return false;
  try {
    await cloudStorageService.delete(PREFIX + token, stationId);
    await cloudStorageService.delete(PREFIX + token + "_meta", stationId);
    return true;
  } catch {
    return false;
  }
}

export async function fetchExternalMiniSiteDoc(
  token: string,
): Promise<ExternalMiniSiteDocument | null> {
  if (!isCapabilityCode(token)) return null;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const res = await fetch(
      `${base}/api/external-mini-site?token=${encodeURIComponent(token)}`,
      { headers: { accept: "application/json" }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      document?: ExternalMiniSiteDocument;
    };
    if (!data.success || !data.document || data.document.token !== token)
      return null;
    return {
      ...data.document,
      paymentMethods: data.document.paymentMethods || [],
      sections: data.document.sections || [],
    };
  } catch {
    return null;
  }
}
