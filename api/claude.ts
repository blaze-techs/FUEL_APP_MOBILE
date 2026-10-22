import type { IncomingMessage, ServerResponse } from "node:http";

type RequestLike = IncomingMessage & { body?: unknown };
const MAX_BODY_BYTES = 256_000;
const ALLOWED_ORIGINS = new Set([
  "https://fuel-app-mobile.pages.dev",
  "https://fuel-app-mobile.vercel.app",
]);

function json(res: ServerResponse, status: number, body: unknown, origin?: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.end(JSON.stringify(body));
}

function readBody(req: RequestLike): Promise<unknown> {
  if (req.body !== undefined) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function authenticatedUser(req: RequestLike): Promise<boolean> {
  const authorization = req.headers.authorization;
  const token = String(Array.isArray(authorization) ? authorization[0] ?? "" : authorization ?? "")
    .replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseKey) return false;
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function handler(req: RequestLike, res: ServerResponse) {
  const originHeader = req.headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    res.end();
    return;
  }
  if (origin && !ALLOWED_ORIGINS.has(origin) && !origin.startsWith("http://localhost:")) {
    return json(res, 403, { success: false, error: "Origin not allowed" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return json(res, 405, { success: false, error: "POST required" }, origin);
  }
  if (!(await authenticatedUser(req))) {
    return json(res, 401, { success: false, error: "A valid FuelPro session is required" }, origin);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(res, 503, { success: false, error: "Claude API is not configured on the server" }, origin);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await readBody(req);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(res, 400, { success: false, error: "A JSON object is required" }, origin);
    }
    body = parsed as Record<string, unknown>;
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "BODY_TOO_LARGE";
    return json(res, tooLarge ? 413 : 400, { success: false, error: tooLarge ? "Request body too large" : "Invalid JSON body" }, origin);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) {
    return json(res, 400, { success: false, error: "messages must contain between 1 and 40 turns" }, origin);
  }
  const safeMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return json(res, 400, { success: false, error: "Each message must be an object" }, origin);
    }
    const item = message as Record<string, unknown>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || !item.content.trim() || item.content.length > 20000) {
      return json(res, 400, { success: false, error: "Each message needs a valid role and non-empty text content (maximum 20,000 characters)" }, origin);
    }
    safeMessages.push({ role: item.role, content: item.content });
  }
  if (safeMessages[0]?.role !== "user") {
    return json(res, 400, { success: false, error: "The first message must be from the user" }, origin);
  }

  const maxTokensInput = body.max_tokens;
  const maxTokens = typeof maxTokensInput === "number" && Number.isInteger(maxTokensInput)
    ? Math.max(1, Math.min(maxTokensInput, 4096)) : 1024;
  const system = typeof body.system === "string" ? body.system.slice(0, 12000) : undefined;
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: safeMessages,
        ...(system ? { system } : {}),
      }),
      signal: AbortSignal.timeout(55000),
    });
    const responseText = await upstream.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return json(res, 502, { success: false, error: "Claude returned an invalid response" }, origin);
    }
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
      return json(res, status, {
        success: false,
        error: upstream.status === 429 ? "Claude API rate limit reached; retry later" : "Claude API request failed",
        ...(upstream.status === 401 || upstream.status === 403 ? { configuration: "Check the server-side Anthropic API key and permissions" } : {}),
      }, origin);
    }
    return json(res, 200, { success: true, provider: "anthropic", data: payload }, origin);
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return json(res, timeout ? 504 : 502, {
      success: false,
      error: timeout ? "Claude API request timed out" : "Claude API is temporarily unreachable",
    }, origin);
  }
}
