import { useState } from "react";
import { AlertTriangle, Bug, CheckCircle2, Loader2, Send } from "lucide-react";
import { callIntegration } from "@/react-app/lib/integrations-client";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

type Severity = "low" | "medium" | "high" | "critical";

const SEVERITIES: Array<{ id: Severity; label: string }> = [
  { id: "low", label: "Low — cosmetic or minor" },
  { id: "medium", label: "Medium — feature misbehaves" },
  { id: "high", label: "High — blocks a task" },
  { id: "critical", label: "Critical — data loss or unusable" },
];

const MAX = { summary: 160, description: 4000, steps: 2000 } as const;

type SubmitResult = { ok: true; bugId: string } | { ok: false; error: string };

/**
 * In-app bug/error reporting.
 *
 * Reports are POSTed to the authenticated integration dispatcher, which strips
 * directive-like text and appends one JSON Lines record to `bugs/INDEX.jsonl`
 * on the `ai-readme` branch. Because an AI agent later reads that file, the
 * server treats every free-text field as hostile input — see
 * `src/server/vercel-api/_lib/bug-report.ts` for the threat model and
 * `bugs/SCHEMA.md` on that branch for the read contract.
 *
 * The UI does no sanitization of its own: it must not, because a client-side
 * filter is trivially bypassed and would give a false sense of safety. The
 * server is the only enforcement point.
 */
export default function BugReportSection() {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const canSubmit = summary.trim().length > 0 && !busy;
  const signedIn = Boolean(cloudStorageService.currentUserIdSync());

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await callIntegration("bug-report", {
        summary: summary.trim(),
        description: description.trim(),
        steps: steps.trim(),
        severity,
        route:
          typeof window === "undefined"
            ? ""
            : window.location.hash || window.location.pathname,
        appVersion: (import.meta.env.VITE_APP_VERSION as string) || "",
      });

      if (res.success) {
        setResult({ ok: true, bugId: String(res.bugId || "") });
        setSummary("");
        setDescription("");
        setSteps("");
        setSeverity("medium");
      } else {
        setResult({
          ok: false,
          error: res.error || "The report could not be submitted.",
        });
      }
    } catch (e) {
      setResult({
        ok: false,
        error: e instanceof Error ? e.message : "The report could not be sent.",
      });
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Report a bug or error. Reports are recorded in the project&apos;s bug
        archive so they can be picked up and fixed in a future task. Please
        describe what happened — no account details are included.
      </p>

      {!signedIn && (
        <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>You need to be signed in to submit a report.</span>
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="md:col-span-2 block">
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
            Summary
          </span>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value.slice(0, MAX.summary))}
            maxLength={MAX.summary}
            placeholder="e.g. Dashboard price card is blank after switching station"
            aria-label="Bug summary"
            className={field}
          />
          <span className="mt-1 block text-[11px] text-gray-400">
            {summary.length}/{MAX.summary}
          </span>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
            Severity
          </span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            aria-label="Severity"
            className={field}
          >
            {SEVERITIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
          What happened?
        </span>
        <textarea
          value={description}
          onChange={(e) =>
            setDescription(e.target.value.slice(0, MAX.description))
          }
          maxLength={MAX.description}
          rows={4}
          placeholder="Describe the problem and what you expected instead."
          aria-label="Bug description"
          className={field}
        />
        <span className="mt-1 block text-[11px] text-gray-400">
          {description.length}/{MAX.description}
        </span>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
          Steps to reproduce (optional)
        </span>
        <textarea
          value={steps}
          onChange={(e) => setSteps(e.target.value.slice(0, MAX.steps))}
          maxLength={MAX.steps}
          rows={3}
          placeholder="1. Open …&#10;2. Tap …&#10;3. The value shows nothing"
          aria-label="Steps to reproduce"
          className={field}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Send size={15} />
          )}
          {busy ? "Sending…" : "Submit report"}
        </button>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
          <Bug size={12} />
          Filed to the bug archive for AI triage
        </span>
      </div>

      {result?.ok && (
        <p className="flex items-start gap-2 text-xs text-green-700 dark:text-green-300">
          <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Thanks — recorded as{" "}
            <code className="font-mono">{result.bugId || "a new report"}</code>.
            It will be reviewed in a future task.
          </span>
        </p>
      )}

      {result && result.ok === false && (
        <p className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{result.error}</span>
        </p>
      )}
    </div>
  );
}
