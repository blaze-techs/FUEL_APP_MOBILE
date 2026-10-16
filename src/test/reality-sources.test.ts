/**
 * Reality live-source tests (Pluto TV / DW / SomaFM).
 *
 * These sources were reverse-engineered from the Reezn TV APK
 * (reezntvapp.com) — an Android player over the VAVOO/mHub addon platform.
 * The live addons that actually serve a real, CORS-reachable stream from a
 * datacenter IP are Pluto TV, DW and SomaFM. This suite pins the contract
 * that the /api/live-channels `__reality` slice relies on:
 *  - Pluto channels become direct `stitch/hls/...` master.m3u8 URLs with a
 *    region hint, and `number. ` prefixes are stripped from names.
 *  - The `visibility` filter must NOT drop channels — Pluto reports
 *    `"everyone"`, not `"published"` (the bug that returned 0 channels).
 *  - SomaFM `.pls` playlists resolve to a direct stream and carry the
 *    non-browser User-Agent the ice* hosts require.
 *  - DW exposes the four language feeds.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchPlutoChannels,
  fetchDwChannels,
  fetchSomaFmChannels,
} from "@/server/vercel-api/_lib/reality-sources";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Minimal Pluto v2 channel shape (only the fields the mapper reads). */
function plutoChannel(over: Record<string, unknown> = {}) {
  return {
    _id: "640ae4876d549900084af535",
    name: "805. CBS News 24/7",
    number: 805,
    category: "News + Opinion",
    visibility: "everyone",
    isStitched: true,
    colorLogoPNG: "https://images.pluto.tv/x/colorLogoPNG.png",
    ...over,
  };
}

describe("Pluto TV source", () => {
  it("maps a channel to a stitch master.m3u8 with the region hint", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([plutoChannel()]), { status: 200 }),
    ) as unknown as typeof fetch;

    const out = await fetchPlutoChannels("us", "");
    expect(out).toHaveLength(1);
    const ch = out[0];
    expect(ch.id).toBe("pluto-640ae4876d549900084af535");
    expect(ch.name).toBe("CBS News 24/7"); // leading "805. " stripped
    expect(ch.url).toContain(
      "/stitch/hls/channel/640ae4876d549900084af535/master.m3u8",
    );
    expect(ch.url).toContain("marketingRegion=US");
    expect(ch.audio).toBe(false);
    expect(ch.source).toBe("pluto");
    expect(ch.logo).toContain("colorLogoPNG");
  });

  it('does NOT drop "everyone" visibility (the 0-channel regression)', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            plutoChannel({ visibility: "everyone" }),
            plutoChannel({ _id: "b", name: "B", visibility: "published" }),
            plutoChannel({ _id: "c", name: "C", visibility: "hidden" }),
          ]),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const out = await fetchPlutoChannels("us", "");
    // "everyone" + "published" kept; only "hidden" dropped.
    expect(out.map((c) => c.id)).toEqual([
      "pluto-640ae4876d549900084af535",
      "pluto-b",
    ]);
  });

  it("narrows by FuelPro category", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            plutoChannel({ category: "News + Opinion" }),
            plutoChannel({ _id: "m", name: "Movies", category: "Movies" }),
          ]),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const news = await fetchPlutoChannels("us", "news");
    expect(news.map((c) => c.id)).toEqual(["pluto-640ae4876d549900084af535"]);
  });

  it("falls back to US for an unsupported region", async () => {
    let called = "";
    globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
      called = String(u);
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    await fetchPlutoChannels("ke", "");
    expect(called).toContain("country=US");
  });

  it("returns [] on a fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await fetchPlutoChannels("us", "")).toEqual([]);
  });
});

describe("DW source", () => {
  it("exposes the four language feeds as HLS video channels", () => {
    const dw = fetchDwChannels();
    expect(dw).toHaveLength(4);
    for (const c of dw) {
      expect(c.url).toMatch(
        /^https:\/\/dwamdstream\d+\.akamaized\.net\/hls\/live\//,
      );
      expect(c.audio).toBe(false);
      expect(c.categories).toContain("news");
      expect(c.source).toBe("dw");
    }
    expect(dw.map((c) => c.id).sort()).toEqual([
      "dw-ar",
      "dw-en",
      "dw-es",
      "dw-ru",
    ]);
  });
});

describe("SomaFM source", () => {
  it("resolves a .pls playlist to a direct stream + carries a player UA", async () => {
    const station = {
      id: "groovesalad",
      title: "Groove Salad",
      playlists: [
        {
          url: "https://api.somafm.com/groovesalad.pls",
          format: "mp3",
          quality: "highest",
        },
        {
          url: "https://api.somafm.com/groovesalad130.pls",
          format: "aac",
          quality: "highest",
        },
      ],
    };
    globalThis.fetch = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes("channels.json")) {
        return new Response(JSON.stringify({ channels: [station] }), {
          status: 200,
        });
      }
      // The .pls resolves to a direct ice* stream.
      return new Response(
        "[playlist]\nnumberofentries=1\nFile1=https://ice6.somafm.com/groovesalad-256-mp3\n",
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const out = await fetchSomaFmChannels();
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://ice6.somafm.com/groovesalad-256-mp3");
    expect(out[0].audio).toBe(true);
    // SomaFM 403s a browser UA — the channel must carry a player UA.
    expect(out[0].userAgent).toMatch(/LibVLC/);
    expect(out[0].userAgent).not.toMatch(/Mozilla/);
  });

  it("returns [] when the directory is unavailable", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;
    expect(await fetchSomaFmChannels()).toEqual([]);
  });
});
