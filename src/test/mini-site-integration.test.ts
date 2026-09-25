/**
 * Integration contract for the mini site inside other tabs.
 *
 * The publishing logic is covered by mini-site.test.ts. These tests pin the
 * *wiring*: that the link actually reaches the places a customer is talked to
 * (credit statement, invoice, broadcast, Customers tab), and — most
 * importantly — that nothing is offered when nothing is published. A link that
 * 404s is worse than no link, so that case is asserted directly rather than
 * assumed from the component's code.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  miniSiteShareLine,
  DEFAULT_MINI_SITE_CONFIG,
} from "@/react-app/lib/mini-site-service";

const STORAGE_KEY = "fuelpro_mini_site_v1";

function readSrc(path: string): string {
  return readFileSync(path, "utf8");
}

function seedConfig(stationId: string | undefined, patch: object): void {
  const key = stationId ? `${STORAGE_KEY}_${stationId}` : STORAGE_KEY;
  localStorage.setItem(
    key,
    JSON.stringify({ ...DEFAULT_MINI_SITE_CONFIG, ...patch }),
  );
}

describe("mini site share line (the 'one message, not two' contract)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns nothing when the station has not published a site", () => {
    const stationId = "station-unpublished";
    seedConfig(stationId, { slug: "acme-fuel", published: false });
    // A dangling "Prices and hours: " with no URL would be worse than silence.
    expect(miniSiteShareLine(stationId)).toBe("");
  });

  it("returns the public link once published", () => {
    const stationId = "station-published";
    seedConfig(stationId, { slug: "acme-fuel", published: true });
    const line = miniSiteShareLine(stationId, "Prices and hours:");
    expect(line).toContain("/site/acme-fuel");
    expect(line.startsWith("Prices and hours:")).toBe(true);
  });

  it("scopes the link to the station it was asked about", () => {
    seedConfig("station-a", { slug: "station-a-site", published: true });
    seedConfig("station-b", { slug: "station-b-site", published: true });
    // A shared device must never hand out another station's public page.
    expect(miniSiteShareLine("station-a")).toContain("station-a-site");
    expect(miniSiteShareLine("station-a")).not.toContain("station-b-site");
  });

  it("treats a published flag with no slug as not published", () => {
    const stationId = "station-noslug";
    seedConfig(stationId, { slug: "", published: true });
    // Nothing to build a URL from, so nothing is offered.
    expect(miniSiteShareLine(stationId)).toBe("");
  });
});

describe("the link is wired into the customer-facing surfaces", () => {
  it("is embedded in the credit Customer Portal and its statement text", () => {
    const src = readSrc("src/react-app/components/CreditCustomerPortal.tsx");
    expect(src).toContain("MiniSiteLink");
    // The statement itself carries the link, so the customer gets one message.
    expect(src).toContain("miniSiteShareLine");
  });

  it("is appended to an outgoing invoice", () => {
    const src = readSrc("src/react-app/components/Invoice.tsx");
    expect(src).toContain("miniSiteShareLine");
  });

  it("is offered next to the broadcast composer", () => {
    const src = readSrc("src/react-app/components/Communication.tsx");
    expect(src).toContain("MiniSiteLink");
  });

  it("has its own Customers sub-tab with a preview and QR", () => {
    const src = readSrc("src/react-app/components/CustomerLoyalty.tsx");
    expect(src).toContain("StationPageCard");
    expect(src).toContain('innerView === "stationpage"');
    expect(readSrc("src/react-app/components/StationPageCard.tsx")).toContain(
      "qrcode",
    );
  });

  it("is reachable from the Dashboard", () => {
    const src = readSrc("src/react-app/components/Dashboard.tsx");
    expect(src).toContain('subTab: "stationpage"');
  });
});

describe("integration never publishes or mutates", () => {
  it("the embed does not import a publish or save function", () => {
    const src = readSrc("src/react-app/components/MiniSiteLink.tsx");
    // Reading the published link must never write to the bucket or the config.
    expect(src).not.toContain("publishMiniSite");
    expect(src).not.toContain("unpublishMiniSite");
    expect(src).not.toContain("saveMiniSiteConfig");
    expect(src).not.toContain("claimMiniSiteSlug");
  });

  it("the Customers-tab card does not publish either", () => {
    const src = readSrc("src/react-app/components/StationPageCard.tsx");
    expect(src).not.toContain("publishMiniSite");
    expect(src).not.toContain("saveMiniSiteConfig");
  });
});
