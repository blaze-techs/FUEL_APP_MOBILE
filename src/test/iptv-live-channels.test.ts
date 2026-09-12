/**
 * IPTV-org Live TV integration tests.
 *
 * Verifies the VLC-equivalent catalog behavior in the News → Live TV tab:
 *  - iptv-org channels round-trip through the proxy contract (including
 *    alt_names, used for VLC-style search).
 *  - searchChannels finds a channel like "Zee One" by name, country and
 *    alternate name — the way VLC matches a network playlist.
 *  - the merge keeps primary (tvgarden) channels first and never duplicates.
 */
import { describe, it, expect } from "vitest";
import {
  iptvToLiveChannel,
  searchChannels,
  mergeChannelsWithIptv,
  getCuratedGoodChannels,
  type IptvChannel,
  type LiveChannel,
} from "@/react-app/services/LiveStreamService";

/** The exact Zee One entry from iptv-org (UK channel, entertainment). */
const ZEE_ONE: IptvChannel = {
  id: "ZeeOne.uk",
  name: "Zee One",
  url: "https://7689426c.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/U2Ftc3VuZy1mcl9aZWVNYWdpY19ITFM/playlist.m3u8",
  logo: "",
  country: "UK",
  language: "en",
  category: "entertainment",
  alt_names: ["ZeeOne", "Zee One (UK)"],
};

function makeChannel(name: string, country = "US"): LiveChannel {
  return {
    nanoid: `x-${name}`,
    name,
    stream_urls: ["https://example.com/playlist.m3u8"],
    youtube_urls: [],
    languages: [],
    country,
    isGeoBlocked: false,
  };
}

describe("iptv-live-channels — catalog integration", () => {
  it("converts an iptv-org channel to the unified LiveChannel shape with altNames", () => {
    const lc = iptvToLiveChannel(ZEE_ONE);
    expect(lc.nanoid).toBe("iptv-ZeeOne.uk");
    expect(lc.name).toBe("Zee One");
    expect(lc.stream_urls).toEqual([ZEE_ONE.url]);
    expect(lc.country).toBe("UK");
    expect(lc.altNames).toContain("ZeeOne");
    expect(lc.logo).toBeUndefined();
  });

  it("survives channels that lack alt_names (legacy payloads)", () => {
    const legacy: IptvChannel = {
      id: "Legacy.ch",
      name: "Legacy",
      url: "https://example.com/legacy.m3u8",
      logo: "",
      country: "CH",
      language: "",
      category: "",
    };
    const lc = iptvToLiveChannel(legacy);
    expect(lc.altNames).toEqual([]);
  });

  it("searchChannels finds a non-default-country channel like Zee One (VLC parity)", () => {
    // The app default view is the user's country (e.g. US); Zee One is a UK
    // channel that only appears when the FULL global catalog is loaded.
    const catalog = [
      makeChannel("CNN"),
      makeChannel("BBC One"),
      makeChannel("NBC"),
      iptvToLiveChannel(ZEE_ONE),
    ];
    const hits = searchChannels(catalog, "zee one");
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Zee One");
    expect(hits[0].country).toBe("UK");
  });

  it("searchChannels matches alternate names (VLC playlist metadata parity)", () => {
    const catalog = [
      makeChannel("Some Other Channel"),
      iptvToLiveChannel({ ...ZEE_ONE, alt_names: ["Zee Flashback"] }),
    ];
    expect(searchChannels(catalog, "zee flashback")).toHaveLength(1);
    expect(searchChannels(catalog, "flashback")).toHaveLength(1);
  });

  it("searchChannels matches the country code and is case-insensitive", () => {
    const catalog = [makeChannel("NTV", "KE"), makeChannel("ABN", "US")];
    expect(searchChannels(catalog, "ke")).toHaveLength(1);
    expect(searchChannels(catalog, "ntv")).toHaveLength(1);
    expect(searchChannels(catalog, "  ")).toHaveLength(2);
  });

  it("mergeChannelsWithIptv keeps primary first and dedupes by name", () => {
    const primary = [makeChannel("BBC One"), makeChannel("Zee One")];
    const iptv = [
      ZEE_ONE, // duplicate name — must be skipped
      {
        id: "ExtraOne.uk",
        name: "Extra One",
        url: "https://example.com/extra.m3u8",
        logo: "",
        country: "UK",
        language: "en",
        category: "entertainment",
      },
    ];
    const merged = mergeChannelsWithIptv(primary, iptv);
    expect(merged.map((c) => c.name)).toEqual([
      "BBC One",
      "Zee One",
      "Extra One",
    ]);
    expect(merged[1].nanoid).toBe("x-Zee One"); // primary copy kept
  });

  it("iptvToLiveChannel carries custom UA/Referrer/quality from index.m3u", () => {
    const m3uChannel: IptvChannel = {
      id: "ZeeAction.in",
      name: "Zee Action (720p) [Geo-blocked]",
      url: "https://example.com/zee-action/playlist.m3u8",
      logo: "",
      country: "IN",
      language: "",
      category: "movies",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      referrer: "https://www.website.com/",
      quality: "720p",
    };
    const lc = iptvToLiveChannel(m3uChannel);
    expect(lc.userAgent).toContain("Mozilla/5.0");
    expect(lc.referrer).toBe("https://www.website.com/");
    expect(lc.quality).toBe("720p");
    expect(lc.nanoid).toBe("iptv-ZeeAction.in");
  });

  it("searchChannels finds index.m3u geo/quality VARIANTS (VLC parity)", () => {
    // The full m3u catalog includes "Zee One Français" as its own entry —
    // search must find it, not just the plain "Zee One".
    const catalog = [
      iptvToLiveChannel({
        ...ZEE_ONE,
        name: "Zee One (1080p)",
        id: "ZeeOne.uk",
      }),
      iptvToLiveChannel({
        ...ZEE_ONE,
        name: "Zee One Français (720p)",
        id: "ZeeOne.uk-2",
      }),
    ];
    expect(searchChannels(catalog, "zee one")).toHaveLength(2);
    const fr = searchChannels(catalog, "français");
    expect(fr).toHaveLength(1);
    expect(fr[0].name).toContain("Français");
  });

  it("curated list never shadows Zee-family channels with a dead playlist", () => {
    // Regression: several curated entries pointed at one shared, now-dead
    // YouTube playlist (PLq1tg...). Because curated entries are PREPENDED
    // and mergeChannelsWithIptv dedupes by name keeping primary-first, the
    // dead curated copy SHADOWED the real playable iptv-org stream (e.g.
    // "Zee One" on wurl.com HLS) — so selecting it always errored and the
    // feed never played. Remove those entries entirely so the iptv-org
    // stream surfaces.
    const curated = getCuratedGoodChannels(false, "tv");
    const deadPlaylist =
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLq1tg_5hO6LzExWX3tM0mJkK0M0dF3YzL";

    // The channels that pointed at the dead playlist must no longer be
    // curated (so their real iptv-org HLS stream can surface).
    for (const name of ["Zee One", "Zee World", "Zee Cinema", "Dangal TV"]) {
      expect(curated.some((c) => c.name === name)).toBe(false);
    }

    // No curated channel may reference the dead playlist at all.
    for (const c of curated) {
      for (const y of c.youtube_urls ?? []) {
        expect(y).not.toBe(deadPlaylist);
      }
    }

    // And every remaining curated channel still resolves to a REAL stream.
    for (const c of curated) {
      expect(
        (c.stream_urls ?? []).length > 0 || (c.youtube_urls ?? []).length > 0,
      ).toBe(true);
    }
  });
});
