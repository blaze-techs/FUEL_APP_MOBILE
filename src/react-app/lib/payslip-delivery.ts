/**
 * Payslip delivery service — generates-uploads-sends employee payslip PDFs
 * via the real integrations dispatcher (email with PDF attachment, WhatsApp
 * document message with a public link). Recipients are identified from the
 * employee's OWN payroll record (phone / email) — no manual re-entry.
 */
import { getSupabaseClient } from "@/supabase/client";
import { getDetectedCountryCode } from "./currency";
import cloudStorageService from "./cloud-storage-service";

export type PayslipChannel = "email" | "whatsapp" | "both";

export interface PayslipDeliveryConfig {
  enabled: boolean;
  channel: PayslipChannel;
  /** Day of month (1–28) to auto-send payslips. */
  sendDay: number;
  /** Auto-send on the configured day when the app is open. */
  autoSend: boolean;
  /** Last period key ("YYYY-MM") auto-sent, to avoid duplicates. */
  lastAutoSentPeriod: string;
  /**
   * When the API gateway is NOT configured, manual sends fall back to
   * opening the web app instead: WhatsApp Web (wa.me deep link, works on
   * desktop + mobile app) or the default mail client (mailto:). Auto-send
   * never opens web tabs (popup blockers + unattended sends) — it requires
   * a configured API gateway.
   */
  webFallback: boolean;
  /**
   * Days a generated payslip short-link (/p/<code>) stays valid after
   * being shared. After expiry the link returns an "expired" page instead
   * of the PDF. Default 7; configurable 1–90.
   */
  linkExpiryDays: number;
}

export const PAYSLIP_CONFIG_KEY = "payroll_payslip_config";
export const PAYSLIP_LOG_KEY = "payroll_payslip_log";

export const defaultPayslipConfig: PayslipDeliveryConfig = {
  enabled: false,
  channel: "email",
  sendDay: 1,
  autoSend: false,
  lastAutoSentPeriod: "",
  webFallback: true,
  linkExpiryDays: 7,
};

export interface PayslipSendLogEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  period: string; // "August 2026"
  channel: PayslipChannel;
  recipient: string; // masked email/phone
  status: "sent" | "failed" | "pending";
  error?: string;
  sentAt: string;
  manual: boolean;
  /** How the payslip was delivered: "api" (gateway) or "web" (wa.me/mailto). */
  method?: "api" | "web";
}

/** A web-redirect fallback for a channel whose API gateway is not configured. */
export interface PayslipWebFallback {
  kind: "email" | "whatsapp";
  url: string;
  label: string;
}

const DIALING_CODES: Record<string, string> = {
  KE: "254",
  UG: "256",
  TZ: "255",
  RW: "250",
  GH: "233",
  NG: "234",
  ZA: "27",
  US: "1",
  GB: "44",
  IN: "91",
  PH: "63",
  MY: "60",
  CN: "86",
  JP: "81",
  KR: "82",
  AU: "61",
  NZ: "64",
  CA: "1",
  BR: "55",
  MX: "52",
  AR: "54",
  CL: "56",
  CO: "57",
  PE: "51",
  TR: "90",
  RU: "7",
  DE: "49",
  FR: "33",
  IT: "39",
  ES: "34",
  NL: "31",
  PT: "351",
  SE: "46",
  NO: "47",
  DK: "45",
  FI: "358",
  PL: "48",
  AE: "971",
  SA: "966",
  EG: "20",
  PK: "92",
  BD: "880",
  TH: "66",
  VN: "84",
};

/**
 * Normalize a payroll phone number to an international E.164-ish digit string
 * for WhatsApp/M-PESA-style recipients. Handles leading-0 local format.
 */
export function normalizePhoneForSending(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  // Already international (no leading 0, has the country dialing code length)
  if (!digits.startsWith("0")) return digits;
  const cc = getDetectedCountryCode();
  const dialing = DIALING_CODES[cc] || "";
  return dialing + digits.slice(1);
}

export function maskRecipient(v: string): string {
  if (!v) return "";
  if (v.includes("@")) {
    const [u, d] = v.split("@");
    return `${u.slice(0, 2)}***@${d}`;
  }
  if (v.length > 5) return `${v.slice(0, 3)}****${v.slice(-2)}`;
  return "****";
}

/** Short opaque payslip link (/p/<code>) mapped to the raw storage URL. */
export const PAYSLIP_SHORTLINK_PREFIX = "payslip_shortlink_";

export interface PayslipShortlinkRecord {
  /** The raw storage URL — only ever resolved server-side via the short link. */
  url: string;
  employeeName: string;
  periodLabel: string;
  createdAt: string;
  /** ISO timestamp after which the link returns "expired". */
  expiresAt: string;
}

const BASE62_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Crypto-random unguessable short code (12 base62 chars ≈ 71.6 bits of
 * entropy). Rejection sampling removes modulo bias — each char is uniformly
 * distributed, so brute-forcing a valid code is infeasible.
 */
export function generatePayslipCode(length = 12): string {
  const out: string[] = [];
  // 256 % 62 == 8 → accept bytes < 248 to eliminate modulo bias.
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of buf) {
      if (b < 248) {
        out.push(BASE62_CHARS[b % 62]);
        if (out.length === length) break;
      }
    }
  }
  return out.join("");
}

/**
 * Register a short link for a payslip PDF. The raw storage URL (which leaks
 * the owner uid + employee filename + storage path when shared directly) is
 * stored server-side; only the opaque /p/<code> link ever leaves the app.
 * Security properties:
 * - 12-char crypto-random code (unguessable, unique per send)
 * - server-side expiry (default 7 days, owner-configurable 1–90)
 * - revocable via revokePayslipShortlinks()
 * - the /p endpoint rate-limits lookups + validates the redirect target
 *   against the Supabase storage origin (no open redirects).
 */
export async function createPayslipShortlink(opts: {
  rawUrl: string;
  employeeName: string;
  periodLabel: string;
  expiryDays: number;
}): Promise<{ code: string; shortUrl: string }> {
  const code = generatePayslipCode();
  const days = Math.min(90, Math.max(1, Math.trunc(opts.expiryDays) || 7));
  const record: PayslipShortlinkRecord = {
    url: opts.rawUrl,
    employeeName: opts.employeeName,
    periodLabel: opts.periodLabel,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
  };
  await cloudStorageService.set(PAYSLIP_SHORTLINK_PREFIX + code, record);
  // Both hosts resolve /api/payslip-link?code=<code> (Vercel serverless +
  // Cloudflare Pages Function), so an origin-relative short link always
  // resolves. ~65 chars instead of a 200+ char raw storage URL.
  const shortUrl = `${window.location.origin}/api/payslip-link?code=${code}`;
  return { code, shortUrl };
}

/**
 * Revoke every live payslip short-link for this owner (e.g. after a leak,
 * or to rotate access). Each revoked link immediately returns "not found"
 * on the /p endpoint.
 */
export async function revokePayslipShortlinks(): Promise<number> {
  const all = await cloudStorageService.getAll();
  const keys = Object.keys(all).filter((k) =>
    k.startsWith(PAYSLIP_SHORTLINK_PREFIX),
  );
  for (const key of keys) {
    await cloudStorageService.delete(key);
  }
  return keys.length;
}

/**
 * Official WhatsApp deep link (wa.me) — opens WhatsApp Web on desktop and the
 * WhatsApp app on mobile, with the message pre-filled. This is the public,
 * no-API-key redirect documented by WhatsApp (https://faq.whatsapp.com/...).
 * The payslip PDF cannot be attached to a wa.me link, so the message carries
 * the public download URL (the recipient taps it to get the PDF).
 */
export function buildWhatsAppWebUrl(
  phoneDigits: string,
  message: string,
): string {
  const to = String(phoneDigits || "").replace(/\D/g, "");
  const text = encodeURIComponent(message);
  return `https://wa.me/${to}?text=${text}`;
}

/**
 * mailto: deep link — opens the user's default mail client (Gmail web,
 * Outlook, Apple Mail...) with recipient/subject/body pre-filled. mailto
 * cannot attach files, so the body includes the public payslip download link.
 */
export function buildMailtoUrl(opts: {
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

/**
 * Build the web-redirect fallback link(s) for whichever channel(s) lack a
 * configured API gateway. Returns an empty array when everything needed is
 * API-ready. Used to give the user a one-click manual path instead of a dead
 * "not configured" failure.
 */
export function buildPayslipWebFallbacks(opts: {
  channel: PayslipChannel;
  toEmail: string;
  toPhone: string; // raw payroll phone
  /**
   * Short opaque payslip link (/p/<code>) — the recipient taps this. The
   * raw storage URL never appears in the shared message, and the link is
   * expiring + revocable.
   */
  shortUrl: string;
  filename: string;
  periodLabel: string;
  employeeName: string;
  stationName: string;
  gateway: CommGatewayConfig;
}): PayslipWebFallback[] {
  const out: PayslipWebFallback[] = [];
  const tryEmail = opts.channel === "email" || opts.channel === "both";
  const tryWhatsApp = opts.channel === "whatsapp" || opts.channel === "both";
  const emailReady = !!(opts.gateway.emailEnabled && opts.gateway.emailApiKey);
  const whatsappReady = !!(
    opts.gateway.whatsappEnabled &&
    opts.gateway.whatsappPhone &&
    opts.gateway.whatsappToken
  );

  if (tryEmail && !emailReady && opts.toEmail?.includes("@")) {
    out.push({
      kind: "email",
      url: buildMailtoUrl({
        to: opts.toEmail,
        subject: `Your ${opts.periodLabel} Payslip — ${opts.stationName}`,
        body:
          `Dear ${opts.employeeName},\n\n` +
          `Please find your payslip for ${opts.periodLabel} at the link below:\n\n` +
          `${opts.shortUrl}\n\n` +
          `This link expires in a few days — download it soon.\n\n` +
          `Thank you,\n${opts.stationName}`,
      }),
      label: "Open email app",
    });
  }

  if (tryWhatsApp && !whatsappReady) {
    const waTo = normalizePhoneForSending(opts.toPhone);
    if (waTo) {
      out.push({
        kind: "whatsapp",
        url: buildWhatsAppWebUrl(
          waTo,
          `Hello ${opts.employeeName}, your ${opts.periodLabel} payslip is ready (link expires in a few days): ${opts.shortUrl} — ${opts.stationName}`,
        ),
        label: "Open WhatsApp",
      });
    }
  }

  return out;
}

/** Current payroll period key, e.g. "2026-08". */
export function currentPeriodKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentPeriodLabel(): string {
  const d = new Date();
  return `${d.toLocaleString("default", { month: "long" })} ${d.getFullYear()}`;
}

/**
 * Upload a payslip PDF (as a Blob) to the public `fuelpro-files` bucket and
 * return its public URL. The URL is used as the WhatsApp document link and as
 * the fallback link inside the email body.
 */
export async function uploadPayslipPdf(
  pdfBlob: Blob,
  ownerId: string,
  filename: string,
): Promise<{ url: string; path: string }> {
  const client = getSupabaseClient();
  const safeName = filename.replace(/[^\w.-]+/g, "_");
  const path = `payslips/${ownerId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await client.storage
    .from("fuelpro-files")
    .upload(path, pdfBlob, {
      cacheControl: "3600",
      upsert: false,
      contentType: "application/pdf",
    });
  if (upErr) throw new Error(`Payslip upload failed: ${upErr.message}`);
  const { data } = client.storage.from("fuelpro-files").getPublicUrl(path);
  if (!data?.publicUrl)
    throw new Error("Payslip upload succeeded but returned no public URL");
  return { url: data.publicUrl, path };
}

export interface CommGatewayConfig {
  // email
  emailEnabled?: boolean;
  emailProvider?: string;
  emailApiKey?: string;
  emailDomain?: string;
  senderEmail?: string;
  smtpUser?: string;
  stationName?: string;
  // whatsapp
  whatsappEnabled?: boolean;
  whatsappPhone?: string; // phone_number_id
  whatsappToken?: string;
}

export interface PayslipSendResult {
  channel: PayslipChannel;
  success: boolean;
  error?: string;
  /**
   * Web-redirect links for any channel that could not be delivered via its
   * API gateway (e.g. gateway not configured). The caller may open these
   * (manual sends only) to deliver via WhatsApp Web / the mail client.
   */
  webFallbacks?: PayslipWebFallback[];
}

/**
 * Send a payslip PDF to an employee via the chosen channel.
 * `pdfBase64` = base64 PDF body (email attachment); `publicUrl` = the uploaded
 * storage URL (WhatsApp document link + email fallback link).
 */
export async function deliverPayslip(opts: {
  channel: PayslipChannel;
  toEmail: string;
  toPhone: string; // raw payroll phone
  filename: string;
  pdfBase64: string;
  publicUrl: string;
  /** Optional short link (/p/<code>) used in user-visible text/captions. */
  shortUrl?: string;
  periodLabel: string;
  employeeName: string;
  gateway: CommGatewayConfig;
}): Promise<PayslipSendResult> {
  const { callIntegration } = await import("./integrations-client");
  const results: string[] = [];
  const errs: string[] = [];
  const channel = opts.channel;
  const tryEmail = channel === "email" || channel === "both";
  const tryWhatsApp = channel === "whatsapp" || channel === "both";

  if (tryEmail) {
    if (!opts.toEmail?.includes("@")) {
      errs.push("no employee email on file");
    } else if (!(opts.gateway.emailEnabled && opts.gateway.emailApiKey)) {
      errs.push("email gateway not configured");
    } else {
      try {
        const res = await callIntegration("email-send", {
          provider: opts.gateway.emailProvider || "sendgrid",
          to: opts.toEmail,
          subject: `Your ${opts.periodLabel} Payslip — ${opts.gateway.stationName || "Payroll"}`,
          text:
            `Dear ${opts.employeeName},\n\n` +
            `Please find attached your payslip for ${opts.periodLabel}.\n\n` +
            `If the attachment does not open, you can also download it here:\n${opts.shortUrl || opts.publicUrl}\n\n` +
            `Thank you,\n${opts.gateway.stationName || "Payroll"}`,
          fromEmail: opts.gateway.senderEmail || opts.gateway.smtpUser || "",
          fromName: opts.gateway.stationName || "Payroll",
          apiKey: opts.gateway.emailApiKey,
          domain: opts.gateway.emailDomain,
          attachment: {
            filename: opts.filename,
            contentBase64: opts.pdfBase64,
            mimeType: "application/pdf",
          },
        });
        if (res.success) results.push("email");
        else errs.push(`email: ${res.error || "send failed"}`);
      } catch (e) {
        errs.push(`email: ${(e as Error).message}`);
      }
    }
  }

  if (tryWhatsApp) {
    const waTo = normalizePhoneForSending(opts.toPhone);
    if (!waTo) {
      errs.push("no employee phone on file");
    } else if (!(
      opts.gateway.whatsappEnabled &&
      opts.gateway.whatsappPhone &&
      opts.gateway.whatsappToken
    )) {
      errs.push("WhatsApp gateway not configured");
    } else {
      try {
        const res = await callIntegration("whatsapp-send", {
          phoneNumberId: opts.gateway.whatsappPhone,
          token: opts.gateway.whatsappToken,
          to: waTo,
          message:
            `Your ${opts.periodLabel} payslip is attached.` +
            (opts.shortUrl ? ` Backup link: ${opts.shortUrl}` : ""),
          documentUrl: opts.publicUrl,
          documentFilename: opts.filename,
        });
        if (res.success) results.push("whatsapp");
        else errs.push(`whatsapp: ${res.error || "send failed"}`);
      } catch (e) {
        errs.push(`whatsapp: ${(e as Error).message}`);
      }
    }
  }

  // If any requested channel could not go out via its API gateway, offer the
  // equivalent web-redirect link(s) so a manual send can still be completed.
  let webFallbacks: PayslipWebFallback[] | undefined;
  if (!results.length || (errs.length && channel === "both")) {
    const fb = buildPayslipWebFallbacks({
      channel: opts.channel,
      toEmail: opts.toEmail,
      toPhone: opts.toPhone,
      shortUrl: opts.shortUrl || opts.publicUrl,
      filename: opts.filename,
      periodLabel: opts.periodLabel,
      employeeName: opts.employeeName,
      stationName: opts.gateway.stationName || "Payroll",
      gateway: opts.gateway,
    });
    // Only surface fallbacks for the channels that actually failed.
    const failedEmail = tryEmail && !results.includes("email");
    const failedWhatsApp = tryWhatsApp && !results.includes("whatsapp");
    const filtered = fb.filter(
      (f) =>
        (f.kind === "email" && failedEmail) ||
        (f.kind === "whatsapp" && failedWhatsApp),
    );
    if (filtered.length) webFallbacks = filtered;
  }

  return {
    channel,
    success: results.length > 0,
    error: errs.length ? errs.join(" | ") : undefined,
    webFallbacks,
  };
}
