/**
 * Integrations API (Vercel serverless)
 *
 * REAL production integration dispatcher. Every action makes an actual call
 * to the actual institution (Safaricom Daraja, Kopo Kopo, Twilio, Africa's
 * Talking, SendGrid, Mailgun, Resend, Meta WhatsApp Cloud, KRA eTIMS OSCU,
 * arbitrary webhook endpoints). No simulation.
 *
 * POST /api/integrations?action=<action>
 *   actions: ping | mpesa-stk-push | mpesa-query | kopokopo-pull |
 *            sms-send | email-send | whatsapp-send | webhook-fire |
 *            kra-etims-init | kra-etims-invoice
 *
 * The station's own institution credentials arrive in the request body
 * (bring-your-own-key relay — see api/_lib/integrations-core.ts).
 */
import type { IncomingMessage, ServerResponse } from "http";
import { dispatchIntegration } from "./_lib/integrations-core.js";

interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

function wrapRes(res: ServerResponse): ApiResponse {
  const r = res as ApiResponse;
  r.status = (code: number) => {
    res.statusCode = code;
    return r;
  };
  r.json = (body: unknown) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };
  return r;
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const out = wrapRes(res);
  setCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const qs = Object.fromEntries(
    new URLSearchParams((req.url || "").split("?")[1] || ""),
  );
  const action = String(qs.action || "");
  const body = req.method === "POST" ? await readBody(req) : {};

  if (!action) {
    out.status(400).json({ success: false, error: "Missing action parameter" });
    return;
  }

  try {
    const result = await dispatchIntegration(action, body);
    out.status(result.success ? 200 : 200).json(result); // 200 with success flag (upstream detail in body)
  } catch (e) {
    out.status(500).json({ success: false, error: (e as Error).message });
  }
}
