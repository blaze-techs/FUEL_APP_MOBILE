import { describe, it, expect, vi, afterEach } from "vitest";
import { localDateISO, todayLocalISO } from "@/react-app/lib/dates";

describe("local date helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats a Date using the local calendar, zero padded", () => {
    expect(localDateISO(new Date(2026, 0, 5, 0, 30))).toBe("2026-01-05");
    expect(localDateISO(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("returns the local date just after local midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 0, 5)); // 00:05 local on 31 Oct
    expect(todayLocalISO()).toBe("2026-10-31");
  });
});
