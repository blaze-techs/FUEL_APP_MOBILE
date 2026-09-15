/**
 * Quenq Embed Proxy — Vercel Edge
 *
 * Serves a same-origin Ruffle player page for any of quenq.com's 1,316 arcade
 * games so the `VIDEO GAMES` tab can iframe it ad-free (the "make quenq games
 * actually playable" fix). See api/_lib/quenq-embed.ts for why.
 *
 *   /api/quenq-embed/<slug> → self-contained Ruffle player page (same origin)
 */
import { serveQuenqEmbed } from "../_lib/quenq-embed.js";

export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // [api, quenq-embed, slug]
  const slug = parts[2] || "";
  return serveQuenqEmbed(slug, fetch);
}
