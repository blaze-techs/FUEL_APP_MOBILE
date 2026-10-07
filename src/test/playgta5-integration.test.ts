import { describe, it, expect } from "vitest";
import {
  PLAYGTA5_SNAPSHOT_URL,
  PLAYGTA5_ARCHIVED_LOGO,
  PLAYGTA5_WAYBACK_SCREENSHOT,
  PLAYGTA5_FINDINGS,
} from "@/react-app/services/GameCatalogService";

// Guards the reverse-engineered "playgta5.com" integration. The site was an
// unofficial GTA V WebAssembly port that is NOT playable in-app (dead origin,
// unarchived engine files, no cross-origin isolation, X-Frame-Options:
// SAMEORIGIN). These assertions keep the honest entry from drifting — e.g.
// nobody should "upgrade" it into an iframe embed that can never load.
describe("PlayGTA5 reverse-engineered integration", () => {
  it("points at the verified Wayback snapshot of the page", () => {
    expect(PLAYGTA5_SNAPSHOT_URL).toContain("web.archive.org");
    expect(PLAYGTA5_SNAPSHOT_URL).toContain("20261006055917");
    expect(PLAYGTA5_SNAPSHOT_URL).toContain("playgta5.com");
    // Never a bare live URL — the live origin 522s.
    expect(PLAYGTA5_SNAPSHOT_URL.startsWith("https://playgta5.com")).toBe(
      false,
    );
  });

  it("uses https preview assets from the archive", () => {
    for (const url of [PLAYGTA5_ARCHIVED_LOGO, PLAYGTA5_WAYBACK_SCREENSHOT]) {
      expect(url.startsWith("https://web.archive.org/")).toBe(true);
    }
  });

  it("documents the blocking findings (origin, engine, isolation, framing)", () => {
    const labels = PLAYGTA5_FINDINGS.map((f) => f.label.toLowerCase()).join(
      " ",
    );
    expect(labels).toContain("live origin");
    expect(labels).toContain("archived engine");
    expect(labels).toContain("cross-origin isolation");
    expect(labels).toContain("embedding");

    // Each blocking reason must be present and marked "block" so the UI can
    // render it honestly rather than implying the game plays.
    const blocked = PLAYGTA5_FINDINGS.filter((f) => f.state === "block");
    expect(blocked.length).toBeGreaterThanOrEqual(4);
    const blockText = blocked.map((f) => f.detail).join(" ");
    expect(blockText).toMatch(/522|unreachable/i);
    expect(blockText).toMatch(/wasm|game\.js|game\.wasm|not archived|404/i);
    expect(blockText).toMatch(/SharedArrayBuffer|COOP|COEP/i);
    expect(blockText).toMatch(/X-Frame-Options|SAMEORIGIN/i);
  });

  it("records the real architecture (what it actually was)", () => {
    const ok = PLAYGTA5_FINDINGS.filter((f) => f.state === "ok")
      .map((f) => f.detail)
      .join(" ");
    expect(ok).toMatch(/WebAssembly|WASM/i);
    expect(ok).toMatch(/worker/i);
  });
});
