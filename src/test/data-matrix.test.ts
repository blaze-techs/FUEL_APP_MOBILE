/**
 * data-matrix.test.ts — enforces the cross-tab data-sharing matrix.
 *
 * For every declared writer in DATA_MATRIX, this test reads the component
 * source and asserts it references at least one of the group's shared cloud
 * keys. If a refactor disconnects a writer from its shared key (the classic
 * "this sub-tab has its own disconnected state" regression), CI fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_MATRIX } from "@/react-app/lib/data-matrix";

const COMPONENTS_DIR = join(__dirname, "..", "react-app", "components");
const CONTEXT_DIR = join(__dirname, "..", "react-app", "context");
const LIB_DIR = join(__dirname, "..", "react-app", "lib");

function sourceOf(file: string): string {
  const compPath = join(COMPONENTS_DIR, file);
  const ctxPath = join(CONTEXT_DIR, file);
  if (existsSync(compPath)) return readFileSync(compPath, "utf8");
  if (existsSync(ctxPath)) return readFileSync(ctxPath, "utf8");
  return "";
}

function libSourceOf(fragment: string): string {
  const p = join(LIB_DIR, fragment);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

/** Maps a raw cloud key to every way it may be referenced in source:
 *  - the literal key ("price_history_data")
 *  - a CLOUD_KEYS alias ("tank_monitor_readings" -> CLOUD_KEYS.tankReadings)
 *  - an exported UPPER_SNAKE constant ("price_history_data" -> PRICE_HISTORY_KEY)
 */
function referencesKey(src: string, key: string): boolean {
  if (src.includes(`"${key}"`) || src.includes(`'${key}'`)) return true;
  const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (src.includes(`CLOUD_KEYS.${camel}`)) return true;
  const upper = key.toUpperCase();
  if (src.includes(upper)) return true;
  return false;
}

describe("data matrix — writers reference their shared keys", () => {
  for (const group of DATA_MATRIX) {
    describe(group.group + " / " + group.domain, () => {
      for (const writer of group.writers) {
        it(`${writer} references one of [${group.keys.join(", ")}]`, () => {
          const src = sourceOf(writer);
          expect(
            src.length,
            `${writer} not found in components/ or context/`,
          ).toBeGreaterThan(0);
          let referenced = group.keys.some((key) => referencesKey(src, key));
          // Some components reach the shared key through a helper module
          // (e.g. mpesa-integration-service) — then the component must import
          // that module AND the module must reference the key.
          if (!referenced && group.viaModule) {
            const mod = group.viaModule.replace(/\.ts$/, "");
            const importsModule = src.includes(mod);
            const modSrc = libSourceOf(group.viaModule);
            const moduleHasKey =
              modSrc.length > 0 &&
              group.keys.some((key) => referencesKey(modSrc, key));
            referenced = importsModule && moduleHasKey;
          }
          expect(
            referenced,
            `${writer} does not reference any of ${JSON.stringify(group.keys)} — is it disconnected from the ${group.group} matrix?`,
          ).toBe(true);
        });
      }
    });
  }
});

describe("data matrix — readers reference their shared keys", () => {
  for (const group of DATA_MATRIX) {
    describe(group.group + " / " + group.domain, () => {
      for (const reader of group.readers) {
        // Reader files may be components, context, or nested panel names
        // (e.g. "HistoryTable" is defined inside InventoryManagement.tsx) —
        // only enforce for files that exist as standalone modules.
        const path = join(COMPONENTS_DIR, reader);
        if (!existsSync(path) && !existsSync(join(CONTEXT_DIR, reader))) {
          it.skip(`${reader} (inline component — covered by host)`, () => {});
          continue;
        }
        it(`${reader} reads from the shared matrix`, () => {
          const src = sourceOf(reader);
          let referenced = group.keys.some((key) => referencesKey(src, key));
          // Readers commonly reach shared data through the domain hook
          // (useStationFuelTypes owns fuel_types_config) or the cloud layer —
          // accept those, or the via-module import, as proof of connection.
          if (!referenced) {
            referenced =
              (group.viaModule &&
                src.includes(group.viaModule.replace(/\.ts$/, ""))) ||
              src.includes("useStationFuelTypes") ||
              src.includes("useCloudKV") ||
              src.includes("cloudStorageService") ||
              src.includes("useFuel()") ||
              src.includes("useFuel(");
          }
          expect(
            referenced,
            `${reader} does not read from any of ${JSON.stringify(group.keys)} — is it disconnected from the ${group.group} matrix?`,
          ).toBe(true);
        });
      }
    });
  }
});

describe("data matrix — registry sanity", () => {
  it("every group has at least one key and one writer", () => {
    for (const g of DATA_MATRIX) {
      expect(g.keys.length, `${g.group} has no keys`).toBeGreaterThan(0);
      expect(g.writers.length, `${g.group} has no writers`).toBeGreaterThan(0);
    }
  });

  it("no duplicate keys across groups (each key has one home domain)", () => {
    const seen = new Map<string, string>();
    for (const g of DATA_MATRIX) {
      for (const k of g.keys) {
        // A key may appear in multiple groups only if intentional (documented
        // shared domains like products/inventory_transactions). Allow that,
        // but flag accidental typos where the same key is claimed by
        // unrelated groups.
        if (seen.has(k)) {
          // Known shared cross-group keys:
          const allowed = new Set([
            "mpesa_transactions",
            "products",
            "inventory_transactions",
          ]);
          expect(
            allowed.has(k),
            `key "${k}" is claimed by both "${seen.get(k)}" and "${g.group}"`,
          ).toBe(true);
        }
        seen.set(k, g.group);
      }
    }
  });
});
