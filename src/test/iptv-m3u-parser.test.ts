/**
 * iptv-org master playlist (index.m3u) parser tests.
 *
 * Verifies the VLC-equivalent full-catalog parse: every EXTINF entry, the
 * EXTVLCOPT/EXTHTTP custom header capture, quality/geo variants (Zee One vs
 * Zee One Français vs Zee One German), geo-block flags in display names,
 * and stable unique ids for repeated tvg-ids.
 */
import { describe, it, expect } from "vitest";
import {
  parseIptvM3u,
  m3uEntryToIptvChannel,
  type IptvM3uEntry,
} from "../../api/_lib/iptv-m3u";

/* A realistic slice of https://iptv-org.github.io/iptv/index.m3u */
const SAMPLE_M3U = `#EXTM3U x-tvg-url="https://worker-9dd4.onrender.com/guide.xml.gz"
#EXTINF:-1 tvg-id="00sReplay.us@SD" tvg-logo="https://images.pluto.tv/channels/62ba60f059624e000781c436/colorLogoPNG.png" group-title="Movies",00s Replay
https://jmp2.uk/plu-62ba60f059624e000781c436.m3u8
#EXTINF:-1 tvg-id="ZeeOne.uk@UK" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/2/24/Zee_One_Logo_2025.png" group-title="Entertainment",Zee One (1080p)
https://7689426c.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/U2Ftc3VuZy1mcl9aZWVNYWdpY19ITFM/playlist.m3u8
#EXTINF:-1 tvg-id="ZeeOne.uk@French" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/2/24/Zee_One_Logo_2025.png" group-title="Entertainment",Zee One Français (720p)
https://example.com/zee-one-fr/playlist.m3u8
#EXTINF:-1 tvg-id="ZeeOne.uk@German" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/2/24/Zee_One_Logo_2025.png" group-title="Entertainment",Zee One German (720p)
https://example.com/zee-one-de/playlist.m3u8
#EXTINF:-1 tvg-id="ZeeAction.in@SD" tvg-logo="https://dtil.tmsimg.com/assets/GNLZZGG0022K5ZV.png?lock=720x540" group-title="Movies",Zee Action (720p) [Geo-blocked]
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36
https://example.com/zee-action/playlist.m3u8
#EXTINF:-1 tvg-id="Free.TV@SD" tvg-logo="https://i.imgur.com/l9Se42.png" group-title="General",Free TV (576p)
#EXTVLCOPT:http-referrer=https://www.website.com/
https://example.com/freetv/playlist.m3u8
#EXTINF:-1 tvg-id="SomeChannel.us@SD" tvg-logo="" group-title="News",Some Channel
http://example.com/some/playlist.m3u8|User-Agent=curl/8.0|Referer=https://example.com
#EXTINF:-1 tvg-id="WithLogo.ch@SD" tvg-logo="https://i.imgur.com/logo.png" group-title="General",With Logo CH HD (720p)
https://example.com/logo/playlist.m3u8
`;

describe("iptv-m3u master playlist parser (VLC equivalent)", () => {
  it("parses every EXTINF entry with URL", () => {
    const entries: IptvM3uEntry[] = parseIptvM3u(SAMPLE_M3U);
    expect(entries).toHaveLength(8);
    expect(entries.map((e) => e.name)).toEqual([
      "00s Replay",
      "Zee One (1080p)",
      "Zee One Français (720p)",
      "Zee One German (720p)",
      "Zee Action (720p) [Geo-blocked]",
      "Free TV (576p)",
      "Some Channel",
      "With Logo CH HD (720p)",
    ]);
  });

  it("keeps quality/geo variants as separate VLC entries", () => {
    const entries = parseIptvM3u(SAMPLE_M3U).filter((e) =>
      e.name.toLowerCase().includes("zee"),
    );
    expect(entries).toHaveLength(4); // One(+FR+DE) + Action
    expect(entries.map((e) => e.name)).toContain("Zee One Français (720p)");
    expect(entries.map((e) => e.name)).toContain("Zee One German (720p)");
    // unique ids
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("captures custom User-Agent + Referrer headers (EXTVLCOPT)", () => {
    const entries = parseIptvM3u(SAMPLE_M3U);
    const action = entries.find(
      (e) => e.name === "Zee Action (720p) [Geo-blocked]",
    );
    expect(action?.userAgent).toContain("Mozilla/5.0");
    expect(action?.referrer).toBeUndefined();

    const freeTV = entries.find((e) => e.name === "Free TV (576p)");
    expect(freeTV?.referrer).toBe("https://www.website.com/");
  });

  it("parses |User-Agent=...|Referer=... params appended to URLs", () => {
    const entries = parseIptvM3u(SAMPLE_M3U);
    const some = entries.find((e) => e.name === "Some Channel");
    expect(some?.userAgent).toBe("curl/8.0");
    expect(some?.referrer).toBe("https://example.com");
    expect(some?.url).toBe("http://example.com/some/playlist.m3u8");
  });

  it("captures country from tvg-id TLD portion (not the variant suffix)", () => {
    const entries = parseIptvM3u(SAMPLE_M3U);
    // ZeeOne.uk@UK -> TLD "uk" -> GB (the @UK/@FR variants are NOT countries)
    expect(entries.find((e) => e.name === "Zee One (1080p)")?.country).toBe(
      "GB",
    );
    expect(
      entries.find((e) => e.name === "Zee One Français (720p)")?.country,
    ).toBe("GB");
    // ZeeAction.in@SD -> IN
    expect(
      entries.find((e) => e.name === "Zee Action (720p) [Geo-blocked]")
        ?.country,
    ).toBe("IN");
    // SomeChannel.us@SD -> US
    expect(entries.find((e) => e.name === "Some Channel")?.country).toBe("US");
  });

  it("captures group-title categories (semicolon splits)", () => {
    const entries = parseIptvM3u(SAMPLE_M3U);
    expect(entries.find((e) => e.name === "Zee One (1080p)")?.category).toBe(
      "Entertainment",
    );
    expect(
      entries.find((e) => e.name === "Zee One (1080p)")?.categories,
    ).toEqual(["entertainment"]);
  });

  it("captures logo URLs", () => {
    const entries = parseIptvM3u(SAMPLE_M3U);
    const logo = entries.find((e) => e.name === "With Logo CH HD (720p)");
    expect(logo?.logo).toBe("https://i.imgur.com/logo.png");
    const noLogo = entries.find((e) => e.name === "Some Channel");
    expect(noLogo?.logo).toBe("");
  });

  it("extracts quality + geo-block notes from display names", () => {
    const entries = parseIptvM3u(SAMPLE_M3U);
    expect(
      entries.find((e) => e.name === "Zee Action (720p) [Geo-blocked]")
        ?.quality,
    ).toBe("720p");
    expect(entries.find((e) => e.name === "Zee One (1080p)")?.quality).toBe(
      "1080p",
    );
  });

  it("m3uEntryToIptvChannel maps to the wire shape + header fields", () => {
    const entries = parseIptvM3u(SAMPLE_M3U);
    const wire = m3uEntryToIptvChannel(
      entries.find((e) => e.name === "Zee Action (720p) [Geo-blocked]")!,
    );
    expect(wire.userAgent).toContain("Mozilla/5.0");
    expect(wire.category).toBe("movies");
    expect(wire.url).toContain("/zee-action/playlist.m3u8");
  });

  it("handles a minimal / empty input gracefully", () => {
    expect(parseIptvM3u("")).toEqual([]);
    expect(parseIptvM3u("#EXTM3U\n# some comment\n")).toEqual([]);
  });
});
