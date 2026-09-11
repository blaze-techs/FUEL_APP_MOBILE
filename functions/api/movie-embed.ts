/**
 * Cloudflare Pages Function — Movie Embed API
 *
 * Mirrors the Vercel handler in api/movie-embed.ts (self-contained because
 * Cloudflare Pages Functions bundle each file independently). See that file
 * for the full design rationale.
 *
 * Ad-free, popup-proof, sandboxable movie/series embed chain: the public
 * mirror embeds wrap the real player in ad-laden wrapper pages with sandbox
 * detection; the FINAL player pages are clean. This function fetches the
 * chain server-side and serves only the clean pages from our own origin, so
 * the app can embed them in a fully sandboxed same-origin iframe — the
 * browser then natively blocks popups/redirects forever.
 *
 *   GET /api/movie-embed?type=movie&id=<tmdb>
 *   GET /api/movie-embed?type=tv&id=<tmdb>&season=<n>&episode=<n>
 *   GET /api/movie-embed?p=<upstream-path-or-absolute-url>
 */

const PLAYER_HOST = "https://cloudorchestranova.com";
const GATE_URL = "https://vsembed.ru/vs_src.php";
const GATE_REFERER_BASE = "https://vsembed.ru/embed";
const CDN_REFERER = `${PLAYER_HOST}/`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PROXY_BASE = "/api/movie-embed?p=";

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
  html = html.replace(/<script[^>]*disable-devtool[^>]*><\/script>/g, "");
  html = html.replace(
    /(src|href)="(\/[^"]*)"/g,
    (_m, attr: string, path: string) =>
      path.startsWith("//")
        ? `${attr}="${PROXY_BASE}${encodeURIComponent(`https:${path}`)}"`
        : `${attr}="${PROXY_BASE}${encodeURIComponent(path)}"`,
  );
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

function isAllowedAbsolute(u: URL): boolean {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
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
  request: Request,
  target: string,
  referer: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: referer,
  };
  const range = request.headers.get("range");
  if (range) headers["range"] = range;

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : null,
  });

  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  const outHeaders: Record<string, string> = {
    "content-type": ct,
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  };
  if (range) {
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
    const buf = await upstream.arrayBuffer();
    const head = new TextDecoder("latin1").decode(
      new Uint8Array(buf).subarray(0, 16),
    );
    if (head.includes("#EXTM3U")) {
      const pl = rewriteM3U8(new TextDecoder().decode(buf), target);
      outHeaders["content-type"] = "application/vnd.apple.mpegurl";
      return new Response(pl, { status: upstream.status, headers: outHeaders });
    }
    return new Response(buf, { status: upstream.status, headers: outHeaders });
  }

  if (ct.includes("text/html")) {
    const html = rewriteHtml(await upstream.text());
    return new Response(html, { status: upstream.status, headers: outHeaders });
  }

  if (target.includes("disable-devtool")) {
    return new Response("", {
      status: 200,
      headers: {
        "content-type": "application/javascript",
        "cache-control": "no-store",
      },
    });
  }

  const buf = await upstream.arrayBuffer();
  return new Response(buf, { status: upstream.status, headers: outHeaders });
}

export async function onRequest(context: {
  request: Request;
}): Promise<Response> {
  const { request } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Range",
      },
    });
  }

  const url = new URL(request.url);

  try {
    const p = url.searchParams.get("p");
    if (p) {
      if (p.startsWith("/")) {
        const referer = p.includes("/embed/player/")
          ? CDN_REFERER
          : `${GATE_REFERER_BASE}/movie/0/`;
        return await pipeUpstream(request, PLAYER_HOST + p, referer);
      }
      let u: URL;
      try {
        u = new URL(p);
      } catch {
        return new Response("bad target", { status: 400 });
      }
      if (!isAllowedAbsolute(u)) {
        return new Response("target not allowed", { status: 403 });
      }
      return await pipeUpstream(request, u.href, CDN_REFERER);
    }

    const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
    const id = url.searchParams.get("id") || "";
    if (!/^\d+$/.test(id)) {
      return new Response(
        errorPage("Missing title id", "A valid TMDB id is required."),
        {
          status: 400,
          headers: { "content-type": "text/html" },
        },
      );
    }
    let gateUrl = `${GATE_URL}?type=${type}&id=${id}`;
    if (type === "tv") {
      const season = Math.max(
        1,
        parseInt(url.searchParams.get("season") || "1", 10) || 1,
      );
      const episode = Math.max(
        1,
        parseInt(url.searchParams.get("episode") || "1", 10) || 1,
      );
      gateUrl += `&season=${season}&episode=${episode}`;
    }
    const gateReferer = `${GATE_REFERER_BASE}/${type}/${id}/`;
    const gateResp = await fetch(gateUrl, {
      headers: {
        "User-Agent": UA,
        Referer: gateReferer,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const gateText = await gateResp.text();
    let gateJson: { src?: string } | null = null;
    try {
      gateJson = JSON.parse(gateText) as { src?: string };
    } catch {
      gateJson = null;
    }
    if (
      !gateJson ||
      typeof gateJson.src !== "string" ||
      !gateJson.src.startsWith("http")
    ) {
      const debug = url.searchParams.get("debug") === "1";
      return new Response(
        errorPage(
          "Stream unavailable",
          debug
            ? `gate HTTP ${gateResp.status}: ${gateText.slice(0, 180).replace(/</g, "&lt;")}`
            : "The source gate did not return a playable session.",
        ),
        { status: 502, headers: { "content-type": "text/html" } },
      );
    }
    const landingResp = await fetch(gateJson.src, {
      headers: { "User-Agent": UA, Referer: gateReferer },
    });
    if (!landingResp.ok) {
      return new Response(
        errorPage(
          "Stream unavailable",
          `The source returned HTTP ${landingResp.status}.`,
        ),
        { status: 502, headers: { "content-type": "text/html" } },
      );
    }
    const html = rewriteHtml(await landingResp.text());
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return new Response(errorPage("Stream error", String(e).slice(0, 160)), {
      status: 500,
      headers: { "content-type": "text/html" },
    });
  }
}
