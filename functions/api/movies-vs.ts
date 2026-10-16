/**
 * Cloudflare Pages Function — vsembed native stream resolver.
 *
 * Mirrors src/server/vercel-api/_lib/vsembed.ts (self-contained: Pages
 * Functions bundle each file independently). Reverse-engineers the
 * vidsrc/vsembed player chain so movies/series play NATIVELY — no mirror
 * iframe (no ads, no popunders, no top-level redirects).
 *
 * The chain (all server-side; Workers run fetch + WebAssembly):
 *   vs_src.php -> landing (CFG.playerUrl) -> player (CONFIG.apiToken)
 *   -> data.vidsrc.sh stream_urls (base64 ChaCha20, decrypted by a WASM blob)
 *   -> per-host /generate.php JWT required as ?token= on every CDN file.
 *
 * The CDN token is bound to the RESOLVING IP, so this function also proxies
 * the playlists + segments (rewritten to stay same-origin).
 *
 * GET /api/movies-vs?tmdb=155&type=movie
 * GET /api/movies-vs?tmdb=1396&type=tv&season=1&episode=1
 * GET /api/movies-vs?url=<encoded stream-cdn url>   (playlist/segment proxy)
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

async function get(url, referer) {
  const headers = { "user-agent": UA, accept: "*/*" };
  if (referer) headers.referer = referer;
  return fetch(url, { headers, redirect: "follow" });
}

/** Only proxy stream-CDN playlists/segments — not an open proxy. */
function isVodTarget(u) {
  try {
    const p = new URL(u).pathname;
    return p.includes("/pl/") || p.includes("/content/") || p.endsWith(".m3u8");
  } catch {
    return false;
  }
}

async function resolve(tmdb, type, season, episode) {
  const srcRes = await get(
    `https://vsembed.ru/vs_src.php?type=${type}&id=${encodeURIComponent(tmdb)}`,
    "https://vsembed.ru/",
  );
  if (!srcRes.ok) return [];
  const src = (await srcRes.json()).src;
  if (!src) return [];
  const origin = new URL(src).origin;

  const landing = await (await get(src, "https://vsembed.ru/")).text();
  const cfgM = landing.match(/window\.CFG\s*=\s*(\{[\s\S]*?\});/);
  if (!cfgM) return [];
  const cfg = JSON.parse(cfgM[1]);
  if (!cfg.playerUrl) return [];

  const player = await (await get(origin + cfg.playerUrl, src)).text();
  const confM = player.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!confM) return [];
  const CONFIG = JSON.parse(confM[1]);
  if (!CONFIG.apiToken) return [];

  const ep =
    type === "tv" && season && episode
      ? `&season=${season}&episode=${episode}`
      : "";
  const api = `https://data.vidsrc.sh/api.php?type=${type}&tmdb=${encodeURIComponent(
    tmdb,
  )}${ep}&stream_urls&api_token=${encodeURIComponent(CONFIG.apiToken)}`;
  const sj = await (await get(api, origin + cfg.playerUrl)).json();
  const raw = sj?.data?.stream_urls;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw !== "string" || !sj?.vs) return [];

  const wa = globalThis.WebAssembly;
  const bytes = sj.vs.wasm_url
    ? await (await get(sj.vs.wasm_url)).arrayBuffer()
    : sj.vs.wasm
      ? Uint8Array.from(atob(sj.vs.wasm), (c) => c.charCodeAt(0)).buffer
      : null;
  if (!bytes) return [];

  const mod = await wa.compile(bytes);
  const ex = (await wa.instantiate(mod, {})).exports;
  const enc = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const n = ex.decrypt(ptr, enc.length);
  const text = new TextDecoder().decode(
    new Uint8Array(ex.memory.buffer, ptr + 12, n),
  );
  return text.split("\n").filter(Boolean);
}

const tokenCache = new Map();
const TOKEN_TTL = 5 * 60 * 1000;
async function mintToken(host) {
  const c = tokenCache.get(host);
  if (c && Date.now() - c.ts < TOKEN_TTL) return c.token;
  const res = await get(
    `${host}/generate.php`,
    "https://cloudorchestranova.com/",
  );
  const token = res.ok ? (await res.text()).trim() : "";
  if (token) tokenCache.set(host, { token, ts: Date.now() });
  return token;
}

function stripToken(u) {
  return u.replace(/([?&])(token|api_token)=[^&]*/g, "$1").replace(/[?&]$/, "");
}
function proxied(target, origin) {
  if (target.includes("/api/movies-vs?url=")) return target;
  return `${origin}/api/movies-vs?url=${encodeURIComponent(target)}`;
}
function rewritePlaylist(content, baseUrl, origin) {
  return content
    .split("\n")
    .map((line) => {
      if (line.startsWith("#") && line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (m, u) => {
          try {
            return `URI="${proxied(new URL(u, baseUrl).href, origin)}"`;
          } catch {
            return m;
          }
        });
      }
      if (!line.startsWith("#") && line.trim()) {
        try {
          return proxied(new URL(line.trim(), baseUrl).href, origin);
        } catch {
          return line;
        }
      }
      return line;
    })
    .join("\n");
}

export const onRequestGet = async (context) => {
  const url = new URL(context.request.url);
  const origin = `${url.protocol}//${url.host}`;
  const target = url.searchParams.get("url");

  // ---- Stream proxy: playlists + segments (mint/refresh the CDN token) ----
  if (target && /^https?:\/\//.test(target)) {
    if (!isVodTarget(target))
      return new Response(JSON.stringify({ error: "disallowed url" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors },
      });
    try {
      const host = new URL(target).origin;
      const clean = stripToken(target);
      let token = await mintToken(host);
      let res = await get(
        `${clean}?token=${encodeURIComponent(token)}`,
        `${host}/`,
      );
      if (res.status === 401 || res.status === 403) {
        tokenCache.delete(host);
        token = await mintToken(host);
        res = await get(
          `${clean}?token=${encodeURIComponent(token)}`,
          `${host}/`,
        );
      }
      if (!res.ok)
        return new Response(null, { status: res.status, headers: cors });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("mpegurl") || target.includes(".m3u8")) {
        const text = await res.text();
        return new Response(rewritePlaylist(text, target, origin), {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "no-store",
            ...cors,
          },
        });
      }
      return new Response(res.body, {
        headers: {
          "Content-Type": ct || "video/mp2t",
          "Accept-Ranges": "bytes",
          ...cors,
        },
      });
    } catch {
      return new Response(null, { status: 502, headers: cors });
    }
  }

  // ---- Resolve: return a same-origin master playlist URL ----
  const tmdb = url.searchParams.get("tmdb");
  const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
  const season = Number(url.searchParams.get("season")) || undefined;
  const episode = Number(url.searchParams.get("episode")) || undefined;
  if (!tmdb)
    return new Response(
      JSON.stringify({ error: "Missing tmdb", streams: null }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors },
      },
    );

  let urls = [];
  try {
    urls = await resolve(tmdb, type, season, episode);
  } catch {
    urls = [];
  }
  const streams = urls.length
    ? {
        playlistUrl: `${origin}/api/movies-vs?url=${encodeURIComponent(urls[0])}`,
        servers: [],
        thumbnailsUrl: null,
        canPlayFHD: true,
      }
    : null;
  return new Response(JSON.stringify({ streams }), {
    headers: { "Content-Type": "application/json", ...cors },
  });
};

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: cors });
