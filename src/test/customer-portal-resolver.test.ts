/**
 * The customer-account resolver is the security boundary for the second mini
 * site: it is the only thing that decides whether a token yields a balance.
 *
 * The handler reads its Supabase config from process.env at module load, so the
 * env is set before a dynamic import, and global fetch is stubbed to stand in
 * for the PostgREST query. That keeps the real decode + match logic under test
 * rather than a reimplementation of it.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import zlib from "node:zlib";

type Handler = (req: unknown, res: unknown) => Promise<void>;

let handler: Handler;

/** Minimal stand-in for the Node response the handler writes to. */
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
    },
    end(chunk?: string) {
      this.body = chunk ?? "";
    },
  } as unknown as {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    setHeader: (k: string, v: string) => void;
    end: (c?: string) => void;
  };
  return res;
}

function makeReq(url: string) {
  return {
    method: "GET",
    url,
    headers: { "x-forwarded-for": "10.0.0.9" },
    socket: { remoteAddress: "10.0.0.9" },
  };
}

/** Encode a document the way cloud-storage-service stores it. */
function store(value: unknown) {
  const gz = zlib
    .gzipSync(Buffer.from(JSON.stringify(value)))
    .toString("base64");
  return { __compressed: true, c: gz };
}

function stubRows(rows: Array<{ id: string; data: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })),
  );
}

beforeAll(async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const mod = await import("@/server/vercel-api/customer-portal");
  handler = mod.default as unknown as Handler;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("customer-portal resolver", () => {
  it("returns the document when the token matches a live link", async () => {
    const token = "abcDEF123456";
    stubRows([
      {
        id: `customer_portal_${token}__owner`,
        data: store({
          token,
          customerName: "Acme",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      },
    ]);
    const res = makeRes();
    await handler(makeReq(`/api/customer-portal?token=${token}`), res);
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.success).toBe(true);
    expect(payload.document.customerName).toBe("Acme");
  });

  it("rejects a row whose own token does not match the requested one", async () => {
    // This is the check that stops a PostgREST `_`-wildcard match (or any
    // index collision) from serving a DIFFERENT customer's document.
    const token = "abcDEF123456";
    stubRows([
      {
        id: `customer_portal_${token}__owner`,
        data: store({
          token: "zzzZZZ999999",
          customerName: "Somebody else",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      },
    ]);
    const res = makeRes();
    await handler(makeReq(`/api/customer-portal?token=${token}`), res);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("Somebody else");
  });

  it("answers 410 for an expired link", async () => {
    const token = "abcDEF123456";
    stubRows([
      {
        id: `customer_portal_${token}__owner`,
        data: store({ token, expiresAt: "2000-01-01T00:00:00.000Z" }),
      },
    ]);
    const res = makeRes();
    await handler(makeReq(`/api/customer-portal?token=${token}`), res);
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.body).reason).toBe("expired");
  });

  it("answers 404 for a token with no row", async () => {
    stubRows([]);
    const res = makeRes();
    await handler(makeReq("/api/customer-portal?token=abcDEF123456"), res);
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed token before querying at all", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = makeRes();
    await handler(makeReq("/api/customer-portal?token=bad"), res);
    expect(res.statusCode).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks responses no-store so a shared cache never holds a balance", async () => {
    stubRows([]);
    const res = makeRes();
    await handler(makeReq("/api/customer-portal?token=abcDEF123456"), res);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
