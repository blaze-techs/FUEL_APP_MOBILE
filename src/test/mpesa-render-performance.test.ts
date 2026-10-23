import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  filterInflows,
  inflowViewKey,
} from "../react-app/lib/mpesa-inflow-filter";
import { useDebouncedValue } from "../react-app/hooks/useDebouncedValue";
import { useWindowedList } from "../react-app/hooks/useWindowedList";

const root = resolve(__dirname, "..", "..");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Real render harness — no mocking, the hooks run for real. */
function renderHook<T>(useHook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let instance: Root;
  let current: T;
  const Probe = () => {
    current = useHook();
    return null;
  };
  act(() => {
    instance = createRoot(container);
    instance.render(createElement(Probe as () => ReactNode));
  });
  return {
    get current() {
      return current;
    },
    rerender() {
      act(() => {
        instance.render(createElement(Probe as () => ReactNode));
      });
    },
    unmount() {
      act(() => instance.unmount());
      container.remove();
    },
  };
}

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  details: "254712345678 - Jane Wanjiru",
  receipt: "UJE48AXQFY",
  date: "2026-10-14",
  time: "09:15:22",
  paidIn: 4000,
  balance: 20832.75,
  ...over,
});

describe("filterInflows", () => {
  it("returns the same array reference when there is no query", () => {
    // A stable reference is what keeps the caller's memo (and an expanded
    // window) from being invalidated by an unrelated render.
    const rows = [row(), row()];
    expect(filterInflows(rows, "")).toBe(rows);
    expect(filterInflows(rows, "   ")).toBe(rows);
  });

  it("matches across every visible column", () => {
    const rows = [
      row({ details: "ACME Ltd", receipt: "AAA111", paidIn: 111, balance: 1 }),
      row({
        details: "Beta Traders",
        receipt: "BBB222",
        date: "2026-01-02",
        paidIn: 222,
        balance: 2,
      }),
    ];
    expect(filterInflows(rows, "acme")).toHaveLength(1);
    expect(filterInflows(rows, "bbb222")).toHaveLength(1);
    expect(filterInflows(rows, "2026-01-02")).toHaveLength(1);
    expect(filterInflows(rows, "222")).toHaveLength(1); // paidIn
    expect(filterInflows(rows, "nobody")).toHaveLength(0);
  });

  it("is case-insensitive and tolerates missing fields", () => {
    const rows = [row({ details: "", receipt: "", date: "", time: "" })];
    expect(() => filterInflows(rows, "x")).not.toThrow();
    expect(filterInflows(rows, "4000")).toHaveLength(1);
  });
});

describe("inflowViewKey", () => {
  it("changes for a new query or a new range filter", () => {
    expect(inflowViewKey("", null)).not.toBe(inflowViewKey("abc", null));
    expect(inflowViewKey("", null)).not.toBe(inflowViewKey("", [row()]));
  });

  it("is stable for an equivalent query (so the window does not reset)", () => {
    expect(inflowViewKey("Acme", null)).toBe(inflowViewKey("  acme  ", null));
  });
});

describe("useWindowedList", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("mounts only the first page, then extends on demand", () => {
    const h = renderHook(() => useWindowedList(many(5000), "k", 200));
    expect(h.current.visible).toHaveLength(200);
    expect(h.current.total).toBe(5000);
    expect(h.current.hasMore).toBe(true);

    act(() => h.current.loadMore());
    expect(h.current.visible).toHaveLength(400);
    h.unmount();
  });

  it("does not mount more rows than exist", () => {
    const h = renderHook(() => useWindowedList(many(3), "k", 200));
    expect(h.current.visible).toHaveLength(3);
    expect(h.current.hasMore).toBe(false);
    h.unmount();
  });

  it("resets the window when the reset key changes (new search/filter)", () => {
    const data = many(1000);
    let key = "a";
    // `key` is read on every render, so changing it and re-rendering exercises
    // the real reset path rather than a fresh mount.
    const h = renderHook(() => useWindowedList(data, key, 200));
    act(() => h.current.loadMore());
    expect(h.current.visible).toHaveLength(400);

    act(() => {
      key = "b";
    });
    h.rerender();
    expect(h.current.visible).toHaveLength(200);
    h.unmount();
  });

  it("clamps when the list shrinks (e.g. Clear All) instead of showing gaps", () => {
    const h = renderHook(() => useWindowedList(many(300), "k", 200));
    act(() => h.current.loadMore());
    expect(h.current.visible).toHaveLength(300);
    expect(h.current.hasMore).toBe(false);
    h.unmount();
  });
});

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the first value immediately, then settles after the delay", () => {
    const h = renderHook(() => useDebouncedValue("a", 200));
    expect(h.current).toBe("a");
    h.unmount();
  });

  it("debounces a fast burst down to the final value", () => {
    let set: (v: string) => void = () => {};
    const h = renderHook(() => {
      const [v, sv] = useState("a");
      set = sv;
      return useDebouncedValue(v, 200);
    });
    expect(h.current).toBe("a");

    act(() => set("ab"));
    act(() => set("abc"));
    act(() => set("abcd"));
    // Not yet applied — the timer has not elapsed.
    expect(h.current).toBe("a");

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(h.current).toBe("abcd");
    h.unmount();
  });
});

describe("MPESAAnalyzer wiring (regression guards)", () => {
  const src = () =>
    readFileSync(
      resolve(root, "src/react-app/components/MPESAAnalyzer.tsx"),
      "utf8",
    );

  it("windows both tables instead of mapping every record", () => {
    const s = src();
    expect(s).toMatch(/useWindowedList\(/);
    expect(s).toMatch(/inflowList\.visible\.map\(/);
    expect(s).toMatch(/excludedList\.visible\.map\(/);
    // The unbounded forms must not come back.
    expect(s).not.toMatch(/\{filtered\.map\(/);
    expect(s).not.toMatch(/stats\.cleanRevenue\.excludedRecords\.map\(/);
  });

  it("memoises the filter instead of recomputing it per render", () => {
    const s = src();
    expect(s).toMatch(/useMemo\(\s*\(\)\s*=>\s*filterInflows\(/);
    // The old inline IIFE must be gone.
    expect(s).not.toMatch(/const filtered = \(\(\) => \{/);
  });

  it("keeps the search box instant by filtering on a debounced value", () => {
    expect(src()).toMatch(/useDebouncedValue\(searchTerm/);
  });

  it("restores from the shared store once, not on every realtime push", () => {
    // Without the guard, each realtime frame re-ran the reconcile and then
    // appended a progress line — which re-rendered and re-triggered it.
    const s = src();
    expect(s).toMatch(/restoredOnceRef/);
    expect(s).toMatch(/if \(restoredOnceRef\.current\) return;/);
  });
});
