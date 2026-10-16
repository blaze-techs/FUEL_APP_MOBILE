/**
 * vsembed native stream resolver (reverse-engineered).
 *
 * The vidsrc/vsembed player gates playback behind, in order:
 *   1. a `?vs=` src token  (https://vsembed.ru/vs_src.php)
 *   2. a landing page (window.CFG.playerUrl) — rotating player host
 *   3. the player page (window.CONFIG.apiToken) — single-use, IP-bound
 *   4. data.vidsrc.sh stream API -> data.stream_urls (base64 ChaCha20,
 *      decrypted in-browser by a per-5-minute WASM blob)
 *   5. per-file `/generate.php` JWT (IP-bound) that the CDN requires as
 *      `?token=` on every playlist + segment.
 *
 * None of that needs a browser: Node/Workers run fetch + WebAssembly, so the
 * WHOLE chain resolves server-side (verified from a datacenter IP). The result
 * is a plain HLS master playlist whose renditions are CORS * segments.
 *
 * Playing those directly gives a native, ad-free, redirect-free player — the
 * only reason this exists. Because the token is bound to the RESOLVING IP, the
 * playlists must be fetched from this same function (hence `proxyVod`).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * Only proxy stream-CDN targets (playlists + segments), never arbitrary URLs —
 * this is a same-origin stream proxy, not an open proxy. The CDN path shapes
 * are stable: `/pl/<token>/…m3u8` (master + renditions) and `/content/…`.
 */
export function isVodTarget(u: string): boolean {
  try {
    const p = new URL(u).pathname;
    return p.includes("/pl/") || p.includes("/content/") || p.endsWith(".m3u8");
  } catch {
    return false;
  }
}

export type VsType = "movie" | "tv";

// Minimal structural WebAssembly typing (the server build has no DOM lib).
interface WebAssemblyLike {
  compile(bytes: ArrayBuffer): Promise<object>;
  instantiate(mod: object, imports: object): Promise<{ exports: unknown }>;
}

async function get(url: string, referer?: string): Promise<Response> {
  const headers: Record<string, string> = { "user-agent": UA, accept: "*/*" };
  if (referer) headers.referer = referer;
  return fetch(url, { headers, redirect: "follow" });
}

/** Resolve the decrypted, token-bearing stream URLs for a title. */
export async function resolveVsembed(
  tmdb: string,
  type: VsType,
  season?: number,
  episode?: number,
): Promise<string[]> {
  const srcRes = await get(
    `https://vsembed.ru/vs_src.php?type=${type}&id=${encodeURIComponent(tmdb)}`,
    "https://vsembed.ru/",
  );
  if (!srcRes.ok) return [];
  const src = ((await srcRes.json()) as { src?: string }).src;
  if (!src) return [];
  const origin = new URL(src).origin;

  const landing = await (await get(src, "https://vsembed.ru/")).text();
  const cfgMatch = landing.match(/window\.CFG\s*=\s*(\{[\s\S]*?\});/);
  if (!cfgMatch) return [];
  const cfg = JSON.parse(cfgMatch[1]) as { playerUrl?: string };
  if (!cfg.playerUrl) return [];

  const player = await (await get(origin + cfg.playerUrl, src)).text();
  const confMatch = player.match(/window\.CONFIG\s*=\s*(\{[\s\S]*?\});/);
  if (!confMatch) return [];
  const CONFIG = JSON.parse(confMatch[1]) as { apiToken?: string };
  if (!CONFIG.apiToken) return [];

  const ep =
    type === "tv" && season && episode
      ? `&season=${season}&episode=${episode}`
      : "";
  const api = `https://data.vidsrc.sh/api.php?type=${type}&tmdb=${encodeURIComponent(
    tmdb,
  )}${ep}&stream_urls&api_token=${encodeURIComponent(CONFIG.apiToken)}`;
  const sj = (await (await get(api, origin + cfg.playerUrl)).json()) as {
    data?: { stream_urls?: string | string[] };
    vs?: { wasm_url?: string; wasm?: string };
  };
  const raw = sj?.data?.stream_urls;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw !== "string" || !sj?.vs) return [];

  const WA = (globalThis as unknown as { WebAssembly: WebAssemblyLike })
    .WebAssembly;
  const wasmUrl = sj.vs.wasm_url;
  const wasmB64 = sj.vs.wasm;
  let bytes: ArrayBuffer;
  if (wasmUrl) bytes = await (await get(wasmUrl)).arrayBuffer();
  else if (wasmB64)
    bytes = Uint8Array.from(atob(wasmB64), (c) => c.charCodeAt(0)).buffer;
  else return [];

  const mod = await WA.compile(bytes);
  const ex = (await WA.instantiate(mod, {})).exports as {
    memory: { buffer: ArrayBufferLike };
    alloc: (n: number) => number;
    decrypt: (ptr: number, len: number) => number;
  };
  const enc = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  const text = new TextDecoder().decode(
    new Uint8Array(ex.memory.buffer, ptr + 12, outLen),
  );
  return text.split("\n").filter(Boolean);
}

// Per-host JWT cache (the CDN token is valid ~4h; 5-min cache is plenty).
const tokenCache = new Map<string, { token: string; ts: number }>();
const TOKEN_TTL = 5 * 60 * 1000;

/** Mint (or reuse) the per-host CDN JWT required as `?token=` on every file. */
export async function mintStreamToken(host: string): Promise<string> {
  const now = Date.now();
  const c = tokenCache.get(host);
  if (c && now - c.ts < TOKEN_TTL) return c.token;
  const res = await get(
    `${host}/generate.php`,
    "https://cloudorchestranova.com/",
  );
  const token = res.ok ? (await res.text()).trim() : "";
  if (token) tokenCache.set(host, { token, ts: now });
  return token;
}

// VOD proxy path. Vercel: /api/movies?mode=vod ; CF rewrites to the same.
const VOD_BASE = "/api/movies?mode=vod&url=";

function proxied(target: string, proxyOrigin: string): string {
  if (target.includes("/api/movies?mode=vod")) return target;
  return `${proxyOrigin}${VOD_BASE}${encodeURIComponent(target)}`;
}

/** Rewrite every child URL in an HLS playlist to route through the VOD proxy. */
export function rewritePlaylist(
  content: string,
  baseUrl: string,
  proxyOrigin: string,
): string {
  return content
    .split("\n")
    .map((line) => {
      if (line.startsWith("#") && line.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_m, u: string) => {
          try {
            return `URI="${proxied(new URL(u, baseUrl).href, proxyOrigin)}"`;
          } catch {
            return _m;
          }
        });
      }
      if (!line.startsWith("#") && line.trim()) {
        try {
          return proxied(new URL(line.trim(), baseUrl).href, proxyOrigin);
        } catch {
          return line;
        }
      }
      return line;
    })
    .join("\n");
}

/** Strip an existing `token=`/`api_token=` from a stream CDN URL. */
function stripToken(u: string): string {
  return u.replace(/([?&])(token|api_token)=[^&]*/g, "$1").replace(/[?&]$/, "");
}

/**
 * Fetch a playlist or segment from a stream CDN, minting/refreshing the
 * per-host token as needed (the token is bound to THIS function's IP).
 */
export async function fetchVod(
  target: string,
  proxyOrigin: string,
): Promise<{ body: unknown; status: number; type: string }> {
  const host = new URL(target).origin;
  const clean = stripToken(target);
  let token = await mintStreamToken(host);
  let res = await get(
    `${clean}?token=${encodeURIComponent(token)}`,
    `${host}/`,
  );

  // Token expired/rotated — mint once more and retry.
  if (res.status === 401 || res.status === 403) {
    tokenCache.delete(host);
    token = await mintStreamToken(host);
    res = await get(`${clean}?token=${encodeURIComponent(token)}`, `${host}/`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!res.ok) return { body: null, status: res.status, type: "text/plain" };

  const isPlaylist = ct.includes("mpegurl") || target.includes(".m3u8");
  if (isPlaylist) {
    const text = await res.text();
    return {
      body: rewritePlaylist(text, target, proxyOrigin),
      status: 200,
      type: "application/vnd.apple.mpegurl",
    };
  }
  return {
    body: res.body,
    status: 200,
    type: ct || "video/mp2t",
  };
}
