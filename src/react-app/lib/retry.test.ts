import { describe, expect, it, vi } from "vitest";
import { isTransientError, withRetry } from "@/react-app/lib/retry";

describe("retry resilience", () => {
  it("classifies network, rate-limit and 5xx failures as transient", () => {
    expect(isTransientError(new Error("Failed to fetch"))).toBe(true);
    expect(isTransientError({ status: 429 })).toBe(true);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 400 })).toBe(false);
  });

  it("retries with bounded exponential backoff and eventually succeeds", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const promise = withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("network timeout");
        return "ok";
      },
      { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 100, jitter: false },
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(attempts).toBe(3);
    vi.useRealTimers();
  });

  it("does not retry permanent failures", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw { status: 401 };
        },
        { maxAttempts: 5 },
      ),
    ).rejects.toEqual({ status: 401 });
    expect(attempts).toBe(1);
  });
});
