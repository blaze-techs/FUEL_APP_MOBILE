/**
 * Bug/error reporting sink.
 *
 * Reports are appended as ONE JSON Lines record each to `bugs/INDEX.jsonl` on
 * the `ai-readme` branch of the FuelPro repository, so an AI agent picking up
 * a later task can read a machine-parseable list.
 *
 * THREAT MODEL — READ THIS BEFORE CHANGING THE FORMAT
 *
 * The report body is attacker-controlled free text, and a downstream AI agent
 * is expected to act on the file. That makes this a stored prompt-injection
 * sink: whatever lands in the record is untrusted input to an agent that can
 * touch code. Three properties keep that safe, and all three are load-bearing:
 *
 *   1. INERT BY CONSTRUCTION. Each line is a JSON object, not prose. There is
 *      no template, no markdown, and no code fence, so no arrangement of
 *      characters in any field can close a delimiter and start an instruction
 *      region. In JSONL there is no "outside the string", so injection
 *      requires the agent to choose to obey string contents — which the
 *      contract in bugs/SCHEMA.md forbids.
 *
 *   2. AUTHORITY IS STRIPPED, NOT ESCAPED. The sanitizer removes tokens that
 *      read as instructions to an agent (chat-template markers, "ignore
 *      previous instructions", tool and credential patterns). The user's
 *      actual problem description survives; only the manipulative framing is
 *      dropped. This is why the record still reads as a real bug after
 *      neutralization.
 *
 *   3. THE REPORTER CANNOT CHOOSE THE DESTINATION. Repository, branch, path
 *      and commit identity are server constants. The client supplies only the
 *      fields below, and only after authentication.
 *
 * The invariant these buy together: an agent reading the archive can only
 * learn what a reporter described, never a command to execute. Free text is
 * data in a typed record, and the contract in bugs/SCHEMA.md tells the agent
 * to treat it that way.
 *
 * Deliberately NOT done here: the raw exception message and any credential are
 * never written. Only a coarse server-side error class is recorded, because
 * provider error strings can echo back request bodies containing API keys.
 */
import { supabaseAdmin } from "./supabase-admin.js";

const GITHUB_API = "https://api.github.com";
const REPO = "blaze-techs/FUEL_APP_MOBILE";
const BRANCH = "ai-readme";
const BUGS_DIR = "bugs";
const INDEX_PATH = `${BUGS_DIR}/INDEX.jsonl`;

/** Coarse server-side error classes. Never a raw provider message. */
export type ErrorClass =
  | "none"
  | "network"
  | "timeout"
  | "auth"
  | "permission"
  | "validation"
  | "rate_limit"
  | "upstream"
  | "storage"
  | "unknown";

export type Severity = "low" | "medium" | "high" | "critical";

const SEVERITIES: readonly Severity[] = ["low", "medium", "high", "critical"];
const MAX_SUMMARY = 160;
const MAX_DESCRIPTION = 4000;
const MAX_STEPS = 2000;
const MAX_APP_VERSION = 40;
const MAX_ROUTE = 200;

/**
 * Classify a thrown error into a coarse class so the report is useful without
 * copying a raw provider message (which can echo request bodies and keys).
 */
export function classifyError(message: string): ErrorClass {
  const m = (message || "").toLowerCase();
  if (!m) return "none";
  if (/timed? ?out|timeout|etimedout|abort/.test(m)) return "timeout";
  if (/unauthor|401|invalid token|not authenticated/.test(m)) return "auth";
  if (/forbidden|403|permission|not permitted/.test(m)) return "permission";
  if (/rate ?limit|429|too many/.test(m)) return "rate_limit";
  if (/enotfound|econnrefused|econnreset|dns|offline|network/.test(m))
    return "network";
  if (/invalid|missing|required|malformed/.test(m)) return "validation";
  if (/5\d\d|upstream|bad gateway|unavailable/.test(m)) return "upstream";
  if (/storage|bucket|upload|quota/.test(m)) return "storage";
  return "unknown";
}

/**
 * Patterns that read as instructions to an LLM rather than as a description of
 * a problem. Matching text is replaced with a visible marker so the reader can
 * see that something was removed, and so the removal is auditable.
 */
const DIRECTIVE_PATTERNS: ReadonlyArray<RegExp> = [
  // Chat / prompt template control markers.
  /<\|[^|>]{0,40}\|>/g,
  /\[\/?INST\]/gi,
  /<<\/?SYS>>/gi,
  // Instruction-override phrasing.
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instruction|prompt|rule|message|context|direction)s?/gi,
  /\b(?:new|updated|revised)\s+instructions?\b/gi,
  /\byou\s+are\s+now\b/gi,
  /\bact\s+as\s+(?:a\s+|an\s+)?(?:system|developer|admin|root)\b/gi,
  /\b(?:system|assistant|developer|tool)\s*:\s*/gi,
  /\b(?:jailbreak|developer\s+mode|do\s+anything\s+now)\b/gi,
  /\b(?:execute|run|eval)\s+(?:the\s+)?(?:following|this|below)\b/gi,
  // Tool / shell invocation and credential material.
  /\b(?:curl|wget|powershell|bash|sh|cmd|sudo|chmod|rm\s+-rf)\b\s*/gi,
  /\b(?:ghp_|github_pat_|sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{8,}|xox[baprs]-)/g,
  /-----BEGIN[^-]{0,40}-----/g,
];

const ZERO_WIDTH = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

/**
 * Neutralize one free-text field.
 *
 * Order matters: normalize width/homoglyph forms first so a lookalike cannot
 * slip past a pattern, then drop zero-width and control characters (which are
 * both an injection aid and a way to smuggle newlines into a single-line
 * record), then strip directive patterns.
 */
export function sanitizeText(
  input: unknown,
  maxLength: number,
): { value: string; redactions: number } {
  let s =
    typeof input === "string" ? input : input == null ? "" : String(input);
  s = s.normalize("NFKC");
  s = s.replace(ZERO_WIDTH, "");
  // Collapse every control character (including newlines and tabs) to a space:
  // the archive is one record per line, so no field may contain a break.
  // Matching control characters is the purpose of this line, not an accident.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]+/g, " ");

  let redactions = 0;
  for (const pattern of DIRECTIVE_PATTERNS) {
    s = s.replace(pattern, () => {
      redactions += 1;
      return "[removed]";
    });
  }

  s = s.replace(/\s{2,}/g, " ").trim();
  if (s.length > maxLength) s = s.slice(0, maxLength).trim() + "…";
  return { value: s, redactions };
}

export interface BugReportInput {
  summary?: unknown;
  description?: unknown;
  steps?: unknown;
  severity?: unknown;
  route?: unknown;
  appVersion?: unknown;
}

export interface BugReportRecord {
  bug_id: string;
  reported_at: string;
  status: "open";
  severity: Severity;
  summary: string;
  description: string;
  steps: string;
  route: string;
  app_version: string;
  reporter_ref: string;
  redactions: number;
  /** Explicit contract flag read by the downstream agent. */
  untrusted: true;
}

/** A stable, non-identifying per-user reference (never an email or user id). */
function reporterRef(userId: string): string {
  // FNV-1a, hex. Deterministic per user so duplicates can be grouped, but not
  // reversible to the account without the original value.
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `u_${h.toString(16).padStart(8, "0")}`;
}

/** Build the inert record. Exported so the contract can be tested directly. */
export function buildBugReportRecord(
  raw: BugReportInput,
  userId: string,
  now = new Date(),
): { record: BugReportRecord; ok: boolean; reason?: string } {
  const summary = sanitizeText(raw.summary, MAX_SUMMARY);
  const description = sanitizeText(raw.description, MAX_DESCRIPTION);
  const steps = sanitizeText(raw.steps, MAX_STEPS);

  if (!summary.value) {
    return {
      record: null as unknown as BugReportRecord,
      ok: false,
      reason: "A short summary is required.",
    };
  }

  const severityRaw = String(raw.severity || "medium").toLowerCase();
  const severity = (SEVERITIES as readonly string[]).includes(severityRaw)
    ? (severityRaw as Severity)
    : "medium";

  const idBytes = new Uint8Array(6);
  crypto.getRandomValues(idBytes);
  const suffix = Array.from(idBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const record: BugReportRecord = {
    bug_id: `BUG-${now.toISOString().slice(0, 10)}-${suffix}`,
    reported_at: now.toISOString(),
    status: "open",
    severity,
    summary: summary.value,
    description: description.value,
    steps: steps.value,
    route: sanitizeText(raw.route, MAX_ROUTE).value,
    app_version: sanitizeText(raw.appVersion, MAX_APP_VERSION).value,
    reporter_ref: reporterRef(userId),
    redactions: summary.redactions + description.redactions + steps.redactions,
    untrusted: true,
  };
  return { record, ok: true };
}

/** Credentials the sink needs. Read from the server environment only. */
function githubToken(): string {
  // Prefer a dedicated fine-grained token; fall back to the build token.
  return (
    process.env.FUELPRO_BUGREPORT_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    ""
  ).trim();
}

async function gh(
  path: string,
  init: RequestInit & { token: string },
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${init.token}`,
      "User-Agent": "FuelPro-BugReport",
      ...(init.headers || {}),
    },
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

/**
 * Serialize appends within a serverless instance. Across instances GitHub's
 * own optimistic concurrency is the real guard: we send the current blob sha,
 * and a lost race comes back 409, which we retry by re-reading.
 */
let appendChain: Promise<unknown> = Promise.resolve();
const APPEND_ATTEMPTS = 4;

async function appendLineOnce(line: string, token: string): Promise<void> {
  for (let attempt = 1; attempt <= APPEND_ATTEMPTS; attempt++) {
    // Resolve the branch head so the read and the write agree on a base.
    const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`, {
      method: "GET",
      token,
    });
    if (!ref.ok) {
      throw new Error(`Cannot read branch ${BRANCH} (${ref.status})`);
    }

    const existing = await gh(
      `/repos/${REPO}/contents/${INDEX_PATH}?ref=${BRANCH}`,
      {
        method: "GET",
        token,
      },
    );

    let prior = "";
    let sha: string | undefined;
    if (existing.ok && existing.json?.content) {
      prior = Buffer.from(String(existing.json.content), "base64").toString(
        "utf8",
      );
      sha = String(existing.json.sha);
    } else if (existing.status !== 404) {
      throw new Error(`Cannot read ${INDEX_PATH} (${existing.status})`);
    }

    // The file must end with exactly one newline so each record is its own
    // line. A missing trailing newline would weld two records together.
    const body =
      (prior.endsWith("\n") || prior === "" ? prior : prior + "\n") +
      line +
      "\n";
    const content = Buffer.from(body, "utf8").toString("base64");

    const put = await gh(`/repos/${REPO}/contents/${INDEX_PATH}`, {
      method: "PUT",
      token,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `bug(ai-readme): append report ${JSON.parse(line).bug_id}`,
        content,
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });

    if (put.ok) return;
    if (put.status === 409 || put.status === 422) continue; // lost the race
    throw new Error(`Cannot append bug report (${put.status})`);
  }
  throw new Error("Cannot append bug report: repeated write conflicts");
}

/**
 * Append one report to the archive. Returns the recorded bug id so the caller
 * can confirm receipt.
 */
export async function appendBugReport(
  record: BugReportRecord,
): Promise<{ bugId: string }> {
  const token = githubToken();
  if (!token) {
    throw new Error(
      "Bug reporting is not configured on this deployment (no GitHub token).",
    );
  }
  const line = JSON.stringify(record);
  const run = appendChain.then(() => appendLineOnce(line, token));
  // Keep the chain alive even when a caller's append rejects.
  appendChain = run.catch(() => undefined);
  await run;
  return { bugId: record.bug_id };
}

/**
 * Lightweight per-user throttle. Reports are cheap but the GitHub write is a
 * real mutation, and an unthrottled endpoint is a trivial way to spam the
 * repository. Counts to the existing app_kv store rather than new state.
 */
const RATE_LIMIT_PER_HOUR = 10;

export async function bugReportRateOk(userId: string): Promise<boolean> {
  if (!supabaseAdmin) return true; // never block reporting on a store outage
  const key = `bugreport_rate__${userId}`;
  const since = Date.now() - 60 * 60 * 1000;
  try {
    const { data } = await supabaseAdmin
      .from("app_kv")
      .select("data")
      .eq("id", key)
      .maybeSingle();
    const raw = data?.data as unknown;
    const stamps: number[] = Array.isArray(raw)
      ? raw.filter((n): n is number => typeof n === "number")
      : [];
    const recent = stamps.filter((n) => n > since);
    if (recent.length >= RATE_LIMIT_PER_HOUR) return false;
    recent.push(Date.now());
    await supabaseAdmin.from("app_kv").upsert(
      {
        id: key,
        data: recent,
        owner_id: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    return true;
  } catch {
    return true;
  }
}

export interface BugReportResult {
  success: boolean;
  error?: string;
  bugId?: string;
}

/** Entry point wired into the integrations dispatcher. */
export async function submitBugReport(
  body: Record<string, unknown>,
  userId: string,
): Promise<BugReportResult> {
  const { record, ok, reason } = buildBugReportRecord(
    body as BugReportInput,
    userId,
  );
  if (!ok) return { success: false, error: reason };

  if (!(await bugReportRateOk(userId))) {
    return {
      success: false,
      error:
        "Too many bug reports submitted in the last hour. Please try again later.",
    };
  }

  try {
    const { bugId } = await appendBugReport(record);
    return { success: true, bugId };
  } catch (e) {
    // Surface the class, never the raw upstream message.
    const cls = classifyError(e instanceof Error ? e.message : String(e));
    return {
      success: false,
      error: `Could not record the report (${cls}). Please email support instead.`,
    };
  }
}
