import { describe, expect, it } from "vitest";
import {
  getDuePriceSchedules,
  isValidFutureSchedule,
} from "@/react-app/lib/price-schedule";
import type { PriceSchedule } from "@/react-app/lib/forecourt-features";

const base: PriceSchedule = {
  id: "s1",
  fuelType: "Diesel",
  label: "Diesel",
  price: 225,
  effectiveOn: "2026-09-20T06:00:00.000Z",
  status: "pending",
  createdAt: "2026-09-19T05:00:00.000Z",
  verificationConfirmedAt: "2026-09-19T05:01:00.000Z",
};

describe("price scheduling integrity", () => {
  it("finds every due schedule, not only the first one", () => {
    const now = new Date("2026-09-20T07:00:00.000Z");
    expect(
      getDuePriceSchedules(
        [base, { ...base, id: "s2", effectiveOn: "2026-09-20T06:30:00.000Z" }],
        now,
      ).map((s) => s.id),
    ).toEqual(["s1", "s2"]);
  });

  it("ignores unconfirmed and malformed schedules", () => {
    const now = new Date("2026-09-20T07:00:00.000Z");
    expect(
      getDuePriceSchedules(
        [
          { ...base, id: "bad", effectiveOn: "not-a-date" },
          { ...base, id: "u", verificationConfirmedAt: undefined },
        ],
        now,
      ),
    ).toHaveLength(0);
  });

  it("accepts only future valid dates for new schedules", () => {
    const now = new Date("2026-09-20T07:00:00.000Z");
    expect(isValidFutureSchedule("2026-09-20T08:00:00.000Z", now)).toBe(true);
    expect(isValidFutureSchedule("2026-09-20T07:00:00.000Z", now)).toBe(false);
    expect(isValidFutureSchedule("bad", now)).toBe(false);
  });
});
