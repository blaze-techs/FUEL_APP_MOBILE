import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/**
 * Guards the security properties of the bug-reporting pipeline that unit tests
 * over the sanitizer cannot see: where the GitHub credential lives, and that
 * the Cloudflare relay actually forwards authentication.
 */
describe("bug reporting — wiring invariants", () => {
  const server = read("src/server/vercel-api/_lib/bug-report.ts");

  it("reads the GitHub token from the server environment only", () => {
    expect(server).toMatch(/process\.env\.FUELPRO_BUGREPORT_GITHUB_TOKEN/);
    expect(server).toMatch(/process\.env\.GITHUB_TOKEN/);
    // A VITE_-prefixed variable would be inlined into the client bundle.
    expect(server).not.toMatch(/VITE_[A-Z_]*TOKEN/);
    expect(server).not.toMatch(/import\.meta\.env/);
  });

  it("hardcodes the destination instead of letting the caller choose it", () => {
    // Repository, branch and path must be literals so a request cannot
    // redirect the write to an attacker-controlled location.
    expect(server).toMatch(/const REPO = "[^"]+"/);
    expect(server).toMatch(/const BRANCH = "ai-readme"/);
    expect(server).toMatch(/const INDEX_PATH = `\$\{BUGS_DIR\}\/INDEX\.jsonl`/);
  });

  it("is not reachable from the client bundle", () => {
    // Server modules must never be IMPORTED through the src/react-app tree.
    // A documentation comment naming the file is fine; an import is not.
    const clientFiles = [
      "src/react-app/components/BugReportSection.tsx",
      "src/react-app/lib/integrations-client.ts",
    ];
    for (const f of clientFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/from\s+["'][^"']*vercel-api\/_lib\//);
      expect(src, f).not.toMatch(/import\s*\([^)]*vercel-api\/_lib\//);
      expect(src, f).not.toMatch(/GITHUB_TOKEN/);
    }
  });

  it("does not echo a raw upstream error message into the response", () => {
    // Only the coarse class may be returned, never e.message verbatim.
    const submit = server.slice(
      server.indexOf("export async function submitBugReport"),
    );
    expect(submit).toMatch(/classifyError\(/);
    expect(submit).not.toMatch(/error:\s*e instanceof Error \? e\.message/);
  });
});

describe("cloudflare integrations relay — auth forwarding", () => {
  const relay = read("functions/api/integrations.ts");

  it("forwards the Authorization header upstream", () => {
    // Upstream requires a Supabase bearer token for every action. Dropping it
    // here 401s every authenticated integration call made from pages.dev.
    expect(relay).toMatch(/request\.headers\.get\("Authorization"\)/);
    expect(relay).toMatch(/Authorization:\s*auth/);
  });

  it("forwards only Authorization, not arbitrary client headers", () => {
    // Forwarding the whole header bag would let a caller influence the
    // relayed request (e.g. spoofing Host or adding an internal header).
    expect(relay).not.toMatch(/headers:\s*request\.headers/);
    expect(relay).not.toMatch(
      /headers:\s*Object\.fromEntries\(request\.headers/,
    );
  });
});

describe("dispatcher — the reporter cannot impersonate another user", () => {
  const dispatch = read("src/server/vercel-api/integrations.ts");

  it("overwrites authenticatedUserId from the verified token", () => {
    // The body is client-controlled. If a caller could set
    // authenticatedUserId directly, a report could be attributed to someone
    // else. It must be derived from the verified bearer token AFTER auth.
    const authIdx = dispatch.indexOf("await authenticateBearer(req)");
    const assignIdx = dispatch.indexOf("body.authenticatedUserId = userId");
    expect(authIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeGreaterThan(authIdx);

    // And a client-supplied value must never be read before being replaced.
    expect(dispatch).not.toMatch(
      /body\.authenticatedUserId\s*\?\?|body\.authenticatedUserId\s*\|\|/,
    );
  });

  it("verifies the bearer token against the identity provider", () => {
    // A locally-decoded or trusted-header identity would be forgeable.
    expect(dispatch).toMatch(/supabaseAdmin\.auth\.getUser\(token\)/);
  });

  it("binds the reporter ref through the sanitizer, not the raw id", () => {
    const core = read("src/server/vercel-api/_lib/integrations-core.ts");
    expect(core).toMatch(
      /submitBugReport\(\s*body,\s*String\(body\.authenticatedUserId/,
    );
  });
});
