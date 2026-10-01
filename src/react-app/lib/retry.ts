/**
 * FuelPro transient-failure resilience.
 *
 * Retries only errors that are plausibly transient (network failures, timeouts,
 * rate limits and 5xx responses). Uses exponential backoff with full jitter,
 * honors Retry-After when present, and caps total attempts/delay so a broken
 * dependency never creates an infinite retry loop.
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULTS = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
};

function getStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  const direct = e.status ?? e.statusCode;
  if (typeof direct === "number") return direct;
  const context = e.context;
  if (context && typeof context === "object") {
    const status = (context as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return null;
}

function getMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

export function isTransientError(error: unknown): boolean {
  const status = getStatus(error);
  if (status === 408 || status === 425 || status === 429) return true;
  if (status != null && status >= 500 && status <= 599) return true;

  const message = getMessage(error).toLowerCase();
  return /network|failed to fetch|fetch failed|timeout|timed out|timedout|econnreset|econnrefused|enotfound|socket|temporar|connection reset|connection closed|service unavailable|bad gateway|gateway timeout|rate limit|too many requests/i.test(
    message,
  );
}

function retryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  const candidates = [e.retryAfter, e.retry_after];
  const context = e.context;
  if (context && typeof context === "object") {
    const headers = (context as Record<string, unknown>).headers;
    if (headers && typeof headers === "object") {
      const h = headers as Record<string, unknown>;
      candidates.push(h["retry-after"], h["Retry-After"]);
    }
  }
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.min(value * 1000, 60_000));
    }
    if (typeof value === "string") {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 60_000));
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 60_000));
    }
  }
  return null;
}

function delayFor(attempt: number, options: Required<Pick<RetryOptions, "baseDelayMs" | "maxDelayMs">>): number {
  const exponential = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  // Full jitter prevents a fleet of tabs/devices from retrying together.
  return Math.floor(Math.random() * (exponential + 1));
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULTS.maxAttempts);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULTS.baseDelayMs);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULTS.maxDelayMs);
  const shouldRetry = options.shouldRetry ?? ((error: unknown) => isTransientError(error));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) throw error;

      const retryAfter = retryAfterMs(error);
      const delayMs = retryAfter ?? delayFor(attempt, { baseDelayMs, maxDelayMs });
      try {
        options.onRetry?.(error, attempt, delayMs);
      } catch {
        // Diagnostics must never break the retry loop.
      }
      await sleep(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operation failed after retries.");
}
