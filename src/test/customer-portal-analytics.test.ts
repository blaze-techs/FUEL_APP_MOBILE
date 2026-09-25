/**
 * The account-link view counter, and — more importantly — the auth boundary
 * around it.
 *
 * `customer-portal-view` is the only anonymous action added: a customer opening
 * their page has no session, and it writes nothing but a counter. Its sibling
 * `customer-portal-stats` returns analytics to the OWNER and must therefore
 * stay behind the normal bearer check. If that ever drifted into
 * PUBLIC_ACTIONS, any anonymous caller could read another station's link
 * analytics — so it is asserted directly against the shipped source rather
 * than through a mock.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const integrations = readFileSync(
  `${process.cwd()}/src/server/vercel-api/integrations.ts`,
  "utf8",
);
const core = readFileSync(
  `${process.cwd()}/src/server/vercel-api/_lib/integrations-core.ts`,
  "utf8",
);

/** The PUBLIC_ACTIONS set literal, so assertions are scoped to it. */
function publicActions(): string {
  const match = /const PUBLIC_ACTIONS = new Set\(\[([\s\S]*?)\]\)/.exec(
    integrations,
  );
  if (!match) throw new Error("PUBLIC_ACTIONS not found");
  return match[1];
}

describe("customer-portal analytics auth boundary", () => {
  it("treats the anonymous view recorder as public", () => {
    expect(publicActions()).toContain('"customer-portal-view"');
  });

  it("keeps the owner-side stats read authenticated", () => {
    expect(publicActions()).not.toContain('"customer-portal-stats"');
  });

  it("keeps the station mini-site pair unchanged", () => {
    // Regression guard on the existing feature this one mirrors.
    expect(publicActions()).toContain('"mini-site-view"');
    expect(publicActions()).not.toContain('"mini-site-stats"');
  });
});

describe("customer-portal analytics dispatch", () => {
  it("registers both new actions", () => {
    expect(core).toContain('case "customer-portal-view"');
    expect(core).toContain('case "customer-portal-stats"');
  });

  it("calls the token-scoped RPCs, not the slug-scoped ones", () => {
    // Reusing the station RPC would fail: its slug regex rejects uppercase,
    // and every base62 token contains uppercase.
    expect(core).toContain("rpc/customer_portal_record_view");
    expect(core).toContain("rpc/customer_portal_get_view_stats");
  });

  it("validates the token before touching Supabase", () => {
    const fn = /async function customerPortalRecordView[\s\S]*?\n\}/.exec(core);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/\[A-Za-z0-9\]\{10,16\}/);
  });
});

describe("view stats read is total", () => {
  it("reports an unreadable counter as unknown, never as zero", () => {
    // Returning 0 would make the panel say "Not opened yet" — a factual claim
    // the server cannot support when it simply failed to read.
    const fn = /async function customerPortalViewStats[\s\S]*?\n\}/.exec(core);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/views: null/);
    expect(fn![0]).not.toMatch(/success: true,\s*views: 0/);
  });

  it("keeps null as unknown on the client too", () => {
    // The server's null must survive the client mapping, or the distinction is
    // lost one layer up.
    const client = readFileSync(
      `${process.cwd()}/src/react-app/lib/customer-portal-service.ts`,
      "utf8",
    );
    const start = client.indexOf(
      "export async function fetchCustomerPortalViewStats",
    );
    expect(start).toBeGreaterThan(-1);
    const nextExport = client.indexOf("\nexport ", start + 10);
    const fn = client.slice(start, nextExport > -1 ? nextExport : undefined);
    expect(fn).toMatch(/data\.views === null/);
  });
});
