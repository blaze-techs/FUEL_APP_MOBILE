import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  SUPPORT_CONTACT,
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  telHref,
  mailtoHref,
} from "@/react-app/config/support-contact";

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");

/** Walk src/ and return every .ts/.tsx file path (excluding tests + config). */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "test" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("canonical support contact", () => {
  it("exposes the canonical support email + phone", () => {
    expect(SUPPORT_EMAIL).toBe("support@fuelpro.com");
    expect(SUPPORT_PHONE).toBeTruthy();
    expect(SUPPORT_CONTACT.email).toBe(SUPPORT_EMAIL);
    expect(SUPPORT_CONTACT.phone).toBe(SUPPORT_PHONE);
  });

  it("builds a valid tel: URI (digits only, leading + kept)", () => {
    expect(telHref("+254 700 123 456")).toBe("tel:+254700123456");
    expect(telHref("(020) 123-4567")).toBe("tel:0201234567");
    // No telephony target → empty string so callers hide the control
    expect(telHref("")).toBe("");
    expect(telHref("not a number")).toBe("");
  });

  it("builds a valid mailto: URI, with an encoded subject when given", () => {
    expect(mailtoHref()).toBe("mailto:support@fuelpro.com");
    expect(mailtoHref("FuelPro Support Request")).toBe(
      "mailto:support@fuelpro.com?subject=FuelPro%20Support%20Request",
    );
    expect(SUPPORT_CONTACT.emailHref).toBe("mailto:support@fuelpro.com");
  });

  it("produces a tel href matching the configured phone", () => {
    expect(SUPPORT_CONTACT.phoneHref).toBe(telHref(SUPPORT_PHONE));
  });

  // Regression guard: a hardcoded support address outside the canonical config
  // is exactly the "duplicate support address" drift the audit calls out.
  it("has NO hardcoded support address outside the canonical config", () => {
    const CANONICAL = "src/react-app/config/support-contact.ts";
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(REPO_ROOT, file).split("\\").join("/");
      if (rel === CANONICAL) continue;
      const text = readFileSync(file, "utf8");
      if (text.includes("support@fuelpro.")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
