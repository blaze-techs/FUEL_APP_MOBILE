/**
 * Server-side actions for the dedicated customer/organization mini site.
 * Public capability token -> station/customer-scoped data only.
 *
 * POST /api/external-mini-site
 * Actions: list-files, request-upload, complete-upload, stk-push
 */
import type { IncomingMessage, ServerResponse } from "http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { supabaseAdmin } from "./_lib/supabase-admin.js";
import {
  auditServer,
  mpesaBaseUrl,
  mpesaConfig,
  mpesaPassword,
  mpesaTimestamp,
  mpesaToken,
  normalizeKenyanPhone,
} from "./_lib/mpesa.js";

const PREFIX = "external_mini_site_";
const FILE_PREFIX = "external_mini_site_files_";
const FILE_BUCKET = "fuelpro-customer-private";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 100;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const CATEGORY_VALUES = new Set([
  "Invoices & billing",
  "Statements & account",
  "Proof of payment",
  "Fuel & transaction records",
  "Contracts & company documents",
  "Other",
]);
const hits = new Map<string, { count: number; resetAt: number }>();

interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
}
interface SiteRow { id: string; data: unknown; station_id?: string | null; }
interface SiteDoc {
  token?: string;
  kind?: string;
  entityId?: string;
  entityName?: string;
  stationId?: string;
  stationName?: string;
  customerPhone?: string;
  customerEmail?: string;
  paymentMethods?: Array<{ kind?: string; number?: string; label?: string }>;
  expiresAt?: string;
}
interface Resolution {
  doc: SiteDoc;
  ownerId: string;
  stationId: string | null;
}
interface FileMeta {
  id: string;
  name: string;
  path: string;
  category: string;
  description?: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  source: "customer" | "station";
}

function json(res: ApiResponse, status: number, body: unknown) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(JSON.stringify(body));
}

function rateOk(ip: string) {
  const now = Date.now();
  const old = hits.get(ip);
  if (!old || now > old.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  old.count++;
  return old.count <= RATE_LIMIT;
}

function decode(raw: unknown): unknown {
  let data = raw;
  if (
    data &&
    typeof data === "object" &&
    (data as { __compressed?: boolean }).__compressed === true &&
    typeof (data as { c?: unknown }).c === "string"
  ) {
    try {
      data = JSON.parse(
        zlib.gunzipSync(Buffer.from((data as { c: string }).c, "base64")).toString(),
      );
    } catch {}
  }
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch {}
  }
  return data;
}

async function bodyJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (part) => {
      if (done) return;
      const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
      size += buf.length;
      if (size > 256 * 1024) {
        done = true;
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (done) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

async function resolve(token: string): Promise<Resolution | null> {
  if (!supabaseAdmin || !/^[A-Za-z0-9]{10,16}$/.test(token)) return null;
  const { data, error } = await supabaseAdmin
    .from("app_kv")
    .select("id,data,station_id")
    .like("id", `${PREFIX}${token}__%`)
    .limit(10);
  if (error) throw error;

  for (const row of (data || []) as SiteRow[]) {
    const doc = decode(row.data) as SiteDoc | null;
    if (!doc || doc.token !== token || doc.kind !== "customer") continue;
    if (doc.expiresAt && Date.parse(doc.expiresAt) < Date.now()) return null;

    const marker = `${PREFIX}${token}__`;
    const suffix = row.id.startsWith(marker) ? row.id.slice(marker.length) : "";
    const ownerId = suffix.split("__")[0] || "";
    if (!ownerId) continue;
    return {
      doc,
      ownerId,
      stationId: row.station_id || doc.stationId || null,
    };
  }
  return null;
}

function filesKey(r: Resolution) {
  return r.stationId
    ? `${FILE_PREFIX}${r.doc.token}__${r.ownerId}__${r.stationId}`
    : `${FILE_PREFIX}${r.doc.token}__${r.ownerId}`;
}

async function readFiles(r: Resolution): Promise<FileMeta[]> {
  const { data, error } = await supabaseAdmin!
    .from("app_kv")
    .select("data")
    .eq("id", filesKey(r))
    .maybeSingle();
  if (error) throw error;
  const decoded = data ? decode(data.data) : [];
  return Array.isArray(decoded) ? decoded as FileMeta[] : [];
}

async function writeFiles(r: Resolution, files: FileMeta[]) {
  const { error } = await supabaseAdmin!.from("app_kv").upsert({
    id: filesKey(r),
    collection: "fuel_data",
    owner_id: r.ownerId,
    station_id: r.stationId,
    data: files.slice(0, MAX_FILES),
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
}

async function ensureBucket() {
  const admin = supabaseAdmin!;
  const current = await admin.storage.getBucket(FILE_BUCKET);
  if (!current.error && current.data) {
    if (current.data.public !== false || Number(current.data.file_size_limit || 0) !== MAX_FILE_BYTES) {
      const { error } = await admin.storage.updateBucket(FILE_BUCKET, {
        public: false,
        fileSizeLimit: MAX_FILE_BYTES,
        allowedMimeTypes: ALLOWED_MIME_TYPES,
      });
      if (error) throw error;
    }
    return;
  }
  const { error } = await admin.storage.createBucket(FILE_BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_BYTES,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
}

function safeName(name: string) {
  const out = String(name || "document")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return out || "document";
}

async function signed(file: FileMeta) {
  const storage = supabaseAdmin!.storage.from(FILE_BUCKET);
  const view = await storage.createSignedUrl(file.path, 900);
  const download = await storage.createSignedUrl(file.path, 900, { download: file.name });
  return {
    id: file.id,
    name: file.name,
    category: file.category,
    description: file.description,
    size: file.size,
    mimeType: file.mimeType,
    uploadedAt: file.uploadedAt,
    source: file.source,
    viewUrl: view.data?.signedUrl,
    downloadUrl: download.data?.signedUrl,
  };
}

async function filesAction(res: ApiResponse, r: Resolution, body: Record<string, unknown>) {
  const action = String(body.action || "");

  if (action === "list-files") {
    const current = await readFiles(r);
    const output = [];
    for (const file of current.slice(0, MAX_FILES)) output.push(await signed(file));
    json(res, 200, { success: true, files: output });
    return;
  }

  if (action === "request-upload") {
    await ensureBucket();
    const file = (body.file || {}) as Record<string, unknown>;
    const name = safeName(String(file.name || ""));
    const size = Number(file.size);
    const mimeType = String(file.mimeType || "");
    const category = String(file.category || "Other");
    const description = String(file.description || "").trim().slice(0, 500);

    if (!name || !Number.isFinite(size) || size < 1 || size > MAX_FILE_BYTES ||
        !CATEGORY_VALUES.has(category) || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      json(res, 400, { success: false, reason: "invalid_file" });
      return;
    }

    const current = await readFiles(r);
    if (current.length >= MAX_FILES) {
      json(res, 409, { success: false, reason: "file_limit_reached" });
      return;
    }

    const fileId = crypto.randomUUID();
    const path = `customer-sites/${r.doc.token}/${fileId}-${name}`;
    const { data, error } = await supabaseAdmin!.storage
      .from(FILE_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (error || !data?.token) {
      json(res, 502, { success: false, reason: "upload_url_unavailable" });
      return;
    }

    json(res, 200, {
      success: true,
      upload: { bucket: FILE_BUCKET, path, token: data.token, fileId },
      limits: { maxBytes: MAX_FILE_BYTES },
    });
    return;
  }

  if (action === "complete-upload") {
    const file = (body.file || {}) as Record<string, unknown>;
    const id = String(file.id || "");
    const path = String(file.path || "");
    const name = safeName(String(file.name || ""));
    const size = Number(file.size);
    const mimeType = String(file.mimeType || "");
    const category = String(file.category || "Other");
    const description = String(file.description || "").trim().slice(0, 500);

    if (!/^[0-9a-f-]{36}$/i.test(id) ||
        !path.startsWith(`customer-sites/${r.doc.token}/`) ||
        !name || !Number.isFinite(size) || size < 1 || size > MAX_FILE_BYTES ||
        !CATEGORY_VALUES.has(category) || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      json(res, 400, { success: false, reason: "invalid_file" });
      return;
    }

    const current = await readFiles(r);
    const already = current.find((x) => x.id === id);
    if (already) {
      json(res, 200, { success: true, file: await signed(already), duplicate: true });
      return;
    }

    const probe = await supabaseAdmin!.storage.from(FILE_BUCKET).createSignedUrl(path, 60);
    if (probe.error || !probe.data?.signedUrl) {
      json(res, 422, { success: false, reason: "upload_not_found" });
      return;
    }

    const meta: FileMeta = {
      id,
      name,
      path,
      category,
      description: description || undefined,
      size,
      mimeType,
      uploadedAt: new Date().toISOString(),
      source: "customer",
    };
    await writeFiles(r, [meta, ...current]);
    await auditServer(r.stationId, "customer_site_file_uploaded", "customer_account", String(r.doc.entityId || ""), {
      file_id: id,
      file_name: name,
      site_token: r.doc.token,
    });
    json(res, 200, { success: true, file: await signed(meta) });
    return;
  }

  json(res, 400, { success: false, reason: "unsupported_action" });
}

async function paymentAction(res: ApiResponse, r: Resolution, body: Record<string, unknown>) {
  if (!r.stationId) {
    json(res, 503, { success: false, reason: "payment_unavailable" });
    return;
  }

  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > 500000) {
    json(res, 400, { success: false, reason: "amount_invalid" });
    return;
  }

  let phone: string;
  try {
    phone = normalizeKenyanPhone(String(body.phoneNumber || r.doc.customerPhone || ""));
  } catch {
    json(res, 400, { success: false, reason: "invalid_phone" });
    return;
  }

  const configured = (r.doc.paymentMethods || []).find((m) =>
    (m.kind === "paybill" || m.kind === "till") && String(m.number || "").trim(),
  );
  if (!configured) {
    json(res, 409, { success: false, reason: "payment_not_configured" });
    return;
  }

  let config;
  try { config = mpesaConfig(); } catch {
    json(res, 503, { success: false, reason: "payment_credentials_unavailable" });
    return;
  }

  if (String(config.shortcode).trim() !== String(configured.number).trim()) {
    json(res, 409, { success: false, reason: "payment_station_mismatch" });
    return;
  }

  const idempotencyKey = String(body.idempotencyKey || crypto.randomUUID()).slice(0, 100);
  const { data: existing } = await supabaseAdmin!
    .from("payment_transactions")
    .select("id,checkout_request_id")
    .eq("provider", "mpesa")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing) {
    json(res, 200, {
      success: true,
      duplicate: true,
      transactionId: existing.id,
      checkoutRequestId: existing.checkout_request_id,
    });
    return;
  }

  const accessToken = await mpesaToken();
  const timestamp = mpesaTimestamp();
  const response = await fetch(`${mpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: mpesaPassword(timestamp),
      Timestamp: timestamp,
      TransactionType: configured.kind === "till" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: config.callbackUrl,
      AccountReference: String(r.doc.entityId || "Customer").slice(0, 12),
      TransactionDesc: "FuelPro customer account payment",
    }),
  });
  const daraja = await response.json() as Record<string, unknown>;
  if (!response.ok || String(daraja.ResponseCode || "") !== "0") {
    json(res, 502, {
      success: false,
      reason: String(daraja.errorMessage || daraja.ResponseDescription || "stk_push_failed"),
    });
    return;
  }

  const providerRef = String(daraja.CheckoutRequestID || "");
  const merchantRef = String(daraja.MerchantRequestID || "");
  const { data: tx, error } = await supabaseAdmin!.from("payment_transactions").insert({
    station_id: r.stationId,
    ledger_sale_id: null,
    shift_id: null,
    provider: "mpesa",
    provider_reference: providerRef,
    checkout_request_id: providerRef,
    merchant_request_id: merchantRef,
    payment_method: "mpesa",
    amount,
    currency: "KES",
    status: "pending",
    customer_phone: phone,
    idempotency_key: idempotencyKey,
    metadata: {
      source: "customer_mini_site",
      site_token: r.doc.token,
      account_id: r.doc.entityId || null,
    },
  }).select("id,checkout_request_id").single();

  if (error || !tx) {
    json(res, 409, { success: false, reason: "payment_record_failed" });
    return;
  }

  await auditServer(
    r.stationId,
    "external_customer_payment_requested",
    "customer_account",
    String(r.doc.entityId || ""),
    { transaction_id: tx.id, amount, site_token: r.doc.token },
  );

  json(res, 200, {
    success: true,
    transactionId: tx.id,
    checkoutRequestId: tx.checkout_request_id,
    customerMessage: String(daraja.CustomerMessage || daraja.ResponseDescription || "STK Push sent"),
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const wrap = res as ApiResponse;
  wrap.status = (code: number) => {
    res.statusCode = code;
    return wrap;
  };

  if (req.method !== "POST") {
    json(wrap, 405, { success: false, reason: "method_not_allowed" });
    return;
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress || "unknown";
  if (!rateOk(ip)) {
    json(wrap, 429, { success: false, reason: "rate_limited" });
    return;
  }

  const url = new URL(req.url || "/", "http://fuelpro.local");
  const token = url.searchParams.get("token") || "";
  if (!/^[A-Za-z0-9]{10,16}$/.test(token)) {
    json(wrap, 400, { success: false, reason: "invalid_token" });
    return;
  }

  if (!supabaseAdmin) {
    json(wrap, 503, { success: false, reason: "unavailable" });
    return;
  }

  try {
    const resolution = await resolve(token);
    if (!resolution) {
      json(wrap, 404, { success: false, reason: "not_found" });
      return;
    }

    const body = await bodyJson(req);
    if (String(body.token || token) !== token) {
      json(wrap, 400, { success: false, reason: "token_mismatch" });
      return;
    }

    const action = String(body.action || "");
    if (action === "list-files" || action === "request-upload" || action === "complete-upload") {
      await filesAction(wrap, resolution, body);
      return;
    }
    if (action === "stk-push") {
      await paymentAction(wrap, resolution, body);
      return;
    }

    json(wrap, 400, { success: false, reason: "unsupported_action" });
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === "number"
      ? Number((error as { status: number }).status)
      : 500;
    json(wrap, status, {
      success: false,
      reason: error instanceof Error ? error.message : "error",
    });
  }
}
