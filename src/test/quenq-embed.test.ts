import { describe, it, expect } from "vitest";
import {
  buildRufflePage,
  serveQuenqEmbed,
  QUENQ_GAME_BASE,
  QUENQ_RUFFLE_CDN,
} from "../../src/server/vercel-api/_lib/quenq-embed";

const SWF_SHELL = `<!DOCTYPE html>
<html><head><title>8 Ball Pool</title></head><body>
<script>function loadLocalRuffle(){}</script>
<div id="ruffle"></div>
<script>
window.addEventListener("load", () => {
  const ruffle = window.RufflePlayer.newest();
  const player = ruffle.createPlayer();
  container.appendChild(player);
  player.load("8-ball-pool.swf");
});
</script>
</body></html>`;

describe("Quenq embed lib — buildRufflePage", () => {
  it("builds a self-contained, ad-free Ruffle player page", () => {
    const html = buildRufflePage(
      "8-ball-pool",
      `${QUENQ_GAME_BASE}8-ball-pool/8-ball-pool.swf`,
    );
    expect(html).toContain(QUENQ_RUFFLE_CDN);
    expect(html).toContain("RufflePlayer.newest()");
    expect(html).toContain("8-ball-pool.swf");
    // NO ads / no quenq shell
    expect(html).not.toContain("adsbygoogle");
    expect(html).not.toContain("pagead2.googlesyndication.com");
    expect(html).not.toContain("googletagmanager");
  });

  it("sanitizes dangerous slugs out of the page", () => {
    const html = buildRufflePage(
      "<script>alert(1)</script>",
      "https://quenq.com/x.swf",
    );
    // The injected slug is sanitized to an empty/garbage-free token, so no
    // live script tag from the slug survives in the generated HTML.
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("quenq.com/x.swf");
    expect(html).toContain(`window.__QUENQ_SWF__`);
  });
});

describe("Quenq embed lib — serveQuenqEmbed", () => {
  it("returns a same-origin Ruffle page with SAMEORIGIN framing + CORS", async () => {
    const fetchMock = async () =>
      new Response(SWF_SHELL, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    const res = await serveQuenqEmbed("8-ball-pool", fetchMock as typeof fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("8-ball-pool.swf");
    expect(html).not.toContain("adsbygoogle");
  });

  it("falls back to <slug>.swf when the shell cannot be fetched", async () => {
    const fetchMock = async () => new Response("nope", { status: 404 });
    const res = await serveQuenqEmbed("age-of-war", fetchMock as typeof fetch);
    const html = await res.text();
    expect(html).toContain("age-of-war.swf");
  });

  it("rejects empty slugs", async () => {
    const res = await serveQuenqEmbed(
      "",
      () => Promise.reject(new Error("never")) as never,
    );
    expect(res.status).toBe(400);
  });
});
