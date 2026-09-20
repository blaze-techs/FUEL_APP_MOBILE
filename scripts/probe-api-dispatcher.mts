// Invoke the dispatcher the way Vercel does after the vercel.json rewrite:
// the real path arrives split out into the `[...path]` query param.
process.env.SUPABASE_URL ||= "https://ojjscjwatikixlpshmub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "x";

const { default: handler } =
  await import("/workspace/project/FUEL_APP_MOBILE/api/[[...path]].ts");

const call = (url) =>
  new Promise((resolve) => {
    const req = { url, method: "GET", headers: {}, socket: {} };
    const res = {
      statusCode: 0,
      _h: {},
      headersSent: false,
      setHeader(k, v) {
        this._h[k] = v;
      },
      end(b) {
        resolve({ code: this.statusCode, body: String(b).slice(0, 110) });
      },
    };
    handler(req, res);
  });

const cases = [
  "/api/system/health?[...path]=system/health",
  "/api/operations/sale?[...path]=operations/sale",
  "/api/cron/monthly-fuel-sync?[...path]=cron/monthly-fuel-sync",
  "/api/movies?[...path]=movies&mode=catalog",
  "/api/zzz/nope?[...path]=zzz/nope",
];

for (const u of cases) {
  const r = await call(u);
  console.log(
    String(r.code).padEnd(4),
    u.split("?")[0].padEnd(30),
    "->",
    r.body.replace(/\s+/g, " "),
  );
}
