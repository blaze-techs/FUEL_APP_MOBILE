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
  fetchVavooPremiumChannels,
  vavooResolve,
  VAVOO_GROUPS,
  VAVOO_PREMIUM_BRANDS,
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

/**
 * Stub fetch for the PREMIUM pass: each brand search returns a mixed list
 * (brand matches + noise the loose upstream search also returns), and only
 * some of them resolve to a live playlist.
 */
function stubVavooPremium(opts: { deadIds?: string[] } = {}) {
  const dead = new Set(opts.deadIds || []);
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("mediahubmx-catalog")) {
        const term = String(body.search || "");
        // Every search returns the same two brand channels plus a noise row
        // that does NOT match the brand (the upstream search is a loose
        // substring match — searching "ZEE" also returns "ALJAZEERA").
        const items = [
          catalogItem(`${term}-1`, `${term} 1 HD`, "Germany"),
          catalogItem(`${term}-2`, `${term} 2 HD`, "Germany"),
          catalogItem(`${term}-noise`, "ALJAZEERA DOC", "Arabia"),
        ];
        return new Response(JSON.stringify({ items, nextCursor: null }), {
          status: 200,
        });
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
      if (url.includes("cdn.example")) {
        return new Response("#EXTM3U\n#EXTINF:1,\nseg.ts\n", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    },
  ) as unknown as typeof fetch;
}

describe("vavoo premium brands", () => {
  it("covers the named brands the viewer asked for", () => {
    const ids = VAVOO_PREMIUM_BRANDS.map((b) => b.id);
    expect(ids).toContain("supersport");
    expect(ids).toContain("bein");
    expect(ids).toContain("zee");
    expect(ids).toContain("arena");
    expect(ids).toContain("skysport");
    expect(ids).toContain("dazn");
    for (const b of VAVOO_PREMIUM_BRANDS) {
      expect(b.search.length).toBeGreaterThan(1);
      expect(b.label.length).toBeGreaterThan(1);
    }
  });

  it("matches a brand name but rejects loose-search noise", () => {
    // "ZEE" must not match "ALJAZEERA" (no word boundary before "zee").
    const zee = VAVOO_PREMIUM_BRANDS.find((b) => b.id === "zee");
    expect(zee?.match.test("ZEE TV")).toBe(true);
    expect(zee?.match.test("ALJAZEERA DOC")).toBe(false);
    const bein = VAVOO_PREMIUM_BRANDS.find((b) => b.id === "bein");
    expect(bein?.match.test("BEIN SPORTS 1 HD")).toBe(true);
    expect(bein?.match.test("BEING HUMAN")).toBe(false);
    const ss = VAVOO_PREMIUM_BRANDS.find((b) => b.id === "supersport");
    expect(ss?.match.test("SUPERSPORT 1")).toBe(true);
    expect(ss?.match.test("SUPER SPORT 2")).toBe(true);
  });

  it("returns only probed-playable brand channels (no offline entries)", async () => {
    stubVavooPremium();
    const out = await fetchVavooPremiumChannels(true);
    // 16 brands x 2 matching channels, noise rows rejected.
    expect(out.length).toBe(VAVOO_PREMIUM_BRANDS.length * 2);
    expect(out.every((c) => c.url.startsWith("https://cdn.example/"))).toBe(
      true,
    );
    expect(out.some((c) => /aljazeera/i.test(c.name))).toBe(false);
    // A confirmed playlist marks the channel verified (the UI ranks these first).
    expect(out.every((c) => c.verified)).toBe(true);
  });

  it("KEEPS a channel when the probe times out (slow != offline)", async () => {
    // A slow manifest is indeterminate, not proof of death. Dropping on
    // timeout is what silently removed whole networks (beIN, Zee) whose feeds
    // answer slower than the probe window.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("mediahubmx-catalog")) {
        return new Response(
          JSON.stringify({
            items: [catalogItem("s1", "SUPERSPORT 1 HD", "Albania")],
            nextCursor: null,
          }),
          { status: 200 },
        );
      }
      if (url.includes("mediahubmx-resolve")) {
        return new Response(
          JSON.stringify([{ id: "s1", url: "https://slow.example/s1.m3u8" }]),
          { status: 200 },
        );
      }
      if (url.includes("slow.example")) {
        // Never resolves within the probe window -> AbortError.
        return new Promise<Response>((_, reject) => {
          setTimeout(
            () =>
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              ),
            50,
          );
        });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchVavooPremiumChannels(true, 100);
    expect(out).toHaveLength(1);
    expect(out[0].name).toContain("SUPERSPORT 1 HD");
    // Not confirmed, so not marked verified — but still offered.
    expect(out[0].verified).toBe(false);
  });

  it("drops brand channels whose stream does not answer", async () => {
    stubVavooPremium({ deadIds: ["SUPERSPORT-1", "SUPERSPORT-2"] });
    const out = await fetchVavooPremiumChannels(true);
    expect(out.some((c) => /supersport/i.test(c.name))).toBe(false);
    // Every other brand still comes through.
    expect(out.length).toBe((VAVOO_PREMIUM_BRANDS.length - 1) * 2);
  });

  it("never surfaces an explicit offline placeholder", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mediahubmx-catalog")) {
        return new Response(
          JSON.stringify({
            items: [catalogItem("x1", "SUPERSPORT 1 - Channel is offline")],
            nextCursor: null,
          }),
          { status: 200 },
        );
      }
      if (url.includes("mediahubmx-resolve")) {
        return new Response(
          JSON.stringify([{ id: "x1", url: "https://cdn.example/x1.m3u8" }]),
          { status: 200 },
        );
      }
      if (url.includes("cdn.example")) {
        return new Response("#EXTM3U\n#EXTINF:1,\nseg.ts\n", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchVavooPremiumChannels(true);
    expect(out).toHaveLength(0);
  });
});
