import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SUBTAB_REGISTRY,
  SUBTAB_ENTRIES,
  SUBTAB_HOSTS,
  findSubTab,
  workspaceForHost,
} from "@/react-app/config/subtab-registry";
import {
  NAVIGATION_WORKSPACES,
  NAVIGATION_MODULE_TO_WORKSPACE,
} from "@/react-app/config/navigation-config";
import { SITE_SUBTABS } from "@/react-app/lib/site-search-index";

const COMPONENT_DIR = "src/react-app/components";

function componentSources(): Array<{ name: string; src: string }> {
  return readdirSync(COMPONENT_DIR)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({
      name: f,
      src: readFileSync(join(COMPONENT_DIR, f), "utf8"),
    }));
}

/**
 * The state variable a host wires to useSubTabDeepLink("host", setX) is the
 * authoritative list of ids that host accepts: every render branch is either
 * a literal comparison against it, or the tab's initial value (the default
 * view, which needs no explicit comparison).
 */
function acceptedIds(src: string): string[] | null {
  const m = src.match(/useSubTabDeepLink\(\s*"[\w-]+"\s*,\s*(set\w+)\s*\)/);
  if (!m) return null;
  const varName = m[1].slice(3, 4).toLowerCase() + m[1].slice(4);
  const compared = [
    ...src.matchAll(new RegExp(`\\b${varName}\\s*===\\s*"([\\w-]+)"`, "g")),
  ].map((x) => x[1]);
  const initial = [
    ...src.matchAll(
      new RegExp(
        `\\[${varName},\\s*${m[1]}\\]\\s*=\\s*useState[^)]*\\(\\s*"([\\w-]+)"`,
        "g",
      ),
    ),
  ].map((x) => x[1]);
  return [...new Set([...compared, ...initial])];
}

describe("sub-tab registry is the single source of truth", () => {
  const comps = componentSources();

  it("registers a host for every deep-link subscriber", () => {
    const subscribers: string[] = [];
    for (const { src } of comps) {
      const m = src.match(/useSubTabDeepLink\(\s*"([\w-]+)"/);
      if (m) subscribers.push(m[1]);
    }
    expect(subscribers.length).toBeGreaterThanOrEqual(12);
    for (const host of subscribers) {
      expect(SUBTAB_HOSTS).toContain(host);
    }
  });

  it("every declared id is actually accepted by its host component", () => {
    const problems: string[] = [];
    for (const { name, src } of comps) {
      const hosts = [...src.matchAll(/useSubTabDeepLink\(\s*"([\w-]+)"/g)].map(
        (m) => m[1],
      );
      if (hosts.length === 0) continue;
      const accepted = acceptedIds(src);
      for (const host of hosts) {
        const declared = findSubTabHost(host);
        if (!declared) continue;
        for (const subId of declared) {
          // A host may render its default branch without an explicit ===.
          if (accepted === null) continue;
          if (!accepted.includes(subId)) {
            problems.push(
              `${name}: declares "${subId}" for host "${host}" but never compares the deep-link state === "${subId}"`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("every id a host accepts is declared (no undeclared internal views)", () => {
    const problems: string[] = [];
    for (const { name, src } of comps) {
      const hosts = [...src.matchAll(/useSubTabDeepLink\(\s*"([\w-]+)"/g)].map(
        (m) => m[1],
      );
      const accepted = acceptedIds(src);
      if (hosts.length === 0 || !accepted) continue;
      const host = hosts[0];
      const declared = findSubTabHost(host) ?? [];
      for (const id of accepted) {
        if (!declared.includes(id))
          problems.push(
            `${name}: accepts "${id}" (host ${host}) but it is not declared`,
          );
      }
    }
    expect(problems).toEqual([]);
  });

  it("covers the inline button-row hosts that had no deep link before", () => {
    for (const host of [
      "suppliers",
      "expenses",
      "payroll",
      "communication",
      "integration",
      "data",
    ]) {
      expect(SUBTAB_HOSTS, `missing host ${host}`).toContain(host);
    }
  });

  it("Compliance is searchable (it previously had zero index entries)", () => {
    const compliance = SUBTAB_REGISTRY.find((h) => h.hostTab === "regional");
    expect(compliance).toBeDefined();
    expect(compliance!.subTabs.length).toBeGreaterThanOrEqual(3);
    expect(compliance!.subTabs.map((s) => s.id)).toEqual(
      expect.arrayContaining(["rules", "documents", "safety"]),
    );
  });

  it("has no duplicate ids within a host", () => {
    for (const host of SUBTAB_REGISTRY) {
      const ids = host.subTabs.map((s) => s.id);
      expect(new Set(ids).size, `duplicate ids in ${host.hostTab}`).toBe(
        ids.length,
      );
    }
  });

  it("every host resolves to a real workspace", () => {
    for (const host of SUBTAB_HOSTS) {
      expect(workspaceForHost(host), `no workspace for ${host}`).toBeDefined();
    }
  });

  it("every host tab exists in the FuelContext tab registry", () => {
    const fuel = readFileSync("src/react-app/context/FuelContext.tsx", "utf8");
    const block = fuel
      .split("tabConfigurations: [", 2)[1]
      .split("\n  ],", 1)[0];
    const registered = new Set(
      [...block.matchAll(/id: "([\w-]+)"/g)].map((m) => m[1]),
    );
    for (const host of SUBTAB_HOSTS) {
      expect(registered, `${host} is not a registered top-level tab`).toContain(
        host,
      );
    }
  });

  it("keeps workspace module lists free of duplicates and unknown modules", () => {
    const fuel = readFileSync("src/react-app/context/FuelContext.tsx", "utf8");
    const block = fuel
      .split("tabConfigurations: [", 2)[1]
      .split("\n  ],", 1)[0];
    const registered = new Set(
      [...block.matchAll(/id: "([\w-]+)"/g)].map((m) => m[1]),
    );
    const seen = new Set<string>();
    for (const ws of NAVIGATION_WORKSPACES) {
      expect(new Set(ws.modules).size).toBe(ws.modules.length);
      for (const m of ws.modules) {
        expect(
          registered,
          `${m} in workspace ${ws.id} is not registered`,
        ).toContain(m);
        seen.add(m);
      }
    }
  });

  it("every registered tab appears in exactly one workspace", () => {
    const fuel = readFileSync("src/react-app/context/FuelContext.tsx", "utf8");
    const block = fuel
      .split("tabConfigurations: [", 2)[1]
      .split("\n  ],", 1)[0];
    const registered = [...block.matchAll(/id: "([\w-]+)"/g)].map((m) => m[1]);
    const missing = registered.filter(
      (id) => !NAVIGATION_MODULE_TO_WORKSPACE[id],
    );
    expect(
      missing,
      "registered tabs with no workspace (unreachable from the workspace nav)",
    ).toEqual([]);
  });

  it("SUBTAB_ENTRIES tags every entry with its host", () => {
    expect(SUBTAB_ENTRIES.length).toBe(
      SUBTAB_REGISTRY.reduce((n, h) => n + h.subTabs.length, 0),
    );
    for (const e of SUBTAB_ENTRIES) expect(SUBTAB_HOSTS).toContain(e.hostTab);
  });

  it("the search index covers exactly the registry (no drift, no gaps)", () => {
    const indexed = new Set(SITE_SUBTABS.map((e) => `${e.hostTab}:${e.subId}`));
    const defined = new Set(SUBTAB_ENTRIES.map((e) => `${e.hostTab}:${e.id}`));
    expect([...defined].filter((k) => !indexed.has(k))).toEqual([]);
    expect([...indexed].filter((k) => !defined.has(k))).toEqual([]);
    // Every searchable sub-tab needs a human label to show in results.
    for (const e of SITE_SUBTABS) expect(e.label).toBeTruthy();
  });

  it("every searchable hostTab is a registered top-level tab", () => {
    const fuel = readFileSync("src/react-app/context/FuelContext.tsx", "utf8");
    const block = fuel
      .split("tabConfigurations: [", 2)[1]
      .split("\n  ],", 1)[0];
    const registered = new Set(
      [...block.matchAll(/id: "([\w-]+)"/g)].map((m) => m[1]),
    );
    for (const e of SITE_SUBTABS) expect(registered).toContain(e.hostTab);
  });

  it("findSubTab resolves registered pairs and rejects unknown ones", () => {
    expect(findSubTab("news", "movies")?.label).toBe("Movies");
    expect(findSubTab("regional", "safety")?.label).toBe("Safety & HSSE");
    expect(findSubTab("news", "not-a-tab")).toBeUndefined();
    expect(findSubTab("not-a-host", "movies")).toBeUndefined();
  });

  it("tab orders are unique and densely sequential", () => {
    const fuel = readFileSync("src/react-app/context/FuelContext.tsx", "utf8");
    const block = fuel
      .split("tabConfigurations: [", 2)[1]
      .split("\n  ],", 1)[0];
    const orders = [...block.matchAll(/order: (\d+)/g)].map((m) =>
      Number(m[1]),
    );
    const ids = [...block.matchAll(/id: "([\w-]+)"/g)].map((m) => m[1]);
    expect(orders.length).toBe(ids.length);
    expect(
      new Set(orders).size,
      "duplicate order values make tab ordering ambiguous",
    ).toBe(orders.length);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

function findSubTabHost(host: string): string[] | undefined {
  return SUBTAB_REGISTRY.find((h) => h.hostTab === host)?.subTabs.map(
    (s) => s.id,
  );
}
