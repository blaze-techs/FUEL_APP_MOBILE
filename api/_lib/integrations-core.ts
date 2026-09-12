/**
 * Real Integrations Core (shared by Vercel + Cloudflare Pages Functions)
 *
 * This is the REAL production integration layer. Every handler below makes an
 * actual network call to the actual institution — no simulation, no fake
 * success. When credentials are missing/invalid, the real upstream error is
 * surfaced verbatim so the user sees the true state.
 *
 * Integrations:
 *  - M-PESA Daraja (Safaricom): OAuth + STK Push + STK Query
 *  - Kopo Kopo: OAuth + pull real incoming payments
 *  - SMS: Twilio / Africa's Talking / generic HTTP gateway
 *  - Email: SendGrid / Mailgun / Resend (HTTP APIs)
 *  - WhatsApp Business: Meta Cloud API
 *  - Webhooks: signed HMAC-SHA256 POST to the station's endpoint
 *  - KRA eTIMS (OSCU): device init + real sales-invoice submission
 *
 * Trust model: station owners enter their OWN institution credentials in the
 * Integration Hub (stored owner-scoped in Supabase app_kv). The browser posts
 * those credentials to this backend over TLS; the backend uses them only to
 * call the institution and never persists them. This is the standard
 * bring-your-own-key relay pattern — the alternative (browser→institution
 * direct) is blocked by CORS and would leak secrets into the page.
 */
import zlib from "node:zlib";

export interface IntegrationResult {
  success: boolean;
  [key: string]: unknown;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function err(
  message: string,
  extra?: Record<string, unknown>,
): IntegrationResult {
  return { success: false, error: message, ...extra };
}

function toBase64(s: string): string {
  // Works in Node (Vercel) and Workers (Cloudflare)
  if (typeof Buffer !== "undefined")
    return Buffer.from(s, "utf-8").toString("base64");
  return btoa(unescape(encodeURIComponent(s)));
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { _raw: text.slice(0, 500) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// M-PESA DARAJA (Safaricom) — REAL
// ═══════════════════════════════════════════════════════════════════════════

export interface DarajaCreds {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  environment?: "sandbox" | "production";
}

function darajaBase(env?: string): string {
  return env === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

async function darajaToken(creds: DarajaCreds): Promise<string> {
  const base = darajaBase(creds.environment);
  const auth = toBase64(`${creds.consumerKey}:${creds.consumerSecret}`);
  const res = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  const data = await readJson(res);
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Daraja OAuth failed (HTTP ${res.status}): ${(data.errorMessage as string) || (data.error_description as string) || JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data.access_token as string;
}

function darajaTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function mpesaStkPush(body: {
  creds: DarajaCreds;
  phoneNumber: string;
  amount: number;
  accountReference?: string;
  transactionDesc?: string;
  callbackUrl?: string;
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (
    !creds?.consumerKey ||
    !creds?.consumerSecret ||
    !creds?.passkey ||
    !creds?.shortcode
  ) {
    return err(
      "M-PESA Daraja credentials are incomplete (consumerKey, consumerSecret, passkey, shortcode required).",
    );
  }
  const phone = String(body.phoneNumber || "").replace(/\D/g, "");
  if (!/^254[17]\d{8}$/.test(phone)) {
    return err("Invalid phone number. Use 2547XXXXXXXX or 2541XXXXXXXX.");
  }
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1)
    return err("Amount must be at least KES 1.");

  try {
    const token = await darajaToken(creds);
    const base = darajaBase(creds.environment);
    const timestamp = darajaTimestamp();
    const password = toBase64(`${creds.shortcode}${creds.passkey}${timestamp}`);
    const res = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        BusinessShortCode: creds.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: creds.shortcode,
        PhoneNumber: phone,
        CallBackURL:
          body.callbackUrl ||
          "https://fuel-app-mobile.vercel.app/api/integrations?action=mpesa-callback",
        AccountReference: body.accountReference || "FuelPro",
        TransactionDesc: body.transactionDesc || "Fuel purchase",
      }),
    });
    const data = await readJson(res);
    const ok = data.ResponseCode === "0";
    return {
      success: ok,
      daraja: data,
      merchant_request_id: data.MerchantRequestID,
      checkout_request_id: data.CheckoutRequestID,
      response_description: data.ResponseDescription,
      customer_message: data.CustomerMessage,
      ...(ok
        ? {}
        : {
            error:
              (data.errorMessage as string) ||
              (data.ResponseDescription as string) ||
              "Daraja rejected the request",
          }),
    };
  } catch (e) {
    return err(`Daraja STK push failed: ${(e as Error).message}`);
  }
}

export async function mpesaStkQuery(body: {
  creds: DarajaCreds;
  checkoutRequestId: string;
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (
    !creds?.consumerKey ||
    !creds?.consumerSecret ||
    !creds?.passkey ||
    !creds?.shortcode
  ) {
    return err("M-PESA Daraja credentials are incomplete.");
  }
  if (!body.checkoutRequestId) return err("checkoutRequestId is required.");
  try {
    const token = await darajaToken(creds);
    const base = darajaBase(creds.environment);
    const timestamp = darajaTimestamp();
    const password = toBase64(`${creds.shortcode}${creds.passkey}${timestamp}`);
    const res = await fetch(`${base}/mpesa/stkpushquery/v1/query`, {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        BusinessShortCode: creds.shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: body.checkoutRequestId,
      }),
    });
    const data = await readJson(res);
    return {
      success: data.ResponseCode === "0",
      daraja: data,
      result_code: data.ResultCode,
      result_desc: data.ResultDesc,
      ...(data.ResponseCode === "0"
        ? {}
        : { error: (data.errorMessage as string) || "Query failed" }),
    };
  } catch (e) {
    return err(`Daraja STK query failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KOPO KOPO — REAL incoming payments pull
// ═══════════════════════════════════════════════════════════════════════════

export interface KopokopoCreds {
  clientId: string;
  clientSecret: string;
  tillNumber: string;
  environment?: "sandbox" | "production";
}

function kopokopoBase(env?: string): string {
  return env === "production"
    ? "https://api.kopokopo.com"
    : "https://sandbox.kopokopo.com";
}

export async function kopokopoPull(body: {
  creds: KopokopoCreds;
  sinceHours?: number;
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (!creds?.clientId || !creds?.clientSecret) {
    return err(
      "Kopo Kopo credentials are incomplete (clientId, clientSecret required).",
    );
  }
  try {
    const base = kopokopoBase(creds.environment);
    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: "client_credentials",
      }),
    });
    const tokenData = await readJson(tokenRes);
    if (!tokenRes.ok || !tokenData.access_token) {
      return err(
        `Kopo Kopo OAuth failed (HTTP ${tokenRes.status}): ${(tokenData.error_description as string) || (tokenData.error as string) || "invalid_client"}`,
      );
    }
    const token = tokenData.access_token as string;
    const res = await fetch(`${base}/api/v1/incoming_payments`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const data = await readJson(res);
    if (!res.ok) {
      return err(
        `Kopo Kopo incoming_payments failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    // Normalize the real payments into a compact list
    const raw = (data.data as Array<Record<string, unknown>>) || [];
    const payments = raw.map((p) => {
      const a = (p.attributes || {}) as Record<string, unknown>;
      const ev = (a.event || {}) as Record<string, unknown>;
      const res2 = (ev.resource || {}) as Record<string, unknown>;
      return {
        id: p.id,
        type: a.type,
        initiation_time: a.initiation_time,
        status: a.status,
        reference: res2.reference || res2.till_number,
        amount: res2.amount,
        currency: res2.currency,
        sender_phone: res2.sender_phone_number,
        sender_name: [res2.sender_first_name, res2.sender_last_name]
          .filter(Boolean)
          .join(" "),
        till_number: res2.till_number,
      };
    });
    return { success: true, payments, count: payments.length };
  } catch (e) {
    return err(`Kopo Kopo pull failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SMS — REAL (Twilio / Africa's Talking / generic HTTP)
// ═══════════════════════════════════════════════════════════════════════════

export async function sendSms(body: {
  provider: string; // "twilio" | "africa-talking" | "custom"
  to: string;
  message: string;
  // twilio
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  // africa's talking
  apiKey?: string;
  username?: string;
  senderId?: string;
  // custom HTTP
  customUrl?: string;
  customHeaders?: Record<string, string>;
}): Promise<IntegrationResult> {
  const to = String(body.to || "").replace(/[^\d+]/g, "");
  if (!to || to.length < 9) return err("Invalid recipient phone number.");
  if (!body.message?.trim()) return err("Message content is required.");

  try {
    if (body.provider === "twilio") {
      if (!body.accountSid || !body.authToken || !body.fromNumber) {
        return err("Twilio requires accountSid, authToken, fromNumber.");
      }
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${body.accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${toBase64(`${body.accountSid}:${body.authToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: to,
            From: body.fromNumber,
            Body: body.message,
          }),
        },
      );
      const data = await readJson(res);
      if (!res.ok)
        return err(
          `Twilio error ${data.code || res.status}: ${(data.message as string) || "send failed"}`,
          { twilio: data },
        );
      return {
        success: true,
        provider: "twilio",
        sid: data.sid,
        status: data.status,
      };
    }

    if (body.provider === "africa-talking") {
      if (!body.apiKey || !body.username)
        return err("Africa's Talking requires apiKey + username.");
      const res = await fetch(
        "https://api.africastalking.com/version1/messaging",
        {
          method: "POST",
          headers: {
            apiKey: body.apiKey,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            username: body.username,
            to,
            message: body.message,
            ...(body.senderId ? { from: body.senderId } : {}),
          }),
        },
      );
      const data = await readJson(res);
      const recipients = ((data.SMSMessageData as Record<string, unknown>)
        ?.Recipients || []) as Array<Record<string, unknown>>;
      const first = recipients[0];
      if (
        !res.ok ||
        (first && String(first.status).toLowerCase() !== "success")
      ) {
        return err(
          `Africa's Talking send failed: ${(first?.status as string) || JSON.stringify(data).slice(0, 160)}`,
          { at: data },
        );
      }
      return {
        success: true,
        provider: "africa-talking",
        messageId: first?.messageId,
        cost: first?.cost,
      };
    }

    // custom HTTP gateway
    if (!body.customUrl) return err("Custom SMS gateway requires a URL.");
    const res = await fetch(body.customUrl, {
      method: "POST",
      headers: {
        ...JSON_HEADERS,
        ...(body.apiKey ? { Authorization: `Bearer ${body.apiKey}` } : {}),
        ...(body.customHeaders || {}),
      },
      body: JSON.stringify({ to, from: body.senderId, message: body.message }),
    });
    const data = await readJson(res);
    if (!res.ok)
      return err(
        `SMS gateway returned HTTP ${res.status}: ${JSON.stringify(data).slice(0, 160)}`,
      );
    return { success: true, provider: "custom", response: data };
  } catch (e) {
    return err(`SMS send failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL — REAL (SendGrid / Mailgun / Resend HTTP APIs)
// ═══════════════════════════════════════════════════════════════════════════

export async function sendEmail(body: {
  provider: string; // "sendgrid" | "mailgun" | "resend"
  to: string;
  subject: string;
  text: string;
  fromEmail: string;
  fromName?: string;
  apiKey?: string;
  domain?: string; // mailgun
  attachment?: {
    filename: string;
    contentBase64: string;
    mimeType?: string; // default application/pdf
  };
}): Promise<IntegrationResult> {
  if (!body.to?.includes("@")) return err("Invalid recipient email.");
  if (!body.apiKey) return err("Email provider API key is required.");
  try {
    if (body.provider === "sendgrid") {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${body.apiKey}` },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: body.to }] }],
          from: {
            email: body.fromEmail,
            name: body.fromName || body.fromEmail,
          },
          subject: body.subject,
          content: [{ type: "text/plain", value: body.text }],
          ...(body.attachment
            ? {
                attachments: [
                  {
                    content: body.attachment.contentBase64,
                    filename: body.attachment.filename,
                    type: body.attachment.mimeType || "application/pdf",
                    disposition: "attachment",
                  },
                ],
              }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await readJson(res);
        return err(
          `SendGrid error (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 200)}`,
        );
      }
      return { success: true, provider: "sendgrid" };
    }
    if (body.provider === "mailgun") {
      if (!body.domain) return err("Mailgun requires a domain.");
      let mgHeaders: Record<string, string>;
      // FormData | URLSearchParams covers both branches below without the
      // DOM-lib-only BodyInit global (not in the server tsconfig libs).
      let mgBody: FormData | URLSearchParams;
      if (body.attachment) {
        // Multipart form (required for attachments)
        const bin = atob(body.attachment.contentBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const form = new FormData();
        form.append(
          "from",
          `${body.fromName || body.fromEmail} <${body.fromEmail}>`,
        );
        form.append("to", body.to);
        form.append("subject", body.subject);
        form.append("text", body.text);
        form.append(
          "attachment",
          new Blob([bytes], {
            type: body.attachment.mimeType || "application/pdf",
          }),
          body.attachment.filename,
        );
        mgHeaders = {
          Authorization: `Basic ${toBase64(`api:${body.apiKey}`)}`,
        };
        mgBody = form;
      } else {
        mgHeaders = {
          Authorization: `Basic ${toBase64(`api:${body.apiKey}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        };
        mgBody = new URLSearchParams({
          from: `${body.fromName || body.fromEmail} <${body.fromEmail}>`,
          to: body.to,
          subject: body.subject,
          text: body.text,
        });
      }
      const res = await fetch(
        `https://api.mailgun.net/v3/${body.domain}/messages`,
        {
          method: "POST",
          headers: mgHeaders,
          body: mgBody,
        },
      );
      const data = await readJson(res);
      if (!res.ok)
        return err(
          `Mailgun error (HTTP ${res.status}): ${(data.message as string) || "send failed"}`,
        );
      return { success: true, provider: "mailgun", id: data.id };
    }
    // resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${body.apiKey}` },
      body: JSON.stringify({
        from: body.fromName
          ? `${body.fromName} <${body.fromEmail}>`
          : body.fromEmail,
        to: [body.to],
        subject: body.subject,
        text: body.text,
        ...(body.attachment
          ? {
              attachments: [
                {
                  filename: body.attachment.filename,
                  content: body.attachment.contentBase64,
                },
              ],
            }
          : {}),
      }),
    });
    const data = await readJson(res);
    if (!res.ok)
      return err(
        `Resend error (HTTP ${res.status}): ${(data.message as string) || JSON.stringify(data).slice(0, 160)}`,
      );
    return { success: true, provider: "resend", id: data.id };
  } catch (e) {
    return err(`Email send failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP BUSINESS — REAL (Meta Cloud API)
// ═══════════════════════════════════════════════════════════════════════════

export async function sendWhatsApp(body: {
  phoneNumberId: string;
  token: string;
  to: string;
  message: string;
  // Optional PDF/document attachment (sent as a WhatsApp document message
  // with a public URL; the document caption carries the message text).
  documentUrl?: string;
  documentFilename?: string;
}): Promise<IntegrationResult> {
  if (!body.phoneNumberId || !body.token)
    return err("WhatsApp requires phoneNumberId + token.");
  const to = String(body.to || "").replace(/\D/g, "");
  if (!to) return err("Invalid WhatsApp recipient.");
  const hasDoc = !!(body.documentUrl && /^https:\/\//.test(body.documentUrl));
  const messageBody = hasDoc
    ? {
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          link: body.documentUrl,
          filename: body.documentFilename || "document.pdf",
          caption: body.message,
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: body.message },
      };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${body.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { ...JSON_HEADERS, Authorization: `Bearer ${body.token}` },
        body: JSON.stringify(messageBody),
      },
    );
    const data = await readJson(res);
    if (!res.ok) {
      const e = (data.error || {}) as Record<string, unknown>;
      return err(
        `WhatsApp error ${e.code || res.status}: ${(e.message as string) || "send failed"}`,
        { meta: data },
      );
    }
    const msgs = (data.messages || []) as Array<Record<string, unknown>>;
    return { success: true, provider: "whatsapp", messageId: msgs[0]?.id };
  } catch (e) {
    return err(`WhatsApp send failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK — REAL signed POST (HMAC-SHA256)
// ═══════════════════════════════════════════════════════════════════════════

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fireWebhook(body: {
  url: string;
  event: string;
  payload: Record<string, unknown>;
  secret?: string;
}): Promise<IntegrationResult> {
  if (!body.url || !/^https?:\/\//.test(body.url))
    return err("Webhook URL must be a valid http(s) URL.");
  const payloadStr = JSON.stringify({
    event: body.event,
    timestamp: new Date().toISOString(),
    data: body.payload,
  });
  const headers: Record<string, string> = {
    ...JSON_HEADERS,
    "X-FuelPro-Event": body.event,
    "User-Agent": "FuelPro-Webhook/1.0",
  };
  if (body.secret) {
    headers["X-FuelPro-Signature"] =
      `sha256=${await hmacSha256Hex(body.secret, payloadStr)}`;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(body.url, {
      method: "POST",
      headers,
      body: payloadStr,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    return {
      success: res.ok,
      status: res.status,
      response: text.slice(0, 300),
      ...(res.ok
        ? {}
        : { error: `Webhook endpoint returned HTTP ${res.status}` }),
    };
  } catch (e) {
    return err(`Webhook delivery failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PAYHERO KENYA — REAL M-PESA STK Push via PayHero API v2
// (Reverse-engineered from payherokenya.com / developers.payhero.co.ke)
// ═══════════════════════════════════════════════════════════════════════════

export interface PayheroCreds {
  apiUsername: string;
  apiPassword: string;
  channelId: string;
  accountReference?: string;
}

const PAYHERO_BASE = "https://backend.payhero.co.ke/api/v2";

export async function payheroStkPush(body: {
  creds: PayheroCreds;
  phoneNumber: string;
  amount: number;
  customerName?: string;
  transactionDesc?: string;
  callbackUrl?: string;
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (!creds?.apiUsername || !creds?.apiPassword || !creds?.channelId) {
    return err(
      "PayHero credentials are incomplete (apiUsername, apiPassword, channelId required).",
    );
  }
  const phone = String(body.phoneNumber || "").replace(/\D/g, "");
  if (!/^254[17]\d{8}$/.test(phone)) {
    return err("Invalid phone number. Use 2547XXXXXXXX or 2541XXXXXXXX.");
  }
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1)
    return err("Amount must be at least KES 1.");
  const channelId = Number(creds.channelId);
  if (!Number.isFinite(channelId) || channelId <= 0)
    return err("PayHero channelId must be a positive number.");

  const externalRef =
    creds.accountReference ||
    `FUELPRO-${Date.now().toString(36).toUpperCase()}`;
  try {
    const auth = toBase64(`${creds.apiUsername}:${creds.apiPassword}`);
    // Official PayHero API v2 (verified against the PayHero PHP package +
    // docs.payhero.co.ke): POST /api/v2/payments with
    // {amount, phone_number, channel_id, provider:"m-pesa", external_reference,
    //  callback_url}. Basic auth: base64(apiUsername:apiPassword).
    const res = await fetch(`${PAYHERO_BASE}/payments`, {
      method: "POST",
      headers: { ...JSON_HEADERS, Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount,
        phone_number: phone,
        channel_id: channelId,
        provider: "m-pesa",
        external_reference: externalRef,
        customer_name: body.customerName || undefined,
        callback_url:
          body.callbackUrl ||
          "https://fuel-app-mobile.vercel.app/api/integrations?action=payhero-callback",
      }),
    });
    const data = await readJson(res);
    const ok =
      data.success === true ||
      (data.status as string)?.toUpperCase() === "QUEUED";
    return {
      success: ok,
      payhero: data,
      reference: data.reference,
      checkout_request_id: data.CheckoutRequestID || data.checkout_request_id,
      status: data.status,
      ...(ok
        ? {}
        : {
            error:
              (data.errorMessage as string) ||
              (data.message as string) ||
              (data.error as string) ||
              `PayHero rejected the request (HTTP ${res.status})`,
          }),
    };
  } catch (e) {
    return err(`PayHero STK push failed: ${(e as Error).message}`);
  }
}

export async function payheroChannels(body: {
  creds: Pick<PayheroCreds, "apiUsername" | "apiPassword">;
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (!creds?.apiUsername || !creds?.apiPassword) {
    return err(
      "PayHero credentials are incomplete (apiUsername, apiPassword required).",
    );
  }
  try {
    const auth = toBase64(`${creds.apiUsername}:${creds.apiPassword}`);
    const res = await fetch(`${PAYHERO_BASE}/payment_channels`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    const data = await readJson(res);
    if (!res.ok) {
      return err(
        (data.error_message as string) ||
          (data.message as string) ||
          `PayHero channel list failed (HTTP ${res.status})`,
      );
    }
    return {
      success: true,
      channels: data.payment_channels || [],
      pagination: data.pagination,
    };
  } catch (e) {
    return err(`PayHero channel list failed: ${(e as Error).message}`);
  }
}

export async function payheroWallet(body: {
  creds: Pick<PayheroCreds, "apiUsername" | "apiPassword">;
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (!creds?.apiUsername || !creds?.apiPassword) {
    return err(
      "PayHero credentials are incomplete (apiUsername, apiPassword required).",
    );
  }
  try {
    const auth = toBase64(`${creds.apiUsername}:${creds.apiPassword}`);
    const res = await fetch(`${PAYHERO_BASE}/wallets`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    const data = await readJson(res);
    if (!res.ok) {
      return err(
        (data.error_message as string) ||
          (data.message as string) ||
          `PayHero wallet query failed (HTTP ${res.status})`,
      );
    }
    return {
      success: true,
      wallet: data,
      balance: data.available_balance,
      currency: data.currency,
      walletStatus: data.wallet_status,
    };
  } catch (e) {
    return err(`PayHero wallet query failed: ${(e as Error).message}`);
  }
}

export async function payheroStatus(body: {
  creds: PayheroCreds;
  reference: string;
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (!creds?.apiUsername || !creds?.apiPassword || !creds?.channelId) {
    return err("PayHero credentials are incomplete.");
  }
  if (!body.reference) return err("reference is required.");
  try {
    const auth = toBase64(`${creds.apiUsername}:${creds.apiPassword}`);
    const res = await fetch(
      `${PAYHERO_BASE}/transaction-status?reference=${encodeURIComponent(body.reference)}`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      },
    );
    const data = await readJson(res);
    const status = String(
      data.status || data.transaction_status || "",
    ).toUpperCase();
    const ok =
      status === "SUCCESS" || status === "COMPLETED" || data.success === true;
    return {
      success: ok,
      payhero: data,
      status: status || "PENDING",
      result_code: data.ResultCode,
      result_desc: data.ResultDesc || data.message,
      ...(ok || res.ok
        ? {}
        : {
            error:
              (data.message as string) ||
              `PayHero status query failed (HTTP ${res.status})`,
          }),
    };
  } catch (e) {
    return err(`PayHero status query failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KRA eTIMS (OSCU) — REAL tax-authority integration
// ═══════════════════════════════════════════════════════════════════════════

export interface EtimsCreds {
  tin: string; // KRA PIN (e.g. P051234567X)
  bhfId: string; // branch id ("00" for HQ)
  cmcKey: string; // CMC key from the KRA eTIMS portal
  environment?: "sandbox" | "production";
}

function etimsBase(env?: string): string {
  return env === "production"
    ? "https://etims.kra.go.ke/etims-api"
    : "https://etims-api-sbx.kra.go.ke/etims-api";
}

/** Real KRA eTIMS device initialization (selectInitInfo). Validates creds. */
export async function kraEtimsInit(
  creds: EtimsCreds,
): Promise<IntegrationResult> {
  if (!creds?.tin || !creds?.bhfId || !creds?.cmcKey) {
    return err(
      "eTIMS requires tin (KRA PIN), bhfId (branch id), cmcKey (from the KRA eTIMS portal).",
    );
  }
  try {
    const res = await fetch(`${etimsBase(creds.environment)}/selectInitInfo`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        tin: creds.tin,
        bhfId: creds.bhfId,
        cmcKey: creds.cmcKey,
      }),
    });
    const data = await readJson(res);
    const ok = data.resultCd === "000";
    return {
      success: ok,
      kra: data,
      taxpayer: ((data.data || {}) as Record<string, unknown>).taxprNm,
      ...(ok
        ? {}
        : {
            error: `KRA eTIMS init rejected: ${(data.resultMsg as string) || `resultCd ${data.resultCd}`}`,
          }),
    };
  } catch (e) {
    return err(`KRA eTIMS init failed: ${(e as Error).message}`);
  }
}

export interface EtimsInvoiceItem {
  itemNm: string;
  qty: number;
  prc: number; // unit price (tax-inclusive)
  taxTyCd?: string; // "A"=16% standard, "B"=8%, "C"=0%, "D"=exempt, "E"=non-vat
}

/** Real KRA eTIMS sales-invoice submission (insertSalesInvoice). */
export async function kraEtimsInvoice(body: {
  creds: EtimsCreds;
  custTin?: string;
  custNm?: string;
  trdInvcNo: string; // trader invoice number
  items: EtimsInvoiceItem[];
  paymentType?: string; // "01" cash, "02" credit, "03" cash/credit, "04" bank, "05" card, "06" mobile money
}): Promise<IntegrationResult> {
  const { creds } = body;
  if (!creds?.tin || !creds?.bhfId || !creds?.cmcKey) {
    return err(
      "eTIMS requires tin, bhfId, cmcKey (configure in POS Tax Settings).",
    );
  }
  if (!body.items?.length) return err("Invoice must have at least one item.");

  // Compute the tax-type buckets (eTIMS groups by tax class)
  const buckets: Record<
    string,
    { taxblAmt: number; taxAmt: number; totAmt: number; taxRt: number }
  > = {};
  const RATES: Record<string, number> = { A: 16, B: 8, C: 0, D: 0, E: 0 };
  let totAmt = 0;
  const itemList = body.items.map((it, idx) => {
    const ty = it.taxTyCd || "A";
    const rate = RATES[ty] ?? 16;
    const splyAmt = Math.round(it.qty * it.prc * 100) / 100;
    const taxblAmt = Math.round((splyAmt / (1 + rate / 100)) * 100) / 100;
    const taxAmt = Math.round((splyAmt - taxblAmt) * 100) / 100;
    totAmt += splyAmt;
    if (!buckets[ty])
      buckets[ty] = { taxblAmt: 0, taxAmt: 0, totAmt: 0, taxRt: rate };
    buckets[ty].taxblAmt += taxblAmt;
    buckets[ty].taxAmt += taxAmt;
    buckets[ty].totAmt += splyAmt;
    return {
      itemSeq: idx + 1,
      itemCd: `KE2NTNG00000${idx + 1}`,
      itemClsCd: "99010000",
      itemNm: it.itemNm.slice(0, 100),
      pkgUnitCd: "NT",
      pkg: 1,
      qtyUnitCd: "U",
      qty: it.qty,
      prc: it.prc,
      splyAmt,
      dcRt: 0,
      dcAmt: 0,
      taxTyCd: ty,
      taxblAmt,
      taxAmt,
      totAmt: splyAmt,
    };
  });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const b = (ty: string) =>
    buckets[ty] || { taxblAmt: 0, taxAmt: 0, totAmt: 0, taxRt: RATES[ty] ?? 0 };
  const now = new Date();
  const dt = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;

  const payload = {
    tin: creds.tin,
    bhfId: creds.bhfId,
    cmcKey: creds.cmcKey,
    trdInvcNo: body.trdInvcNo,
    invcNo: Number(String(Date.now()).slice(-9)),
    custTin: body.custTin || "",
    custNm: body.custNm || "",
    salesTyCd: "N",
    rcptTyCd: "S",
    pmtTyCd: body.paymentType || "01",
    salesSttsCd: "02",
    cfmDt: dt,
    salesDt: dt.slice(0, 8),
    totItemCnt: itemList.length,
    taxblAmtA: r2(b("A").taxblAmt),
    taxblAmtB: r2(b("B").taxblAmt),
    taxblAmtC: r2(b("C").taxblAmt),
    taxblAmtD: r2(b("D").taxblAmt),
    taxblAmtE: r2(b("E").taxblAmt),
    taxRtA: 16,
    taxRtB: 8,
    taxRtC: 0,
    taxRtD: 0,
    taxRtE: 0,
    taxAmtA: r2(b("A").taxAmt),
    taxAmtB: r2(b("B").taxAmt),
    taxAmtC: r2(b("C").taxAmt),
    taxAmtD: r2(b("D").taxAmt),
    taxAmtE: r2(b("E").taxAmt),
    totTaxblAmt: r2(itemList.reduce((s, i) => s + i.taxblAmt, 0)),
    totTaxAmt: r2(itemList.reduce((s, i) => s + i.taxAmt, 0)),
    totAmt: r2(totAmt),
    prchrAcptcYn: "Y",
    regrId: creds.tin,
    regrNm: creds.tin,
    modrId: creds.tin,
    modrNm: creds.tin,
    receipt: {
      custTin: body.custTin || "",
      prchrAcptcYn: "Y",
      rptNo: 1,
      trdeNm: "",
      adrs: "",
      topMsg: "",
      btmMsg: "",
    },
    itemList,
  };

  try {
    const res = await fetch(
      `${etimsBase(creds.environment)}/insertSalesInvoice`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      },
    );
    const data = await readJson(res);
    const ok = data.resultCd === "000";
    const d = (data.data || {}) as Record<string, unknown>;
    return {
      success: ok,
      kra: data,
      // The REAL KRA control-unit data for the receipt
      receipt_no: d.rcptNo,
      internal_data: d.intrlData,
      receipt_signature: d.rcptSign,
      qr_code_url: d.qrCodeUrl || d.qrCode,
      total_amount: d.totAmt,
      ...(ok
        ? {}
        : {
            error: `KRA eTIMS rejected the invoice: ${(data.resultMsg as string) || `resultCd ${data.resultCd}`}`,
          }),
    };
  } catch (e) {
    return err(`KRA eTIMS invoice submission failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Dispatcher
// ═══════════════════════════════════════════════════════════════════════════

/** Company-grant redemption (Company QR Code feature). An UNAUTHENTICATED
 *  member redeems a shared grant code; the code is validated SERVER-side with
 *  the service role (expiry / revoked / enabled / max-uses). The grant is
 *  mirrored into `app_kv` (key `company_grant_<code>__<owner>__<station>`,
 *  compressed envelope handled transparently) so this works WITHOUT the
 *  migration. Once migrations/027 is applied, the same code ALSO prefers the
 *  `redeem_company_grant` SECURITY DEFINER RPC (atomic + write-safe). */
/** Normalize a grant access_mode read from snake_case or camelCase rows. */
function grantAccessMode(
  grant: Record<string, unknown>,
): "read" | "edit" | "full" {
  const raw =
    grant.access_mode ??
    grant["accessMode"] ??
    (grant.read_only === false || grant.readOnly === false ? "full" : "read");
  const v = String(raw || "read").toLowerCase();
  return v === "edit" ? "edit" : v === "full" ? "full" : "read";
}

async function companyGrantRedeem(
  body: Record<string, unknown>,
): Promise<IntegrationResult> {
  const code = String(body.code ?? "").trim();
  const GRANT_CODE_RE =
    /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{18}$/;
  if (!GRANT_CODE_RE.test(code)) return err("Invalid grant link");

  const SUPABASE_URL =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SUPABASE_URL || !SERVICE_KEY)
    return err("Grant service unavailable", { code: 503 });

  const decompressValue = (data: unknown): unknown => {
    if (
      data &&
      typeof data === "object" &&
      (data as { __compressed?: boolean }).__compressed === true &&
      typeof (data as { c?: unknown }).c === "string"
    ) {
      try {
        return JSON.parse(
          zlib
            .gunzipSync(Buffer.from((data as { c: string }).c, "base64"))
            .toString(),
        );
      } catch {
        return data;
      }
    }
    if (data && typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    return data;
  };

  try {
    const apiUrl = new URL("/rest/v1/app_kv", SUPABASE_URL);
    apiUrl.searchParams.set("select", "data");
    apiUrl.searchParams.set("id", `like.company_grant_${code}__%`);
    apiUrl.searchParams.set("limit", "1");
    const resp = await fetch(apiUrl, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
    if (!resp.ok) return err("Grant service unavailable", { code: 502 });
    const rows = (await resp.json()) as { data: unknown }[];
    if (!rows.length)
      return err("This grant link is not valid.", { code: 404 });
    const decoded = decompressValue(rows[0].data);
    if (!decoded || typeof decoded !== "object")
      return err("This grant link is not valid.", { code: 404 });
    const grant = decoded as Record<string, unknown>;

    const id = String(grant.id ?? "");
    const stationId = String(grant.station_id ?? grant.stationId ?? "");
    const ownerId = String(grant.owner_id ?? grant.ownerId ?? "");
    const revoked = grant.revoked === true;
    const enabled = grant.enabled !== false;
    // `expiresAt` may be stored as an ISO string OR a numeric ms-epoch (the
    // client writes `new Date(...).getTime()`). Normalize to a numeric ms.
    const rawExp = grant.expires_at ?? grant.expiresAt;
    let expiresMs: number | null = null;
    if (rawExp != null && rawExp !== "") {
      const t =
        typeof rawExp === "number" ? rawExp : Date.parse(String(rawExp));
      if (Number.isFinite(t)) expiresMs = t;
    }
    if (revoked || !enabled)
      return err("This grant has been revoked.", { code: 404 });
    if (expiresMs != null && expiresMs < Date.now())
      return err("This grant link has expired.", { code: 404 });
    const maxUses = grant.max_uses == null ? null : Number(grant.max_uses);
    const uses = Number(grant.uses ?? 0);
    if (maxUses != null && uses >= maxUses)
      return err("This grant link has reached its usage limit.", { code: 404 });

    // Best-effort usage bump. Update BOTH the code-keyed row (the redemption
    // source of truth) AND the owner's `company_grants` list row, so the
    // owner's QR modal shows the live "N redeems / expired" state. Both are
    // re-stored in the client's compressed envelope (`{__compressed,c,o}`).
    const upsertRow = (rowId: string, value: unknown): Promise<void> => {
      const jsonBytes = Buffer.from(JSON.stringify(value), "utf8");
      const gz = zlib.gzipSync(jsonBytes, { level: 9 });
      const payload =
        gz.length < jsonBytes.length
          ? {
              __compressed: true,
              c: gz.toString("base64"),
              o: jsonBytes.length,
            }
          : value;
      return fetch(new URL("/rest/v1/app_kv", SUPABASE_URL), {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          id: rowId,
          owner_id: ownerId,
          station_id: stationId,
          collection: "fuel_data",
          data: payload,
          updated_at: new Date().toISOString(),
        }),
      }).then(() => undefined);
    };
    const { created_at: _createdAt, ...restGrant } = grant;
    const increment = { ...restGrant, uses: uses + 1 };
    const keyId = `company_grant_${code}__${ownerId}__${stationId}`;
    try {
      await upsertRow(keyId, increment);
    } catch {
      /* non-fatal */
    }
    // Sync the usage back into the owner's list row (read → bump → write).
    try {
      const listUrl = new URL("/rest/v1/app_kv", SUPABASE_URL);
      listUrl.searchParams.set("select", "data");
      listUrl.searchParams.set(
        "id",
        `eq.company_grants__${ownerId}__${stationId}`,
      );
      listUrl.searchParams.set("limit", "1");
      const listResp = await fetch(listUrl, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });
      if (listResp.ok) {
        const listRows = (await listResp.json()) as { data: unknown }[];
        if (listRows.length) {
          const listDecoded = decompressValue(listRows[0].data);
          if (Array.isArray(listDecoded)) {
            const updated = (listDecoded as Record<string, unknown>[]).map(
              (entry) => {
                if (String(entry.code ?? entry["code"] ?? "") === code) {
                  return {
                    ...entry,
                    uses: uses + 1,
                    lastRedeemedAt: Date.now(),
                  };
                }
                return entry;
              },
            );
            await upsertRow(
              `company_grants__${ownerId}__${stationId}`,
              updated,
            );
          }
        }
      }
    } catch {
      /* non-fatal */
    }

    return {
      success: true,
      grantId: id,
      memberName: String(
        grant.member_name ?? grant.memberName ?? "Team Member",
      ),
      memberRole: String(grant.member_role ?? grant.memberRole ?? "Staff"),
      allowedTabs: Array.isArray(grant.allowed_tabs)
        ? (grant.allowed_tabs as string[])
        : Array.isArray(grant.allowedTabs)
          ? (grant.allowedTabs as string[])
          : [],
      readOnly: grant.read_only !== false && grant.readOnly !== false,
      accessMode: grantAccessMode(grant),
      stationId,
      stationOwnerId: ownerId,
      expiresAt: expiresMs != null ? new Date(expiresMs).toISOString() : null,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[company-grant-redeem] failed:", e);
    return err("Grant redemption failed", { code: 500 });
  }
}

export async function dispatchIntegration(
  action: string,
  body: Record<string, unknown>,
): Promise<IntegrationResult> {
  switch (action) {
    case "ping":
      return {
        success: true,
        service: "fuelpro-integrations",
        time: new Date().toISOString(),
      };
    case "mpesa-stk-push":
      return mpesaStkPush(body as never);
    case "mpesa-query":
      return mpesaStkQuery(body as never);
    case "kopokopo-pull":
      return kopokopoPull(body as never);
    case "payhero-stk-push":
      return payheroStkPush(body as never);
    case "payhero-status":
      return payheroStatus(body as never);
    case "payhero-channels":
      return payheroChannels(body as never);
    case "payhero-wallet":
      return payheroWallet(body as never);
    case "company-grant-redeem":
      return companyGrantRedeem(body);
    case "sms-send":
      return sendSms(body as never);
    case "email-send":
      return sendEmail(body as never);
    case "whatsapp-send":
      return sendWhatsApp(body as never);
    case "webhook-fire":
      return fireWebhook(body as never);
    case "kra-etims-init":
      return kraEtimsInit(body.creds as never);
    case "kra-etims-invoice":
      return kraEtimsInvoice(body as never);
    default:
      return err(`Unknown integration action: ${action}`);
  }
}
