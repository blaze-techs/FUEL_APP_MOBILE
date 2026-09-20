import { supabaseAdmin } from "./supabase-admin.js";

export function mpesaBaseUrl(): string {
  return (process.env.MPESA_ENVIRONMENT || "production").toLowerCase() ===
    "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

export function mpesaConfig() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY || "";
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET || "";
  const passkey = process.env.MPESA_PASSKEY || "";
  const shortcode = process.env.MPESA_SHORTCODE || "";
  const callbackUrl = process.env.MPESA_CALLBACK_URL || "";
  if (!consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl)
    throw new Error("M-Pesa server credentials are incomplete");
  return { consumerKey, consumerSecret, passkey, shortcode, callbackUrl };
}

export async function mpesaToken(): Promise<string> {
  const c = mpesaConfig();
  const auth = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString(
    "base64",
  );
  const res = await fetch(
    `${mpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) throw new Error(`M-Pesa OAuth failed (${res.status})`);
  const body: any = await res.json();
  if (!body.access_token)
    throw new Error("M-Pesa OAuth returned no access token");
  return body.access_token;
}

export function mpesaTimestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function mpesaPassword(timestamp: string): string {
  const c = mpesaConfig();
  return Buffer.from(`${c.shortcode}${c.passkey}${timestamp}`).toString(
    "base64",
  );
}

export function normalizeKenyanPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (/^2547\d{8}$/.test(digits) || /^2541\d{8}$/.test(digits)) return digits;
  if (/^07\d{8}$/.test(digits) || /^01\d{8}$/.test(digits))
    return `254${digits.slice(1)}`;
  throw new Error("Phone must be a valid Kenyan mobile number");
}

export function callbackMetadata(items: any[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of items || []) if (item?.Name) out[item.Name] = item.Value;
  return out;
}

export async function auditServer(
  stationId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  newValues: any,
) {
  if (!supabaseAdmin) return;
  await supabaseAdmin.from("immutable_audit_log").insert({
    station_id: stationId,
    user_id: null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    new_values: newValues,
  });
}
