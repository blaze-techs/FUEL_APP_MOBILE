import { chromium } from "playwright";

const HOSTS = [
  "https://fuel-app-mobile.vercel.app",
  "https://fuel-app-mobile.pages.dev",
];
const ROUTES: [string, string][] = [
  ["velgg:bo1z", "/api/velgg/bo1z"],
  ["quenq:8-ball-pool", "/api/quenq-embed/8-ball-pool"],
  ["crazy:moto-x3m", "/api/game-embed/moto-x3m"],
  ["gd:moto-x3m", "/api/game-embed/gd/5b0abd4c0faa4f5eb190a9a16d5a1b4c/"],
  ["minecraft", "/api/game-mirror/minecraft/"],
  ["archive:doom", "/api/game-mirror/archive/embed/dosbox-doom"],
  ["isle", "/api/game-mirror/isle/"],
  ["pokered", "/api/game-mirror/pokered/"],
  ["redcoats", "/api/game-mirror/redcoats/app/"],
  ["saltyseas", "/api/game-mirror/saltyseas/app/"],
  ["taipeirush", "/api/game-mirror/taipeirush/"],
  ["seedbed", "/api/game-mirror/seedbed/"],
];

const b = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
let fails = 0;
for (const host of HOSTS) {
  console.log(`\n=== ${host} ===`);
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(host + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  // 1) shim marker present in served HTML
  for (const [name, route] of ROUTES) {
    const r = await p.evaluate(async (src) => {
      try {
        const txt = await (await fetch(src, { credentials: "omit" })).text();
        return { len: txt.length, shim: txt.includes("__fpWebglShim") };
      } catch (e) {
        return { len: -1, shim: false, err: String(e) };
      }
    }, route);
    const ok = r.len > 0 && r.shim;
    if (!ok) fails++;
    console.log(
      `  ${ok ? "OK  " : "FAIL"} ${name.padEnd(18)} len=${r.len} shim=${r.shim}`,
    );
  }
  // 2) in-tab render check under the host's real COEP shell
  for (const [name, route] of ROUTES) {
    const r = await p.evaluate(
      (src) =>
        new Promise<any>((res) => {
          const f = document.createElement("iframe");
          f.style.cssText = "width:900px;height:600px";
          f.src = src;
          document.body.appendChild(f);
          setTimeout(() => {
            let n = -1;
            let err = "";
            try {
              n = (f.contentWindow as any).document.body.innerHTML.length;
            } catch (e) {
              err = "x-origin";
            }
            res({ n, err });
          }, 9000);
        }),
      route,
    );
    const ok = r.n > 0 && !r.err;
    if (!ok) fails++;
    console.log(
      `  ${ok ? "OK  " : "FAIL"} frame:${name.padEnd(12)} bodyLen=${r.n}${r.err ? " err=" + r.err : ""}`,
    );
  }
  await ctx.close();
}
console.log(`\nFAILURES: ${fails}`);
await b.close();
process.exit(fails ? 1 : 0);
