import { describe, it, expect, vi, afterEach } from "vitest";
import { withAttemptTimeout } from "@/react-app/lib/cloud-storage-service";
import { isTransientError } from "@/react-app/lib/retry";

describe("cloud read attempt timeout", () => {
  afterEach(() => vi.useRealTimers());

  it("rejects a hung request instead of waiting forever", async () => {
    vi.useFakeTimers();
    const hung = new Promise<string>(() => {});
    const result = withAttemptTimeout(hung, 10_000);
    const assertion = expect(result).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
  });

  it("passes through a fast result and clears the timer", async () => {
    vi.useFakeTimers();
    await expect(
      withAttemptTimeout(Promise.resolve("ok"), 10_000),
    ).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is classified transient so withRetry/fallback handle it", () => {
    expect(isTransientError(new Error("network timeout after 10000ms"))).toBe(
      true,
    );
  });
});
