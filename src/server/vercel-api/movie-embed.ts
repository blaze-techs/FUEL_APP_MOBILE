/**
 * Movie Embed API (Vercel serverless)
 *
 * Ad-free, popup-proof, sandboxable movie/series embed chain.
 *
 * Why this exists: the public mirror embeds (vidsrc.to etc.) wrap the real
 * player in 2 ad-laden wrapper pages (popunders, ad networks, sandbox
 * detection that REFUSES sandboxed iframes). Reverse-engineering the chain
 * showed the FINAL player pages themselves are clean — the ads and the
 * sandbox detection live ONLY in the wrapper layers.
 *
 * So this function fetches the wrapper chain SERVER-SIDE (where ad scripts
 * never execute) and serves ONLY the clean final pages (landing + player)
 * from our own origin. Because the result is same-origin, the app can embed
 * it in a fully sandboxed iframe (no allow-popups / no allow-top-navigation)
 * — the browser then natively blocks any popup or redirect FOREVER, even if
 * a third-party script is injected upstream later.
 *
 * Modes:
 *   GET /api/movie-embed?type=movie&id=<tmdb>
 *   GET /api/movie-embed?type=tv&id=<tmdb>&season=<n>&episode=<n>
 *       -> resolves the gated landing page and serves it (rewritten).
 *
 *   GET /api/movie-embed?p=<upstream-path-or-absolute-url>
 *       -> reverse proxy for everything the clean pages reference:
 *          player pages, JS/CSS assets, HLS playlists (rewritten), segments,
 *          token endpoints, subtitles.
 *
 * Referer policy (reverse-engineered — the upstream gates on Referer):
 *   gate + landing            <- Referer: wrapper origin
 *   player pages + stream CDN <- Referer: player host origin
 *
 * Security/abuse controls:
 *   - only http(s) targets; absolute targets must match a media/CDN path
 *     pattern (no generic open proxying of arbitrary pages);
 *   - relative targets are pinned to the player host;
 *   - upstream secrets never touch the client (all requests carry the
 *     function's identity).
 */
import type { IncomingMessage, ServerResponse } from "http";

const PLAYER_HOST = "https://cloudorchestranova.com";
const GATE_URL = "https://vsembed.ru/vs_src.php";
const GATE_REFERER_BASE = "https://vsembed.ru/embed";
const CDN_REFERER = `${PLAYER_HOST}/`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PROXY_BASE = "/api/movie-embed?p=";

/**
 * Injected into every proxied HTML page. Routes cross-origin absolute URLs
 * (the rotating stream-CDN hosts, token endpoints) AND root-relative URLs
 * (dynamically injected scripts/iframes that bypass the fetch/XHR hooks —
 * e.g. the obfuscated segment-decoder script and the player iframe whose
 * src is assigned from JS) back through this proxy. Runs before any of the
 * proxied page's own scripts.
 */
const INTERCEPTOR = `<script>(function(){
var PX=${JSON.stringify(PROXY_BASE)};
function rw(u){
  try{
    if(typeof u!=="string"||!u)return u;
    if(u.indexOf(PX)===0)return u;
    if(u.indexOf("data:")===0||u.indexOf("blob:")===0||u.indexOf("javascript:")===0||u.indexOf("#")===0)return u;
    if(u.indexOf(location.origin)===0)return u;
    if(u.charAt(0)==="/"){return PX+encodeURIComponent(u);}
    if(/^https?:\\/\\//.test(u)){
      if(/data\\.vidsrcme\\.ru|image\\.tmdb\\.org|gstatic\\.com|jsdelivr\\.net|opensubtitles\\.org/.test(u))return u;
      return PX+encodeURIComponent(u);
    }
    return u;
  }catch(e){return u;}
}
var of=window.fetch;
if(of)window.fetch=function(i,init){try{if(typeof i==="string")i=rw(i);else if(i&&i.url)i=new Request(rw(String(i.url)),i);}catch(e){}return of.call(this,i,init);};
var oo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){try{u=rw(u);}catch(e){}return oo.apply(this,[m,u].concat([].slice.call(arguments,2)));};
var obs=navigator.sendBeacon;
if(obs)navigator.sendBeacon=function(u,d){try{u=rw(u);}catch(e){}return obs.call(navigator,u,d);};
["HTMLScriptElement","HTMLImageElement","HTMLIFrameElement","HTMLSourceElement","HTMLMediaElement","HTMLVideoElement","HTMLAudioElement","HTMLTrackElement"].forEach(function(tag){
  var proto=window[tag]&&window[tag].prototype;if(!proto)return;
  var desc=Object.getOwnPropertyDescriptor(proto,"src");
  if(desc&&desc.set){try{Object.defineProperty(proto,"src",{configurable:true,enumerable:desc.enumerable,get:desc.get,set:function(v){desc.set.call(this,rw(v));}});}catch(e){}}
});
var osa=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){try{if((n==="src"||n==="href")&&typeof v==="string")v=rw(v);}catch(e){}return osa.call(this,n,v);};
})();</script>`;

function rewriteHtml(html: string): string {
  // Strip the anti-tamper/devtools script (irrelevant on our origin, and it
  // can interfere with automated QA tooling).
  html = html.replace(/<script[^>]*disable-devtool[^>]*><\/script>/g, "");
  // Root-relative asset URLs in markup -> proxied (whole path encoded).
  html = html.replace(
    /(src|href)="(\/[^"]*)"/g,
    (_m, attr: string, path: string) =>
      path.startsWith("//")
        ? `${attr}="${PROXY_BASE}${encodeURIComponent(`https:${path}`)}"`
        : `${attr}="${PROXY_BASE}${encodeURIComponent(path)}"`,
  );
  // JSON-embedded relative URLs used by the landing page bootstrap.
  html = html.replace(
    /"(playerUrl|cacheBase)":"(\/[^"]*)"/g,
    (_m, key: string, path: string) =>
      `"${key}":"${PROXY_BASE}${encodeURIComponent(path)}"`,
  );
  if (html.includes("<head>"))
    html = html.replace("<head>", "<head>" + INTERCEPTOR);
  else html = INTERCEPTOR + html;
  return html;
}

function rewriteM3U8(text: string, targetUrl: string): string {
  const base = new URL(targetUrl);
  const resolve = (v: string): string => {
    if (!v || v.startsWith("data:") || v.startsWith("blob:")) return v;
    let abs: string;
    try {
      abs = new URL(v, base).href;
    } catch {
      return v;
    }
    return PROXY_BASE + encodeURIComponent(abs);
  };
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        return line.replace(
          /URI="([^"]*)"/g,
          (_m, v: string) => `URI="${resolve(v)}"`,
        );
      }
      return resolve(t);
    })
    .join("\n");
}

const MEDIA_PATH_RE =
  /\/pl\/|\/content\/|\/embed\/|\/assets\/|\/api\.php|\/generate\.php|\/cache\.php|\.m3u8(\?|$)|\.ts(\?|$)|\.mp4(\?|$)|\.m4s(\?|$)|\.vtt(\?|$)|\.srt(\?|$)|\.css(\?|$)|\.js(\?|$)|\.svg(\?|$)|\.png(\?|$)|\.jpe?g(\?|$)|\.webp(\?|$)|\.woff2?(\?|$)/i;

function isAllowedAbsolute(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  // Pin page/asset paths to the known hosts; allow media paths on ANY host
  // (the stream CDN hostnames rotate per session).
  const knownHosts =
    /(^|\.)(cloudorchestranova\.com|vsembed\.ru|vidapi\.cloud)$/i;
  if (knownHosts.test(u.hostname)) return true;
  return /\/pl\/|\/content\/|\/generate\.php|\.m3u8(\?|$)|\.ts(\?|$)|\.mp4(\?|$)|\.m4s(\?|$)/i.test(
    u.pathname,
  );
}

function errorPage(title: string, detail: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;background:#000;color:#888;font:14px system-ui;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px">${title}<br><span style="font-size:12px;color:#555">${detail}</span></body></html>`;
}

async function pipeUpstream(
  req: IncomingMessage,
  res: ServerResponse,
  target: string,
  referer: string,
): Promise<void> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: referer,
  };
  const range = req.headers["range"];
  if (typeof range === "string") headers["range"] = range;

  let body: Buffer | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (d) => chunks.push(d));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: body as unknown as undefined,
  });

  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  const outHeaders: Record<string, string> = {
    "content-type": ct,
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };
  if (typeof range === "string") {
    for (const h of ["content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) outHeaders[h] = v;
    }
  }

  const isMediaPath =
    /\/pl\/|\/content\/|\.m3u8(\?|$)|\.ts(\?|$)|\.mp4(\?|$)|\.m4s(\?|$)|\.vtt(\?|$)/i.test(
      target,
    );

  if (isMediaPath) {
    // Playlist or segment — never treat as HTML (the CDN serves segments as
    // text/html; rewriting them as text corrupts the binary payload).
    const buf = Buffer.from(await upstream.arrayBuffer());
    const head = buf.subarray(0, 16).toString("latin1");
    if (head.includes("#EXTM3U")) {
      const pl = rewriteM3U8(buf.toString("utf8"), target);
      outHeaders["content-type"] = "application/vnd.apple.mpegurl";
      res.writeHead(upstream.status, outHeaders);
      res.end(pl);
    } else {
      res.writeHead(upstream.status, outHeaders);
      res.end(buf);
    }
    return;
  }

  if (ct.includes("text/html")) {
    let html = await upstream.text();
    html = rewriteHtml(html);
    res.writeHead(upstream.status, outHeaders);
    res.end(html);
    return;
  }

  if (target.includes("disable-devtool")) {
    res.writeHead(200, { "content-type": "application/javascript" });
    res.end("");
    return;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, outHeaders);
  res.end(buf);
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const fullUrl = req.url || "";
  const qIdx = fullUrl.indexOf("?");
  const params = new URLSearchParams(qIdx >= 0 ? fullUrl.slice(qIdx + 1) : "");

  try {
    const p = params.get("p");
    if (p) {
      // ── Reverse-proxy mode ──
      if (p.startsWith("/")) {
        // Root-relative path pinned to the player host.
        const referer = p.includes("/embed/player/")
          ? CDN_REFERER
          : `${GATE_REFERER_BASE}/movie/0/`;
        await pipeUpstream(req, res, PLAYER_HOST + p, referer);
        return;
      }
      let u: URL;
      try {
        u = new URL(p);
      } catch {
        res.statusCode = 400;
        res.end("bad target");
        return;
      }
      if (!isAllowedAbsolute(u)) {
        res.statusCode = 403;
        res.end("target not allowed");
        return;
      }
      await pipeUpstream(req, res, u.href, CDN_REFERER);
      return;
    }

    // ── Landing mode ──
    const type = params.get("type") === "tv" ? "tv" : "movie";
    const id = params.get("id") || "";
    if (!/^\d+$/.test(id)) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html");
      res.end(errorPage("Missing title id", "A valid TMDB id is required."));
      return;
    }
    let gateUrl = `${GATE_URL}?type=${type}&id=${id}`;
    if (type === "tv") {
      const season = Math.max(
        1,
        parseInt(params.get("season") || "1", 10) || 1,
      );
      const episode = Math.max(
        1,
        parseInt(params.get("episode") || "1", 10) || 1,
      );
      gateUrl += `&season=${season}&episode=${episode}`;
    }
    const gateReferer = `${GATE_REFERER_BASE}/${type}/${id}/`;
    const gateResp = await fetch(gateUrl, {
      headers: { "User-Agent": UA, Referer: gateReferer },
    });
    const gateJson = (await gateResp.json()) as { src?: string };
    if (
      !gateJson ||
      typeof gateJson.src !== "string" ||
      !gateJson.src.startsWith("http")
    ) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/html");
      res.end(
        errorPage(
          "Stream unavailable",
          "The source gate did not return a playable session.",
        ),
      );
      return;
    }
    const landingResp = await fetch(gateJson.src, {
      headers: { "User-Agent": UA, Referer: gateReferer },
    });
    if (!landingResp.ok) {
      res.statusCode = 502;
      res.setHeader("content-type", "text/html");
      res.end(
        errorPage(
          "Stream unavailable",
          `The source returned HTTP ${landingResp.status}.`,
        ),
      );
      return;
    }
    let html = await landingResp.text();
    html = rewriteHtml(html);
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(html);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/html");
    res.end(errorPage("Stream error", String(e).slice(0, 160)));
  }
}
