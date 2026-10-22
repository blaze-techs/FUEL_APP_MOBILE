import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CATALOGUE_NEVER_SUBSTITUTES,
  PROVIDER_PRECEDENCE,
  mayServeCapability,
  providerForCapability,
  resolveProviderEnvKey,
} from "../react-app/config/provider-precedence";

const root = resolve(__dirname, "..", "..");

/**
 * Guard for the standing rule: when FuelPro already has a working provider for
 * a capability, keep using it. The public-apis catalogue is a discovery
 * directory and must never substitute a configured provider.
 *
 * These assertions are structural — they fail if a future change points a
 * capability at a catalogue counterpart, or if the authoritative provider is
 * removed from the code without updating the registry.
 */
describe("provider precedence — keep the existing API", () => {
  it("declares the rule explicitly", () => {
    expect(CATALOGUE_NEVER_SUBSTITUTES).toBe(true);
  });

  it("every capability names an authoritative provider that exists in the repo", () => {
    for (const entry of PROVIDER_PRECEDENCE) {
      expect(
        existsSync(resolve(root, entry.authoritative.module)),
        `${entry.capability}: ${entry.authoritative.module} must exist`,
      ).toBe(true);
      expect(entry.authoritative.id.length).toBeGreaterThan(0);
      expect(entry.policy).toBe("keep-existing");
    }
  });

  it("every declared fallback also exists in the repo", () => {
    for (const entry of PROVIDER_PRECEDENCE) {
      if (!entry.fallback) continue;
      expect(
        existsSync(resolve(root, entry.fallback.module)),
        `${entry.capability}: fallback ${entry.fallback.module} must exist`,
      ).toBe(true);
    }
  });

  it("no authoritative provider is a public-apis catalogue counterpart", () => {
    for (const entry of PROVIDER_PRECEDENCE) {
      const counterparts = entry.catalogueCounterparts.map((c) =>
        c.toLowerCase(),
      );
      const authId = entry.authoritative.id.toLowerCase();
      const authName = entry.authoritative.name.toLowerCase();
      for (const counterpart of counterparts) {
        expect(
          counterpart.includes(authId) || authId.includes(counterpart),
          `${entry.capability}: authoritative "${authId}" must not be a catalogue counterpart`,
        ).toBe(false);
        expect(
          authName.includes(counterpart),
          `${entry.capability}: authoritative name must not be a catalogue counterpart`,
        ).toBe(false);
      }
    }
  });

  it("records when the authoritative provider is itself catalogued (not a substitution)", () => {
    const overlapping = PROVIDER_PRECEDENCE.filter((e) => e.alsoInCatalogue);
    // exchangerate-api.com is genuinely listed in the public-apis catalogue.
    // The point is that FuelPro still calls the SAME provider it always did,
    // so this is recorded explicitly rather than being mistaken for a swap.
    expect(overlapping.map((e) => e.capability)).toContain("currency-fx");
    for (const entry of overlapping) {
      expect(
        mayServeCapability(entry.capability, entry.authoritative.id),
        `${entry.capability}: the same provider must remain permitted`,
      ).toBe(true);
    }
  });

  it("a configured authoritative provider is exclusive", () => {
    for (const entry of PROVIDER_PRECEDENCE) {
      // The authoritative id is always permitted for its own capability.
      expect(mayServeCapability(entry.capability, entry.authoritative.id)).toBe(
        true,
      );
      // An unrelated / catalogue provider is never permitted.
      expect(mayServeCapability(entry.capability, "some-catalogue-api")).toBe(
        false,
      );
      expect(mayServeCapability(entry.capability, "openai")).toBe(false);
    }
  });

  it("the declared fallback is only allowed when the provider is unconfigured", () => {
    for (const entry of PROVIDER_PRECEDENCE) {
      if (!entry.fallback) continue;
      const configured = resolveProviderEnvKey(entry.authoritative) !== null;
      const allowed = mayServeCapability(entry.capability, entry.fallback.id);
      // Under test env the keys are typically absent; assert the invariant
      // rather than a fixed value so the guard holds in both environments.
      expect(allowed).toBe(!configured);
    }
  });

  it("OCR keeps Gemini authoritative with on-device fallback", () => {
    const ocr = providerForCapability("ocr-document-vision");
    expect(ocr?.authoritative.id).toBe("gemini");
    expect(ocr?.authoritative.route).toBe("/api/gemini-ocr");
    expect(ocr?.fallback?.id).toBe("tesseract");
    // The on-device fallback must remain wired behind Gemini.
    const service = readFileSync(
      resolve(root, "src/react-app/lib/ocr-service.ts"),
      "utf8",
    );
    expect(service).toMatch(/geminiOcrDocument/);
    expect(service).toMatch(/localOcrImage/);
  });

  it("the assistant keeps Claude authoritative", () => {
    const assistant = providerForCapability("assistant-llm");
    expect(assistant?.authoritative.id).toBe("claude");
    expect(assistant?.authoritative.route).toBe("/api/claude");
    const handler = readFileSync(resolve(root, "api/claude.ts"), "utf8");
    expect(handler).toMatch(/api\.anthropic\.com/);
    expect(handler).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("the catalogue endpoint is not wired to serve any capability", () => {
    // /api/public-apis must stay a passive discovery route: nothing in the
    // app may consume it as a provider.
    const endpoint = readFileSync(resolve(root, "api/public-apis.ts"), "utf8");
    expect(endpoint).toMatch(/public-apis\/public-apis/);

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSafe(dir)) {
        const full = resolve(dir, name);
        if (name === "node_modules" || name === "dist" || name === ".git")
          continue;
        if (statIsDir(full)) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (full.endsWith("api/public-apis.ts")) continue;
        if (full.endsWith("provider-precedence.ts")) continue;
        if (full.endsWith("provider-precedence.test.ts")) continue;
        const source = readFileSync(full, "utf8");
        if (/["'`]\/api\/public-apis/.test(source)) offenders.push(full);
      }
    };
    walk(resolve(root, "src"));
    walk(resolve(root, "api"));
    expect(offenders, "no app code may call /api/public-apis").toEqual([]);
  });
});

function readdirSafe(dir: string): string[] {
  try {
     
    return require("node:fs").readdirSync(dir) as string[];
  } catch {
    return [];
  }
}

function statIsDir(path: string): boolean {
  try {
     
    return require("node:fs").statSync(path).isDirectory();
  } catch {
    return false;
  }
}
