/**
 * The Vercel catch-all dispatcher must actually know about the customer-account
 * resolver.
 *
 * `api/[[...path]].ts` is a hand-maintained route table: a new handler under
 * `src/server/vercel-api/` is not routed until it is added there. When it is
 * missing the endpoint returns 404 "API route not found" and the customer page
 * shows "not available" for every link — a failure that looks like a data
 * problem, not a wiring problem. So assert the wiring directly, on the real
 * dispatcher.
 */
import { describe, expect, it, vi } from "vitest";

const source = await import("node:fs").then((fs) =>
  fs.readFileSync(`${process.cwd()}/api/[[...path]].ts`, "utf8"),
);

describe("api dispatcher route table", () => {
  it("imports the customer-portal resolver", () => {
    expect(source).toContain("vercel-api/customer-portal.js");
  });

  it("registers the /api/customer-portal pattern", () => {
    expect(source).toMatch(/\^\/api\/customer-portal\/\?\$/);
  });

  it("also routes the payslip-link resolver it was modelled on", () => {
    // Both are token resolvers reached without a session; if one is wired the
    // other should be too.
    expect(source).toMatch(/\^\/api\/payslip-link\/\?\$/);
  });
});

describe("dispatcher resolves the route at runtime", () => {
  it("routes /api/customer-portal to a handler rather than 'not found'", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    // No matching row -> the resolver itself answers 404 with its own body.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 200 })),
    );

    const { default: handler } = await import("../../api/[[...path]].ts");

    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      end(chunk?: string) {
        this.body = chunk ?? "";
      },
    };
    const req = {
      method: "GET",
      url: "/api/customer-portal?token=abcDEF123456",
      headers: { "x-forwarded-for": "10.0.0.1" },
      socket: { remoteAddress: "10.0.0.1" },
      on: (event: string, cb: (arg?: unknown) => void) => {
        if (event === "end") cb();
        return req;
      },
    };

    await handler(req as never, res as never);
    vi.unstubAllGlobals();

    // The dispatcher's own miss body is the tell that routing failed.
    expect(res.body).not.toContain("API route not found");
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("not_found");
  });
});
