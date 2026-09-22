import { describe, it, expect } from "vitest";
import {
  buildPinPlan,
  buildCommonPinList,
  contextualPins,
  pinPlanSize,
} from "@/react-app/lib/pdf-pin-plan";

describe("pin plan ordering", () => {
  it("puts known passwords first, then context, then common, then 4/5/6", () => {
    const plan = buildPinPlan({
      filename: "MPESA_Statement_2026-09-22_to_2026-09-22_578590.pdf",
      known: ["", "647356"],
    });
    expect(plan[0].label).toBe("known passwords");
    expect(plan[0].literal).toEqual(["", "647356"]);
    expect(plan[1].label).toBe("statement details");
    expect(plan[2].label).toBe("common PINs");
    expect(plan.filter((p) => p.digits > 0).map((p) => p.digits)).toEqual([
      4, 5, 6,
    ]);
  });

  it("is monotonic in cost: exhaustive widths ascend", () => {
    const plan = buildPinPlan();
    const widths = plan.filter((p) => p.digits > 0).map((p) => p.digits);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    // Whole-space sizes are strictly increasing per width (10^k).
    const sizes = plan.filter((p) => p.digits > 0).map((p) => p.end - p.start);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it("never lets the big 6-digit space precede the cheap spaces", () => {
    const plan = buildPinPlan();
    const idx6 = plan.findIndex((p) => p.digits === 6);
    const idx4 = plan.findIndex((p) => p.digits === 4);
    const idx5 = plan.findIndex((p) => p.digits === 5);
    expect(idx4).toBeLessThan(idx6);
    expect(idx5).toBeLessThan(idx6);
  });

  it("respects min/max digit bounds", () => {
    const plan = buildPinPlan({ minDigits: 6, maxDigits: 6 });
    expect(plan.filter((p) => p.digits > 0).map((p) => p.digits)).toEqual([6]);
  });
});

describe("contextual pins", () => {
  it("derives the till number and the period from the statement filename", () => {
    const c = contextualPins(
      "MPESA_Statement_2026-09-22_to_2026-09-22_578590.pdf",
    );
    expect(c).toContain("578590");
    expect(c).toContain("20260922");
    expect(c).not.toContain("647356"); // the PIN is not in the filename
  });

  it("derives nothing from an unrelated filename", () => {
    expect(contextualPins("scan.pdf")).toEqual([]);
  });
});

describe("common pin hotlist", () => {
  it("contains the classics and is deduped", () => {
    const list = buildCommonPinList();
    expect(list).toContain("123456");
    expect(list).toContain("1234");
    expect(list).toContain("0000");
    expect(list).toContain("2026");
    expect(new Set(list).size).toBe(list.length);
  });

  it("stays small enough to be effectively instant", () => {
    // Anything much larger than this would slow the first tier down; the whole
    // point is that the hotlist costs microseconds.
    expect(buildCommonPinList().length).toBeLessThan(600);
  });
});

describe("plan size", () => {
  it("sums literal + numeric blocks", () => {
    const plan = [
      { digits: 0, start: 0, end: 0, literal: ["a", "b", "c"], label: "x" },
      { digits: 4, start: 0, end: 10000, label: "4" },
    ];
    expect(pinPlanSize(plan)).toBe(3 + 10000);
  });

  it("total plan stays within a bounded, honest budget", () => {
    const plan = buildPinPlan({ filename: "statement_578590.pdf" });
    const n = pinPlanSize(plan);
    // 4-digit (10k) + 5-digit (90k) + 6-digit (900k) + small literal blocks.
    expect(n).toBeGreaterThan(1_000_000);
    expect(n).toBeLessThan(1_020_000);
  });
});
