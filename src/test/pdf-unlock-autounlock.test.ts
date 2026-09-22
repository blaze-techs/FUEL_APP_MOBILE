import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { tryUnlockCandidates } from "@/react-app/lib/pdf-unlock";

const PDF = "/workspace/MPESA_Statement_2026-09-22_to_2026-09-22_578590.pdf";
const has = existsSync(PDF);

describe.runIf(has)("REGRESSION: full auto-unlock on the real fixture", () => {
  it("recovers 647356 with no password supplied, and never a wrong pin", async () => {
    const bytes = new Uint8Array(readFileSync(PDF));
    const seen: number[] = [];
    const t0 = Date.now();
    const res = await tryUnlockCandidates(bytes, {
      filename: "MPESA_Statement_2026-09-22_to_2026-09-22_578590.pdf",
      scanPins: true,
      onScanProgress: (tried) => seen.push(tried),
    });
    const ms = Date.now() - t0;
    console.log("auto-unlock result", res, "ms", ms);
    expect(res).not.toBeNull();
    expect(res!.password).toBe("647356");
    // progress must be reported so the UI can show a percentage
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBeGreaterThan(0);
  }, 180000);

  it("still returns an explicit correct password instantly (no scan)", async () => {
    const bytes = new Uint8Array(readFileSync(PDF));
    const t0 = Date.now();
    const res = await tryUnlockCandidates(bytes, {
      filename: "statement.pdf",
      extra: ["647356"],
      scanPins: false,
    });
    console.log("explicit result", res, "ms", Date.now() - t0);
    expect(res!.password).toBe("647356");
  }, 30000);
});
