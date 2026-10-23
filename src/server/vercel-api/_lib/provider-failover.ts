/**
 * Provider fail-over + cross-validation.
 *
 * Each capability (geocoding, weather, FX, fuel prices) is served by an
 * ordered list of providers. This module runs them so that:
 *
 *  - the most accurate provider answers first, and
 *  - a provider that fails or returns nothing does NOT take the capability
 *    down with it — the next one is tried immediately (fail-safe), and
 *  - when two providers both answer they can be compared, so a provider that
 *    silently returns the WRONG thing (not just an error) is caught rather
 *    than trusted (work hand in hand).
 *
 * Every attempt is bounded by its own timeout, so one slow provider cannot
 * consume the whole serverless budget.
 */

export interface ProviderAttempt<T> {
  /** Stable id, matching the provider-precedence registry. */
  id: string;
  /** Runs the provider. Return null/undefined to signal "no usable answer". */
  run: () => Promise<T | null | undefined>;
}

export interface ProviderOutcome<T> {
  value: T;
  /** Id of the provider that produced `value`. */
  servedBy: string;
  /** Ids that were tried before the winner and did not produce a value. */
  failed: string[];
  /**
   * Ids of other providers that returned a value agreeing with the winner.
   * Non-empty means the answer was independently confirmed.
   */
  confirmedBy: string[];
  /** True when the winning value was independently confirmed. */
  corroborated: boolean;
}

export interface FailoverOptions<T> {
  /** Per-attempt timeout. Default 8s. */
  timeoutMs?: number;
  /**
   * How many providers to consult in the first round. When >1, the extra
   * results are used only to CORROBORATE the winner — the first successful
   * provider still wins, preserving precedence order.
   */
  confirmWith?: number;
  /** Decides whether two provider answers agree. Defaults to deep equality. */
  agrees?: (a: T, b: T) => boolean;
}

function withTimeout<T>(
  run: () => Promise<T | null | undefined>,
  ms: number,
): Promise<T | null | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`provider timed out after ${ms}ms`)),
      ms,
    );
    run().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function hasValue<T>(v: T | null | undefined): v is T {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Structural equality — enough to compare provider payloads. */
function defaultAgrees<T>(a: T, b: T): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Run providers in order until one answers.
 *
 * Precedence is strictly by array order, so the most accurate provider is
 * always preferred; the rest exist purely so a failure degrades instead of
 * breaking the feature.
 */
export async function withFailover<T>(
  attempts: ProviderAttempt<T>[],
  options: FailoverOptions<T> = {},
): Promise<ProviderOutcome<T> | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const confirmWith = Math.max(1, options.confirmWith ?? 1);
  const agrees = options.agrees ?? defaultAgrees<T>;

  const failed: string[] = [];
  let winner: { id: string; value: T } | null = null;
  let winnerIndex = -1;

  // Round 1 — find the first provider that answers.
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    try {
      const value = await withTimeout(attempt.run, timeoutMs);
      if (hasValue(value)) {
        winner = { id: attempt.id, value: value as T };
        winnerIndex = i;
        break;
      }
      failed.push(attempt.id);
    } catch {
      // A provider failing must never propagate — that is the whole point.
      failed.push(attempt.id);
    }
  }

  if (!winner) return null;

  // Round 2 — ask the next providers purely to CONFIRM the winner. A
  // disagreement does not change the answer (precedence holds); it is
  // reported so callers can flag an unverified figure instead of presenting
  // a silent guess as fact.
  const confirmedBy: string[] = [];
  const remaining = attempts.slice(winnerIndex + 1);
  for (const attempt of remaining.slice(0, confirmWith - 1)) {
    try {
      const value = await withTimeout(attempt.run, timeoutMs);
      if (hasValue(value) && agrees(winner.value, value as T)) {
        confirmedBy.push(attempt.id);
      }
    } catch {
      /* confirmation is best-effort */
    }
  }

  return {
    value: winner.value,
    servedBy: winner.id,
    failed,
    confirmedBy,
    corroborated: confirmedBy.length > 0,
  };
}

/**
 * Pick the value the most providers agree on.
 *
 * Used where providers return the SAME shape (e.g. a set of currency rates):
 * the majority answer wins, so a single provider returning stale or bogus data
 * is outvoted rather than trusted. Falls back to precedence order on a tie.
 */
export async function withConsensus<T>(
  attempts: ProviderAttempt<T>[],
  options: FailoverOptions<T> = {},
): Promise<ProviderOutcome<T> | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const agrees = options.agrees ?? defaultAgrees<T>;

  const results: { id: string; value: T }[] = [];
  const failed: string[] = [];

  await Promise.all(
    attempts.map(async (attempt) => {
      try {
        const value = await withTimeout(attempt.run, timeoutMs);
        if (hasValue(value))
          results.push({ id: attempt.id, value: value as T });
        else failed.push(attempt.id);
      } catch {
        failed.push(attempt.id);
      }
    }),
  );

  if (!results.length) return null;

  // Order candidates by precedence so ties resolve predictably.
  results.sort(
    (a, b) =>
      attempts.findIndex((x) => x.id === a.id) -
      attempts.findIndex((x) => x.id === b.id),
  );

  let best = results[0];
  let bestAgreeing: string[] = [];
  for (const candidate of results) {
    const agreeing = results.filter((r) => agrees(r.value, candidate.value));
    if (agreeing.length > bestAgreeing.length) {
      best = candidate;
      bestAgreeing = agreeing.map((r) => r.id);
    }
  }

  const confirmedBy = bestAgreeing.filter((id) => id !== best.id);
  return {
    value: best.value,
    servedBy: best.id,
    failed,
    confirmedBy,
    corroborated: confirmedBy.length > 0,
  };
}

/**
 * Read a numeric field from a provider payload, tolerating the usual
 * spellings. Returns null when the field is missing or not finite.
 */
export function pickNumber(
  source: Record<string, unknown> | null | undefined,
  keys: string[],
): number | null {
  if (!source) return null;
  for (const key of keys) {
    const raw = source[key];
    const n = typeof raw === "string" ? Number(raw.replace(/,/g, "")) : raw;
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}
