/**
 * invoice-config.ts
 * Configurable invoice & quotation document settings — reverse-engineered
 * from Reatech360's "Invoices Settings" / "Quotations Settings" (prefix +
 * separator + padding + year, selectable PDF templates, bank payment details
 * incl. SWIFT/BIC, auto payment reminders + late fees).
 *
 * Everything lives in the station-scoped "documents_config" cloud key (via
 * cloudStorageService), so each station owner can pick their own document
 * style and numbering while other stations are unaffected.
 */

import cloudStorageService from "@/react-app/lib/cloud-storage-service";

// ─── Types ──────────────────────────────────────────────────────────────────

export type InvoiceSeparator = "-" | "_" | "/" | "." | "";
export type YearPosition = "none" | "before" | "after";

export type PdfTemplate = "classic" | "minimal" | "bold";

export interface InvoiceNumbering {
  prefix: string;
  separator: InvoiceSeparator;
  padding: number;
  year: YearPosition;
}

export interface BankPaymentDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string;
  swiftBic: string;
}

export interface LateFeeConfig {
  enabled: boolean;
  /** Percent of the invoice total added when overdue. */
  ratePct: number;
  /** Days past the due date before the late fee applies. */
  afterDays: number;
}

export interface DocumentsConfig {
  numbering: InvoiceNumbering;
  invoiceNextNumber: number;
  quotationNextNumber: number;
  invoiceTemplate: PdfTemplate;
  quotationTemplate: PdfTemplate;
  defaultPaymentTerms: string;
  defaultCustomerNotes: string;
  defaultTermsConditions: string;
  bankDetails: BankPaymentDetails;
  reminders: {
    enabled: boolean;
    /** Grace days after due date before the reminder fires. */
    days: number;
    lateFee: LateFeeConfig;
  };
}

export const DOCUMENTS_CONFIG_KEY = "documents_config";

/** Selectable PDF templates for invoices & quotations. */
export const PDF_TEMPLATES: Record<
  PdfTemplate,
  { id: PdfTemplate; label: string; description: string }
> = {
  classic: {
    id: "classic",
    label: "Classic",
    description: "Full-width header, right-aligned totals, signature line.",
  },
  minimal: {
    id: "minimal",
    label: "Modern Minimal",
    description: "Quiet and spacious. Hairline rules, no color blocks.",
  },
  bold: {
    id: "bold",
    label: "Bold Header",
    description: "Full-width colored band carries company info + title.",
  },
};

export const PAYMENT_TERMS_OPTIONS = [
  "Due on receipt",
  "Net 7 (7 days)",
  "Net 14 (14 days)",
  "Net 30 (30 days)",
  "Net 45 (45 days)",
  "Net 60 (60 days)",
  "Net 90 (90 days)",
];

const DEFAULT_DOCUMENTS_CONFIG: DocumentsConfig = {
  numbering: {
    prefix: "INV",
    separator: "-",
    padding: 4,
    year: "none",
  },
  invoiceNextNumber: 1,
  quotationNextNumber: 1,
  invoiceTemplate: "classic",
  quotationTemplate: "classic",
  defaultPaymentTerms: "Net 30 (30 days)",
  defaultCustomerNotes: "",
  defaultTermsConditions: "",
  bankDetails: {
    bankName: "",
    accountName: "",
    accountNumber: "",
    branch: "",
    swiftBic: "",
  },
  reminders: {
    enabled: false,
    days: 1,
    lateFee: { enabled: false, ratePct: 2, afterDays: 7 },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const pad = (n: number, width: number) =>
  String(Math.max(0, Math.floor(n || 0))).padStart(Math.max(1, width), "0");

/**
 * Build a full document number from the configured numbering format,
 * e.g. "INV-2026-0001" (year before), "INV-0001-2026" (year after) or
 * "QUO_0007" (no year).
 */
export function buildDocumentNumber(
  numbering: InvoiceNumbering,
  counter: number,
): string {
  const { prefix, separator, padding, year } = numbering;
  const p = (prefix || "").trim();
  const num = pad(counter, padding);
  const yearStr = String(new Date().getFullYear());
  if (year === "before") {
    return [p, yearStr, num].filter(Boolean).join(separator);
  }
  if (year === "after") {
    return [p, num, yearStr].filter(Boolean).join(separator);
  }
  return [p, num].filter(Boolean).join(separator);
}

/** Preview the next N sequence values, e.g. "INV-0001→INV-0002→INV-0003…". */
export function buildSequencePreview(
  numbering: InvoiceNumbering,
  start: number,
  count = 3,
): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    parts.push(buildDocumentNumber(numbering, start + i));
  }
  return `${parts.join("→")}…`;
}

export function normalizeSep(value: unknown): InvoiceSeparator {
  switch (value) {
    case "_":
    case "/":
    case ".":
    case "":
      return value as InvoiceSeparator;
    case "-":
      return "-";
    default:
      return "-";
  }
}

export function normalizePdfTemplate(value: unknown): PdfTemplate {
  const v = String(value || "").toLowerCase();
  if (v === "minimal" || v === "bold") return v as PdfTemplate;
  return "classic";
}

export function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() !== "" ? v : fallback;
}

export function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function bool(v: unknown): boolean {
  return Boolean(v);
}

export function normalizeDocumentsConfig(raw: unknown): DocumentsConfig {
  const src: any = raw && typeof raw === "object" ? raw : {};
  const n: any = src.numbering || {};
  const b: any = src.bankDetails || {};
  const r: any = src.reminders || {};
  const lf: any = (r.lateFee || {}) as any;
  return {
    numbering: {
      prefix: str(n.prefix, DEFAULT_DOCUMENTS_CONFIG.numbering.prefix),
      separator: normalizeSep(n.separator),
      padding: num(n.padding, DEFAULT_DOCUMENTS_CONFIG.numbering.padding),
      year: n.year === "before" || n.year === "after" ? n.year : "none",
    },
    invoiceNextNumber: num(
      src.invoiceNextNumber,
      DEFAULT_DOCUMENTS_CONFIG.invoiceNextNumber,
    ),
    quotationNextNumber: num(
      src.quotationNextNumber,
      DEFAULT_DOCUMENTS_CONFIG.quotationNextNumber,
    ),
    invoiceTemplate: normalizePdfTemplate(src.invoiceTemplate),
    quotationTemplate: normalizePdfTemplate(src.quotationTemplate),
    defaultPaymentTerms: str(
      src.defaultPaymentTerms,
      DEFAULT_DOCUMENTS_CONFIG.defaultPaymentTerms,
    ),
    defaultCustomerNotes: str(src.defaultCustomerNotes, ""),
    defaultTermsConditions: str(src.defaultTermsConditions, ""),
    bankDetails: {
      bankName: str(b.bankName, ""),
      accountName: str(b.accountName, ""),
      accountNumber: str(b.accountNumber, ""),
      branch: str(b.branch, ""),
      swiftBic: str(b.swiftBic, ""),
    },
    reminders: {
      enabled: bool(r.enabled),
      days: num(r.days, 1),
      lateFee: {
        enabled: bool(lf.enabled),
        ratePct: num(lf.ratePct, 2),
        afterDays: num(lf.afterDays, 7),
      },
    },
  };
}

// ─── Persistence ────────────────────────────────────────────────────────────

export async function saveDocumentsConfig(
  config: DocumentsConfig,
  stationId?: string,
): Promise<void> {
  await cloudStorageService.set(
    DOCUMENTS_CONFIG_KEY,
    config as unknown,
    stationId,
  );
}

export function getDocumentsConfigSync(stationId?: string): DocumentsConfig {
  const cached = cloudStorageService.getCached<unknown>(
    DOCUMENTS_CONFIG_KEY,
    stationId,
  );
  return normalizeDocumentsConfig(cached);
}

export async function loadDocumentsConfig(
  stationId?: string,
): Promise<DocumentsConfig> {
  const value = await cloudStorageService.get<unknown>(
    DOCUMENTS_CONFIG_KEY,
    stationId,
  );
  return normalizeDocumentsConfig(value);
}

/** Due date helper for payment-terms presets, e.g. "Net 30" → +30 days. */
export function dueDateFromTerms(terms: string, base?: string | Date): Date {
  const match = /Net\s+(\d+)/i.exec(terms || "");
  const days = match ? parseInt(match[1], 10) : 30;
  const from = base ? new Date(base) : new Date();
  from.setDate(from.getDate() + days);
  return from;
}

/** Format a date to the site's standard short presentation. */
export function formatDateShort(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("en-GB")}`;
}
