import { describe, it, expect } from "vitest";
import {
  sanitizeTabConfigs,
  tabOrderIsCustomized,
  type TabConfiguration,
} from "@/react-app/context/FuelContext";
import { NAVIGATION_WORKSPACES } from "@/react-app/config/navigation-config";

const defaults = (): TabConfiguration[] => sanitizeTabConfigs(undefined);

describe("tab order and rename persistence", () => {
  it("built-in defaults are not treated as customised", () => {
    expect(tabOrderIsCustomized(defaults())).toBe(false);
  });

  it("a saved config that still matches the defaults is not customised", () => {
    expect(tabOrderIsCustomized(sanitizeTabConfigs(defaults()))).toBe(false);
  });

  it("detects a reorder made in the Tab Manager", () => {
    const tabs = defaults();
    const [a, b] = [tabs[1], tabs[2]];
    const swapped = tabs.map((t) =>
      t.id === a.id
        ? { ...t, order: b.order }
        : t.id === b.id
          ? { ...t, order: a.order }
          : t,
    );
    expect(tabOrderIsCustomized(swapped)).toBe(true);
    // and the saved order survives a reload
    const reloaded = sanitizeTabConfigs(swapped);
    expect(reloaded.find((t) => t.id === a.id)?.order).toBe(b.order);
  });

  it("keeps a user rename across reload", () => {
    const saved = defaults().map((t) =>
      t.id === "sales" ? { ...t, label: "Pump Readings" } : t,
    );
    expect(sanitizeTabConfigs(saved).find((t) => t.id === "sales")?.label).toBe(
      "Pump Readings",
    );
  });

  it("does not let a stale copy of an old default label override a renamed default", () => {
    // delivery's default label differs from its originalLabel by design
    const current = defaults().find((t) => t.id === "delivery")!;
    expect(current.label).not.toBe(current.originalLabel);
    const stale = defaults().map((t) =>
      t.id === "delivery" ? { ...t, label: t.originalLabel } : t,
    );
    expect(
      sanitizeTabConfigs(stale).find((t) => t.id === "delivery")?.label,
    ).toBe(current.label);
  });

  it("ignores saved labels from blobs that predate originalLabel", () => {
    const saved = defaults().map((t) => {
      const { originalLabel: _o, ...rest } = t;
      return t.id === "sales"
        ? ({ ...rest, label: "Old Name" } as unknown as TabConfiguration)
        : t;
    });
    expect(sanitizeTabConfigs(saved).find((t) => t.id === "sales")?.label).toBe(
      defaults().find((t) => t.id === "sales")?.label,
    );
  });
});

describe("workspace landing modules follow the daily-first principle", () => {
  const first = (id: string) =>
    NAVIGATION_WORKSPACES.find((w) => w.id === id)!.modules[0];
  it("Forecourt lands on Point of Sale", () =>
    expect(first("forecourt")).toBe("pos"));
  it("Stock & Supply lands on Fuel Offloading", () =>
    expect(first("stock-supply")).toBe("offloading"));
  it("Sales & Payments lands on Invoice", () =>
    expect(first("sales-payments")).toBe("invoice"));
});
