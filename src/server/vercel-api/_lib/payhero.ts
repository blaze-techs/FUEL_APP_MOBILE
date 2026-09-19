import { normalizeKenyanPhone } from "./mpesa.js";

const BASE_URL = process.env.PAYHERO_BASE_URL || "https://api.payhero.africa";

export function payHeroConfig() {
  const username = process.env.PAYHERO_API_USERNAME || "";
  const password = process.env.PAYHERO_API_PASSWORD || "";
  const accountId = Number(process.env.PAYHERO_ACCOUNT_ID || "");
  const channelId = Number(process.env.PAYHERO_CHANNEL_ID || "");
  const callbackUrl = process.env.PAYHERO_CALLBACK_URL || "";
  if (!username || !password || !Number.isInteger(accountId) || accountId <= 0 || !Number.isInteger(channelId) || channelId <= 0 || !callbackUrl) {
    throw new Error("PayHero server configuration is incomplete");
  }
  return { username, password, accountId, channelId, callbackUrl };
}

function authHeader(username: string, password: string) {
  return "Basic " + Buffer.from(username + ":" + password).toString("base64");
}

export function payHeroHeaders() {
  const c = payHeroConfig();
  return { Authorization: authHeader(c.username, c.password), "Content-Type": "application/json" };
}

export async function payHeroCollection(input: {
  amount: number;
  phoneNumber: string;
  externalReference: string;
}) {
  const c = payHeroConfig();
  const phone = normalizeKenyanPhone(input.phoneNumber);
  const response = await fetch(BASE_URL + "/api/v2/payments", {
    method: "POST",
    headers: payHeroHeaders(),
    body: JSON.stringify({
      amount: input.amount,
      phone_number: phone,
      provider: "m-pesa",
      channel_id: c.channelId,
      account_id: c.accountId,
      external_reference: input.externalReference,
      callback_url: c.callbackUrl,
    }),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || body?.success === false) {
    throw Object.assign(new Error(body?.error_message || body?.message || "PayHero collection failed"), { status: 502 });
  }
  return body;
}

export async function payHeroTransactionStatus(requestId: string) {
  const c = payHeroConfig();
  const response = await fetch(BASE_URL + "/api/global/transaction-status", {
    method: "POST",
    headers: payHeroHeaders(),
    body: JSON.stringify({ request_id: requestId }),
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body?.error_message || "PayHero status lookup failed"), { status: 502 });
  }
  return body;
}

export function normalizePayHeroStatus(body: any): "pending" | "confirmed" | "failed" {
  const value = String(body?.status || body?.transaction_status || body?.data?.status || "").toLowerCase();
  if (["success", "successful", "completed", "complete", "paid", "confirmed"].includes(value)) return "confirmed";
  if (["failed", "failure", "cancelled", "canceled", "reversed", "declined"].includes(value)) return "failed";
  return "pending";
}
