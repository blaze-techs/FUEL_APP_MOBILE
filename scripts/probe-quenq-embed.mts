import { serveQuenqEmbed } from "../api/_lib/quenq-embed.js";

const res = await serveQuenqEmbed("8-ball-pool");
const html = await res.text();
console.log("status", res.status);
console.log("XFO", res.headers.get("X-Frame-Options"));
console.log("ACAO", res.headers.get("Access-Control-Allow-Origin"));
console.log("has swf url", html.includes("8-ball-pool.swf"));
console.log("has ruffle", html.includes("@ruffle-rs/ruffle"));
console.log("has ads?", /adsbygoogle|googletag|doubleclick/i.test(html));
