import { useEffect, useRef } from "react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { getPricingMode } from "@/react-app/lib/pricing-mode";

const ISSUE_KEY = "fuelpro_silent_verifier_issues";
const HEARTBEAT_KEY = "fuelpro_silent_verifier_heartbeat";
const REPORT_COOLDOWN_MS = 5 * 60_000;

type Issue = { code: string; detail?: string };

function readReported(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ISSUE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function reportIssue(issue: Issue): void {
  const key = `${issue.code}:${issue.detail ?? ""}`;
  const now = Date.now();
  const reported = readReported();
  if (now - (reported[key] ?? 0) < REPORT_COOLDOWN_MS) return;
  reported[key] = now;
  try { localStorage.setItem(ISSUE_KEY, JSON.stringify(reported)); } catch {}
  console.warn("[FuelPro silent verifier]", issue.code, issue.detail ?? "");
  import("@sentry/react").then((Sentry) => {
    Sentry.captureMessage(`FuelPro verifier: ${issue.code}`, {
      level: "error",
      tags: { verifier: "silent", issue: issue.code },
      extra: issue.detail ? { detail: issue.detail } : undefined,
    });
  }).catch(() => {});
}

function scanNumbers(value: unknown, path: string, issues: Issue[], seen: WeakSet<object>): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push({ code: "NON_FINITE_NUMBER", detail: path });
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanNumbers(item, `${path}[${index}]`, issues, seen));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    scanNumbers(child, path ? `${path}.${key}` : key, issues, seen);
  }
}

function verifyPumpMath(state: unknown, issues: Issue[]): void {
  const root = state as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return;
  for (const key of ["pumps", "pumpReadings", "pumpData", "readings"]) {
    const rows = root[key];
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object") return;
      const r = row as Record<string, unknown>;
      const opening = Number(r.openingL);
      const closing = Number(r.closingL);
      const sales = Number(r.salesL);
      if ([opening, closing, sales].every(Number.isFinite) && Math.abs((closing - opening) - sales) > 0.01) {
        issues.push({ code: "PUMP_LITRE_MATH_MISMATCH", detail: `${key}[${index}]` });
      }
    });
  }
}

function verifyDom(issues: Issue[]): void {
  const text = document.body?.innerText ?? "";
  for (const bad of ["NaN", "Infinity", "[object Object]"]) {
    if (text.includes(bad)) issues.push({ code: "BROKEN_DISPLAY_VALUE", detail: bad });
  }
  document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea").forEach((el) => {
    const name = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent?.trim() ||
      (el instanceof HTMLInputElement ? el.placeholder : "") || "";
    if (!name && !el.hasAttribute("hidden")) issues.push({ code: "UNNAMED_INTERACTIVE_CONTROL", detail: el.tagName });
  });

  const body = text.toLowerCase();
  if (body.includes("fuel type manager") && body.includes("pricing mode")) {
    const pricingBadge = Array.from(document.querySelectorAll<HTMLElement>("span,p,div"))
      .map((el) => el.innerText?.trim() ?? "")
      .find((value) => /^pricing:\s*(manual|auto \(regulator\))$/i.test(value));
    const activeMode = Array.from(document.querySelectorAll<HTMLElement>("button"))
      .filter((el) => {
        const label = el.innerText?.trim().toLowerCase();
        return label === "manual" || label === "auto (regulator)";
      })
      .find((el) => ["amber-500", "border-amber-500", "bg-amber-50", "bg-amber-500/10"].some((token) => String(el.className).includes(token)));
    if (pricingBadge && activeMode) {
      const badgeMode = pricingBadge.toLowerCase().includes("manual") ? "manual" : "auto";
      const selectorMode = activeMode.innerText?.trim().toLowerCase().includes("manual") ? "manual" : "auto";
      if (badgeMode !== selectorMode) issues.push({ code: "PRICING_MODE_DISPLAY_MISMATCH" });
    }
  }
}

export function runSilentVerification(state: unknown): number {
  const issues: Issue[] = [];
  scanNumbers(state, "fuel_state", issues, new WeakSet<object>());
  verifyPumpMath(state, issues);
  verifyDom(issues);
  for (const issue of issues) reportIssue(issue);
  try {
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ at: new Date().toISOString(), issueCount: issues.length }));
  } catch {}
  return issues.length;
}

export function SilentVerifier(): null {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    const verify = async () => {
      if (cancelled || document.visibilityState === "hidden") return;
      runSilentVerification(stateRef.current);

      if (!currentStation?.id) return;
      try {
        const authoritative = await getPricingMode(currentStation.id);
        if (cancelled) return;
        const body = document.body?.innerText ?? "";
        if (body.toLowerCase().includes("pricing mode")) {
          const expected = authoritative === "manual" ? "manual" : "auto";
          const visible = Array.from(document.querySelectorAll<HTMLElement>("button"))
            .filter((el) => {
              const label = el.innerText?.trim().toLowerCase();
              return label === "manual" || label === "auto (regulator)";
            })
            .find((el) => /amber-500|border-amber-500|bg-amber-50|bg-amber-500\\/10/.test(el.className));
          if (visible) {
            const actual = visible.innerText?.trim().toLowerCase().includes("manual") ? "manual" : "auto";
            if (actual !== expected) reportIssue({ code: "PRICING_MODE_CLOUD_UI_MISMATCH", detail: `station=${currentStation.id}` });
          }
        }
        if (authoritative !== "manual" && authoritative !== "auto") {
          reportIssue({ code: "INVALID_PRICING_MODE_FROM_CLOUD" });
        }
      } catch (error) {
        reportIssue({
          code: "VERIFIER_CLOUD_READ_FAILED",
          detail: error instanceof Error ? error.message.slice(0, 180) : "unknown",
        });
      }
    };

    void verify();
    const timer = window.setInterval(() => void verify(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [currentStation?.id]);

  return null;
}

export function getSilentVerifierHeartbeat(): unknown {
  try {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
