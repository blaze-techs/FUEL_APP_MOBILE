// Local dev server that mimics deployed routing: serves the quenq-embed route
// (same logic) + a parent page on a single origin, so we can verify the
// SAME-ORIGIN Ruffle fix renders a canvas.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { serveQuenqEmbed } from "../api/_lib/quenq-embed.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8333;

const parent = `<!DOCTYPE html><html><body style="margin:0">
<iframe id="frame" src="/api/quenq-embed/8-ball-pool" style="width:800px;height:600px;border:0"></iframe>
</body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(parent);
    return;
  }
  if (url.pathname.startsWith("/api/quenq-embed/")) {
    const slug = url.pathname.split("/").filter(Boolean)[2] || "";
    const r = await serveQuenqEmbed(slug);
    res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
    res.end(await r.text());
    return;
  }
  res.writeHead(404); res.end("nf");
});

server.listen(PORT, () => console.log("listening", PORT));
