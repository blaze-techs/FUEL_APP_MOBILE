/**
 * Vavoo / mHub live-source tests.
 *
 * The Reezn TV APK's own Live TV provider is the VAVOO / mHub addon at
 * https://www.vavoo.to/live/. This suite pins the two behaviours that matter
 * for the "Live TV" tab:
 *  - the catalogue is paged via POST mediahubmx-catalog.json (cursor walk),
 *  - every returned channel has a RESOLVED stream URL, so a channel that
 *    would show "channel is offline" is dropped before it reaches the UI,
 *  - a failed resolve is a soft skip, never a thrown error.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchVavooChannels,
  vavooResolve,
  VAVOO_GROUPS,
} from "@/server/vercel-api/_lib/vavoo-sources";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function catalogItem(id: string, name: string, group = "Germany") {
  return { ids: { id }, name, group, logo: `https://logo/${id}.png` };
}

/** Stub fetch: catalogue pages + resolve responses. */
function stubVavoo(opts: { deadIds?: string[]; pages?: number } = {}) {
  const dead = new Set(opts.deadIds || []);
  const pages = opts.pages ?? 1;
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("mediahubmx-catalog")) {
        const cursor = Number(body.cursor ?? 0);
        const nextCursor = cursor / 300 + 1 < pages ? cursor + 300 : null;
        return new Response(
          JSON.stringify({
            items: [catalogItem(`c${cursor + 1}`, "Channel One .s")],
            nextCursor,
          }),
          { status: 200 },
        );
      }
      if (url.includes("mediahubmx-resolve")) {
        const m = /play\/(.+)$/.exec(body.url || "");
        const id = m ? m[1] : "";
        if (dead.has(id)) return new Response("[]", { status: 200 });
        return new Response(
          JSON.stringify([{ id, url: `https://cdn.example/${id}.m3u8` }]),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    },
  ) as unknown as typeof fetch;
}

describe("vavoo live source", () => {
  it("resolves a channel id to its HLS URL", async () => {
    stubVavoo();
    expect(await vavooResolve("abc")).toBe("https://cdn.example/abc.m3u8");
  });

  it("returns an empty string (never throws) when resolve fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await vavooResolve("abc")).toBe("");
  });

  it("drops channels that do not resolve (no offline entries reach the UI)", async () => {
    stubVavoo({ deadIds: ["c1"] });
    const out = await fetchVavooChannels("", 0, 0, false);
    expect(out).toHaveLength(0);
  });

  it("returns resolved channels with a playable URL and region label", async () => {
    stubVavoo();
    const out = await fetchVavooChannels("", 0, 0, false);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://cdn.example/c1.m3u8");
    expect(out[0].name).toBe("Channel One (Germany)");
    expect(out[0].country).toBe("de");
    expect(out[0].source).toBe("vavoo");
  });

  it("walks the catalogue cursor across pages", async () => {
    stubVavoo({ pages: 3 });
    const out = await fetchVavooChannels("", 0, 0, false);
    expect(out.length).toBe(3);
  });

  it("exposes the region groups for a UI filter", () => {
    expect(VAVOO_GROUPS).toContain("Germany");
    expect(VAVOO_GROUPS).toContain("United Kingdom");
  });

  it("drops channels whose resolved stream 502s when probing is on", async () => {
    stubVavoo();
    // Override the stream origin to fail (Vavoo resolve hands back a URL for
    // a dead channel that then errors at the origin).
    const base = globalThis.fetch as unknown as (
      i: RequestInfo | URL,
      n?: RequestInit,
    ) => Promise<Response>;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.includes("cdn.example")) return new Response("", { status: 502 });
        return base(input, init);
      },
    ) as unknown as typeof fetch;
    const out = await fetchVavooChannels("", 0, 0, true);
    expect(out).toHaveLength(0);
  });

  it("keeps channels when the resolved stream is a real playlist", async () => {
    stubVavoo();
    const base = globalThis.fetch as unknown as (
      i: RequestInfo | URL,
      n?: RequestInit,
    ) => Promise<Response>;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.includes("cdn.example"))
          return new Response("#EXTM3U\n#EXTINF:1,\nseg.ts\n", { status: 200 });
        return base(input, init);
      },
    ) as unknown as typeof fetch;
    const out = await fetchVavooChannels("", 0, 0, true);
    expect(out).toHaveLength(1);
  });
});
