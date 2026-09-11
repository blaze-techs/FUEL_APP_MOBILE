// Secure, owner-scoped action layer for the FuelPro AI assistant.
// Every function here reuses the EXISTING owner-scoped services (Supabase
// RLS by owner_id, the integrations dispatcher with user-configured
// gateways, and client-side export/print helpers). No new endpoints, no
// credentials in code, and nothing leaves the device except through the
// gateways the station owner explicitly configured.
import { saveAs } from "file-saver";
import {
  listDocuments,
  getDocument,
  type DocMetadata,
} from "@/react-app/lib/documentStore";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { callIntegration } from "@/react-app/lib/integrations-client";
import {
  buildWhatsAppWebUrl,
  buildMailtoUrl,
} from "@/react-app/lib/payslip-delivery";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Optional web fallback the caller may open (mailto:/wa.me). */
  fallbackUrl?: string;
  fallbackLabel?: string;
}

// ---------------------------------------------------------------------------
// Documents (user files in the Document Center)
// ---------------------------------------------------------------------------

export async function listUserDocuments(
  stationId?: string | null,
): Promise<DocMetadata[]> {
  try {
    return await listDocuments({ stationId: stationId ?? null });
  } catch {
    return [];
  }
}

export function describeDocuments(docs: DocMetadata[]): string {
  if (docs.length === 0) {
    return "You have no documents stored yet. Upload files in the **Document Center** tab and I can list, find, and download them for you here.";
  }
  const lines = docs.slice(0, 15).map((d) => {
    const kb =
      d.size >= 1024 * 1024
        ? `${(d.size / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(d.size / 1024))} KB`;
    const when = d.uploadedAt
      ? new Date(d.uploadedAt).toLocaleDateString()
      : "";
    return `• **${d.name}** — ${d.category}, ${kb}${when ? `, ${when}` : ""}`;
  });
  const more = docs.length > 15 ? `\n\n…and ${docs.length - 15} more.` : "";
  return `**Your Documents (${docs.length})**\n\n${lines.join("\n")}${more}\n\nSay "download document <name>" and I'll fetch it for you.`;
}

export async function findDocuments(
  query: string,
  stationId?: string | null,
): Promise<DocMetadata[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const docs = await listUserDocuments(stationId);
  return docs.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q) ||
      d.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export async function downloadDocumentByName(
  name: string,
  stationId?: string | null,
): Promise<ActionResult> {
  const matches = await findDocuments(name, stationId);
  if (matches.length === 0) {
    return {
      ok: false,
      message: `I couldn't find a document matching "${name}". Say "list my documents" to see everything you have stored.`,
    };
  }
  const doc = matches[0];
  try {
    const full = await getDocument(doc.id);
    if (!full || !full.data || full.data.byteLength === 0) {
      return {
        ok: false,
        message: `I found **${doc.name}** but could not fetch its contents. Try downloading it from the Document Center.`,
      };
    }
    const blob = new Blob([full.data], { type: doc.type });
    saveAs(blob, doc.name);
    const extra =
      matches.length > 1
        ? `\n\n(${matches.length - 1} other match${matches.length > 2 ? "es" : ""}: ${matches
            .slice(1, 4)
            .map((m) => m.name)
            .join(", ")} — be more specific if you meant one of those.)`
        : "";
    return {
      ok: true,
      message: `Downloaded **${doc.name}** (${doc.category}).${extra}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Failed to download **${doc.name}**: ${(e as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Full data extraction (every cloud key the user owns)
// ---------------------------------------------------------------------------

export async function exportAllUserData(): Promise<ActionResult> {
  try {
    const all = await cloudStorageService.getAll();
    const keys = Object.keys(all);
    if (keys.length === 0) {
      return {
        ok: false,
        message: "No cloud data found for your account yet.",
      };
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      source: "FuelPro AI Assistant",
      keys: keys.length,
      data: all,
    };
    const json = JSON.stringify(payload, null, 2);
    saveAs(
      new Blob([json], { type: "application/json" }),
      `fuelpro-data-export-${new Date().toISOString().slice(0, 10)}.json`,
    );
    return {
      ok: true,
      message: `Exported **${keys.length} data collections** (${(json.length / 1024).toFixed(0)} KB) as a JSON backup. This includes your sales history, invoices, contacts, settings, and every other synced dataset.`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Data export failed: ${(e as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Business metrics helpers (shared by analyze / forecast / summary)
// ---------------------------------------------------------------------------

export interface DayMetrics {
  key: string;
  date: string;
  revenue: number;
  litres: number;
  expenses: number;
}

/** Daily revenue for one salesHistory entry — mirrors the Dashboard logic
 * (pump sales across ALL fuel types + POS sales, without double counting). */
export function entryRevenue(entry: any): number {
  const pms = (entry?.pmsPumps || []).reduce(
    (s: number, p: any) => s + (Number(p.salesKsh) || 0),
    0,
  );
  const ago = (entry?.agoPumps || []).reduce(
    (s: number, p: any) => s + (Number(p.salesKsh) || 0),
    0,
  );
  const byType = Object.values(entry?.fuelPumpsByType || {}).reduce(
    (s: number, pumps: any) =>
      s +
      (Array.isArray(pumps)
        ? pumps.reduce(
            (ps: number, p: any) => ps + (Number(p.salesKsh) || 0),
            0,
          )
        : 0),
    0,
  );
  const pos = entry?.posSales || {};
  const posByType = Object.values(pos.byTypeAmount || {}).reduce(
    (s: number, v: any) => s + (Number(v) || 0),
    0,
  );
  const posTotal =
    Object.keys(pos.byTypeAmount || {}).length > 0
      ? posByType
      : (Number(pos.pmsAmount) || 0) + (Number(pos.agoAmount) || 0);
  return pms + ago + byType + posTotal;
}

function entryLitres(entry: any): number {
  const pumpL = (arr: any[]) =>
    (arr || []).reduce((s: number, p: any) => s + (Number(p.salesL) || 0), 0);
  const byTypeL = Object.values(entry?.fuelPumpsByType || {}).reduce(
    (s: number, pumps: any) => s + (Array.isArray(pumps) ? pumpL(pumps) : 0),
    0,
  );
  const pos = entry?.posSales || {};
  const posByType = Object.values(pos.byTypeLitres || {}).reduce(
    (s: number, v: any) => s + (Number(v) || 0),
    0,
  );
  const posTotal =
    Object.keys(pos.byTypeLitres || {}).length > 0
      ? posByType
      : (Number(pos.pmsLitres) || 0) + (Number(pos.agoLitres) || 0);
  return pumpL(entry?.pmsPumps) + pumpL(entry?.agoPumps) + byTypeL + posTotal;
}

export function dailySeries(state: any): DayMetrics[] {
  return Object.keys(state.salesHistory || {})
    .sort()
    .map((key) => {
      const e = state.salesHistory[key] || {};
      return {
        key,
        date: e.date || key.split("_")[0] || key,
        revenue: entryRevenue(e),
        litres: entryLitres(e),
        expenses: (e.expenses || []).reduce(
          (s: number, x: any) => s + (Number(x.amount) || 0),
          0,
        ),
      };
    });
}

export function analyzeSalesTrend(state: any): string {
  const series = dailySeries(state);
  const currency = getCurrencySymbol(state.companyData?.currency);
  if (series.length === 0) {
    return "No sales history recorded yet. Record a day in **Sales Tracking** or complete a sale in **Point of Sale**, then ask me to analyze again.";
  }
  const total = series.reduce((s, d) => s + d.revenue, 0);
  const totalL = series.reduce((s, d) => s + d.litres, 0);
  const totalExp = series.reduce((s, d) => s + d.expenses, 0);
  const avg = total / series.length;
  const best = [...series].sort((a, b) => b.revenue - a.revenue)[0];
  const worst = [...series].sort((a, b) => a.revenue - b.revenue)[0];

  const last7 = series.slice(-7);
  const prev7 = series.slice(-14, -7);
  const last7Total = last7.reduce((s, d) => s + d.revenue, 0);
  const prev7Total = prev7.reduce((s, d) => s + d.revenue, 0);
  let trendLine =
    "Not enough history for a week-over-week trend (need 14+ days).";
  if (prev7.length > 0 && prev7Total > 0) {
    const pct = ((last7Total - prev7Total) / prev7Total) * 100;
    const dir = pct >= 0 ? "📈 up" : "📉 down";
    trendLine = `Last 7 days are ${dir} **${Math.abs(pct).toFixed(1)}%** vs the previous 7 days (${currency} ${formatNumber(last7Total)} vs ${formatNumber(prev7Total)}).`;
  }

  return `**Sales Analysis (${series.length} day${series.length > 1 ? "s" : ""} recorded)**

• Total Revenue: ${currency} ${formatNumber(total)}
• Total Fuel Sold: ${formatNumber(totalL)} L
• Total Expenses: ${currency} ${formatNumber(totalExp)}
• Net: ${currency} ${formatNumber(total - totalExp)}
• Average per day: ${currency} ${formatNumber(avg)}

**Best day:** ${best.date} — ${currency} ${formatNumber(best.revenue)}
**Slowest day:** ${worst.date} — ${currency} ${formatNumber(worst.revenue)}

${trendLine}

Ask me to "forecast sales" for a projection, or "download sales report" for the full document.`;
}

export function forecastSales(state: any, days = 7): string {
  const series = dailySeries(state).filter((d) => d.revenue > 0);
  const currency = getCurrencySymbol(state.companyData?.currency);
  if (series.length < 3) {
    return `I need at least 3 days of sales history to forecast — you have ${series.length}. Record a few more days in **Sales Tracking** or **Point of Sale** and ask again.`;
  }
  // Least-squares linear regression over the daily revenue series.
  const ys = series.map((d) => d.revenue);
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  const nextDay = Math.max(0, intercept + slope * n);
  const period = Math.max(
    0,
    days * intercept + (slope * ((n + days - 1 + n) * days)) / 2,
  );

  const dirWord =
    slope > meanY * 0.01
      ? "growing"
      : slope < -meanY * 0.01
        ? "declining"
        : "stable";
  const avgLitres = series.reduce((s, d) => s + d.litres, 0) / n;

  return `**Sales Forecast** (based on ${n} day${n > 1 ? "s" : ""} of real history)

• Trend: **${dirWord}** (${slope >= 0 ? "+" : ""}${currency} ${formatNumber(Math.abs(slope))}/day)
• Projected next day: ~${currency} ${formatNumber(nextDay)}
• Projected next ${days} days: ~${currency} ${formatNumber(period)}
• Average volume: ${formatNumber(avgLitres)} L/day

⚠️ This is a statistical projection from your own sales history — actual results depend on price changes, seasonality, and demand. Ask "analyze sales" for the underlying trend.`;
}

// ---------------------------------------------------------------------------
// Summary text (shared by print + send)
// ---------------------------------------------------------------------------

export function buildSummaryText(state: any): string {
  const currency = getCurrencySymbol(state.companyData?.currency);
  const name =
    state.companyData?.name || state.companyData?.companyName || "Fuel Station";
  const series = dailySeries(state);
  const total = series.reduce((s, d) => s + d.revenue, 0);
  const totalL = series.reduce((s, d) => s + d.litres, 0);
  const totalExp = series.reduce((s, d) => s + d.expenses, 0);
  const debt = (state.deliveryTracker?.deliveries || []).reduce(
    (s: number, d: any) => s + (Number(d.debt) || 0),
    0,
  );
  const lines = [
    `${name} — Business Summary`,
    `Generated: ${new Date().toLocaleString()}`,
    ``,
    `Days recorded: ${series.length}`,
    `Total revenue: ${currency} ${formatNumber(total)}`,
    `Total fuel sold: ${formatNumber(totalL)} L`,
    `Total expenses: ${currency} ${formatNumber(totalExp)}`,
    `Net: ${currency} ${formatNumber(total - totalExp)}`,
    `Outstanding debt: ${currency} ${formatNumber(debt)}`,
    `Saved invoices: ${(state.invoices || []).length}`,
    `Employees: ${(state.employees || []).length}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Print (client-side, paper-friendly light document)
// ---------------------------------------------------------------------------

export function printTextDocument(title: string, bodyText: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  doc.open();
  doc.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    body{font-family:ui-monospace,Menlo,Consolas,monospace;color:#111;padding:24px;max-width:720px;margin:0 auto}
    h1{font-size:18px;border-bottom:2px solid #111;padding-bottom:8px}
    pre{white-space:pre-wrap;font-size:13px;line-height:1.6}
    @media print{body{padding:0}}
  </style></head><body><h1>${esc(title)}</h1><pre>${esc(bodyText)}</pre></body></html>`);
  doc.close();
  const cleanup = () => setTimeout(() => iframe.remove(), 1000);
  iframe.contentWindow?.addEventListener("afterprint", cleanup);
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    cleanup();
  }, 250);
}

// ---------------------------------------------------------------------------
// Send (email / WhatsApp) via the station's configured gateways
// ---------------------------------------------------------------------------

interface CommGateway {
  stationName?: string;
  senderEmail?: string;
  smtpUser?: string;
  emailEnabled?: boolean;
  emailProvider?: string;
  emailApiKey?: string;
  emailDomain?: string;
  whatsappEnabled?: boolean;
  whatsappPhone?: string;
  whatsappToken?: string;
}

async function getCommGateway(
  stationId?: string | null,
): Promise<CommGateway | null> {
  try {
    return await cloudStorageService.get<CommGateway>(
      "comm_integration_config",
      stationId ?? undefined,
    );
  } catch {
    return null;
  }
}

export async function sendSummaryEmail(
  to: string,
  text: string,
  stationId?: string | null,
): Promise<ActionResult> {
  const gw = await getCommGateway(stationId);
  const subject = `Business Summary — ${gw?.stationName || "Fuel Station"}`;
  if (gw?.emailEnabled && gw.emailApiKey) {
    try {
      const res = await callIntegration("email-send", {
        provider: gw.emailProvider || "sendgrid",
        to,
        subject,
        text,
        fromEmail: gw.senderEmail || gw.smtpUser || "",
        fromName: gw.stationName || "Fuel Station",
        apiKey: gw.emailApiKey,
        domain: gw.emailDomain,
      });
      if (res.success) {
        return {
          ok: true,
          message: `Email sent to **${to}** via your configured ${gw.emailProvider || "email"} gateway.`,
        };
      }
      return {
        ok: false,
        message: `The email gateway rejected the send: ${res.error || "unknown error"}. You can use the mail-app fallback instead.`,
        fallbackUrl: buildMailtoUrl({ to, subject, body: text }),
        fallbackLabel: "Open in mail app",
      };
    } catch (e) {
      return {
        ok: false,
        message: `Email send failed: ${(e as Error).message}`,
        fallbackUrl: buildMailtoUrl({ to, subject, body: text }),
        fallbackLabel: "Open in mail app",
      };
    }
  }
  return {
    ok: false,
    message:
      "Your email gateway is not configured (Communication → Settings). I can open your mail app with everything pre-filled instead.",
    fallbackUrl: buildMailtoUrl({ to, subject, body: text }),
    fallbackLabel: "Open in mail app",
  };
}

export async function sendSummaryWhatsApp(
  phone: string,
  text: string,
  stationId?: string | null,
): Promise<ActionResult> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) {
    return {
      ok: false,
      message:
        "That phone number doesn't look valid. Include the full international number, e.g. 254712345678.",
    };
  }
  const gw = await getCommGateway(stationId);
  if (gw?.whatsappEnabled && gw.whatsappPhone && gw.whatsappToken) {
    try {
      const res = await callIntegration("whatsapp-send", {
        phoneNumberId: gw.whatsappPhone,
        token: gw.whatsappToken,
        to: digits,
        message: text,
      });
      if (res.success) {
        return {
          ok: true,
          message: `WhatsApp message sent to **+${digits}** via your WhatsApp Business gateway.`,
        };
      }
      return {
        ok: false,
        message: `The WhatsApp gateway rejected the send: ${res.error || "unknown error"}. You can use WhatsApp Web instead.`,
        fallbackUrl: buildWhatsAppWebUrl(digits, text),
        fallbackLabel: "Open WhatsApp Web",
      };
    } catch (e) {
      return {
        ok: false,
        message: `WhatsApp send failed: ${(e as Error).message}`,
        fallbackUrl: buildWhatsAppWebUrl(digits, text),
        fallbackLabel: "Open WhatsApp Web",
      };
    }
  }
  return {
    ok: false,
    message:
      "Your WhatsApp Business gateway is not configured (Communication → Settings). I can open WhatsApp Web with the message pre-filled instead.",
    fallbackUrl: buildWhatsAppWebUrl(digits, text),
    fallbackLabel: "Open WhatsApp Web",
  };
}

// ---------------------------------------------------------------------------
// General questions (small, safe, local)
// ---------------------------------------------------------------------------

/**
 * Safe arithmetic evaluator — only digits and + - * / ( ) % allowed.
 * Hand-written recursive-descent parser (no eval/Function — the site CSP
 * forbids unsafe-eval).
 */
export function evalArithmetic(expr: string): number | null {
  const cleaned = expr
    .replace(/x/gi, "*")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/%/g, "/100");
  if (!/^[\d\s+\-*/().]+$/.test(cleaned)) return null;

  let pos = 0;
  const peek = () => cleaned[pos];
  const skipWs = () => {
    while (pos < cleaned.length && cleaned[pos] === " ") pos++;
  };

  const parsePrimary = (): number | null => {
    skipWs();
    if (peek() === "(") {
      pos++;
      const val = parseExpr();
      skipWs();
      if (peek() !== ")") return null;
      pos++;
      return val;
    }
    if (peek() === "-" || peek() === "+") {
      const sign = peek() === "-" ? -1 : 1;
      pos++;
      const val = parsePrimary();
      return val === null ? null : sign * val;
    }
    const m = /^(\d+(?:\.\d+)?)/.exec(cleaned.slice(pos));
    if (!m) return null;
    pos += m[1].length;
    return parseFloat(m[1]);
  };

  const parseTerm = (): number | null => {
    let left = parsePrimary();
    if (left === null) return null;
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== "*" && op !== "/") return left;
      pos++;
      const right = parsePrimary();
      if (right === null) return null;
      left = op === "*" ? left * right : left / right;
    }
  };

  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    for (;;) {
      skipWs();
      const op = peek();
      if (op !== "+" && op !== "-") return left;
      pos++;
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
  };

  const result = parseExpr();
  skipWs();
  if (result === null || pos !== cleaned.length) return null;
  return Number.isFinite(result) ? result : null;
}
