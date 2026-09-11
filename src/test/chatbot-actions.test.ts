/**
 * chatbot-actions tests — the secure action layer behind the AI assistant.
 * Covers daily revenue computation (pump + POS, no double counting),
 * trend analysis, sales forecasting, and safe arithmetic evaluation.
 */

import { describe, it, expect } from "vitest";
import {
  entryRevenue,
  dailySeries,
  analyzeSalesTrend,
  forecastSales,
  evalArithmetic,
  buildSummaryText,
} from "@/react-app/lib/chatbot-actions";

function makeState(salesHistory: Record<string, any>, extra: any = {}) {
  return {
    salesHistory,
    companyData: { name: "Test Station", currency: "KES" },
    deliveryTracker: { deliveries: [] },
    invoices: [],
    employees: [],
    ...extra,
  };
}

describe("entryRevenue", () => {
  it("sums pump sales across legacy + per-type pumps", () => {
    const entry = {
      pmsPumps: [{ salesKsh: 1000 }],
      agoPumps: [{ salesKsh: 500 }],
      fuelPumpsByType: { kerosene: [{ salesKsh: 200 }] },
    };
    expect(entryRevenue(entry)).toBe(1700);
  });

  it("adds POS sales via byTypeAmount without double counting", () => {
    const entry = {
      pmsPumps: [{ salesKsh: 100 }],
      posSales: { pmsAmount: 50, byTypeAmount: { petrol: 50, lpg: 30 } },
    };
    // byTypeAmount is canonical when present (50+30), pmsAmount ignored
    expect(entryRevenue(entry)).toBe(180);
  });

  it("falls back to pmsAmount+agoAmount when byTypeAmount is empty", () => {
    const entry = { posSales: { pmsAmount: 40, agoAmount: 60 } };
    expect(entryRevenue(entry)).toBe(100);
  });

  it("returns 0 for an empty entry", () => {
    expect(entryRevenue({})).toBe(0);
  });
});

describe("dailySeries + analyzeSalesTrend", () => {
  const history = {
    "2026-08-01_day": {
      date: "2026-08-01",
      pmsPumps: [{ salesKsh: 1000, salesL: 10 }],
      expenses: [{ amount: 100 }],
    },
    "2026-08-02_day": {
      date: "2026-08-02",
      pmsPumps: [{ salesKsh: 2000, salesL: 20 }],
      expenses: [],
    },
    "2026-08-03_day": {
      date: "2026-08-03",
      pmsPumps: [{ salesKsh: 3000, salesL: 30 }],
      expenses: [{ amount: 50 }],
    },
  };

  it("builds a sorted daily series", () => {
    const series = dailySeries(makeState(history));
    expect(series).toHaveLength(3);
    expect(series[0].revenue).toBe(1000);
    expect(series[2].revenue).toBe(3000);
    expect(series[2].litres).toBe(30);
  });

  it("reports totals, best and worst days", () => {
    const out = analyzeSalesTrend(makeState(history));
    expect(out).toContain("Total Revenue");
    expect(out).toContain("6,000");
    expect(out).toContain("Best day:** 2026-08-03");
    expect(out).toContain("Slowest day:** 2026-08-01");
  });

  it("prompts for data when there is no history", () => {
    expect(analyzeSalesTrend(makeState({}))).toContain("No sales history");
  });
});

describe("forecastSales", () => {
  it("projects growth from an increasing series", () => {
    const history: Record<string, any> = {};
    for (let i = 1; i <= 7; i++) {
      history[`2026-08-0${i}_day`] = {
        date: `2026-08-0${i}`,
        pmsPumps: [{ salesKsh: i * 1000, salesL: i * 10 }],
      };
    }
    const out = forecastSales(makeState(history), 7);
    expect(out).toContain("Sales Forecast");
    expect(out).toContain("growing");
    expect(out).toContain("Projected next day");
  });

  it("refuses to forecast with fewer than 3 days", () => {
    const history = {
      "2026-08-01_day": { pmsPumps: [{ salesKsh: 100 }] },
    };
    expect(forecastSales(makeState(history))).toContain("at least 3 days");
  });
});

describe("evalArithmetic", () => {
  it("evaluates plain arithmetic", () => {
    expect(evalArithmetic("25*4")).toBe(100);
    expect(evalArithmetic("10+5/5")).toBe(11);
    expect(evalArithmetic("(2+3)*4")).toBe(20);
  });

  it("rejects non-arithmetic input", () => {
    expect(evalArithmetic("alert(1)")).toBeNull();
    expect(evalArithmetic("abc+1")).toBeNull();
    expect(evalArithmetic("")).toBeNull();
  });
});

describe("buildSummaryText", () => {
  it("includes key business figures", () => {
    const state = makeState(
      {
        "2026-08-01_day": {
          date: "2026-08-01",
          pmsPumps: [{ salesKsh: 5000, salesL: 50 }],
          expenses: [{ amount: 200 }],
        },
      },
      {
        deliveryTracker: { deliveries: [{ debt: 750 }] },
        invoices: [{ id: 1 }],
        employees: [{ id: 1 }, { id: 2 }],
      },
    );
    const text = buildSummaryText(state);
    expect(text).toContain("Test Station");
    expect(text).toContain("5,000");
    expect(text).toContain("Outstanding debt");
    expect(text).toContain("750");
    expect(text).toContain("Employees: 2");
  });
});
