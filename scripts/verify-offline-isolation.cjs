/**
 * Live check that the cross-account cache isolation is actually deployed.
 *
 * Rather than re-implementing the fix, this inspects the SHIPPED bundle: the
 * account-scoped key prefix and the owner marker must be present, and no
 * component may still read the legacy global business-data keys directly.
 *
 * Exits non-zero when a host is serving a build that can leak another
 * account's cached rows.
 */
const HOSTS = process.argv.slice(2);
const TARGETS = HOSTS.length
  ? HOSTS
  : ["https://fuel-app-mobile.pages.dev", "https://fuel-app-mobile.vercel.app"];

// Business-data keys that used to be read straight from a global localStorage
// key. A shipped bundle must not contain these direct reads any more.
const LEGACY_READS = [
  "fuelpro_pos_transactions",
  "fuelpro_credit_accounts",
  "fuelpro_credit_tx",
  "fuelpro_payroll_employees",
  "fuelpro_payroll_settings",
  "fuelpro_customers",
  "fuelpro_employees",
  "fuelpro_shifts",
  "fuelpro_news_bookmarks",
  "fuelpro_news_read",
  "fuelpro_custom_fuel_types",
  "fuelpro_inventory",
];

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

(async () => {
  let failed = false;

  for (const host of TARGETS) {
    const html = await fetchText(host + "/");
    const chunkPaths = [
      ...new Set(
        [...html.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]),
      ),
    ];

    let scopedPrefix = false;
    let ownerMarker = false;
    const leaked = new Set();

    for (const p of chunkPaths) {
      let body;
      try {
        body = await fetchText(`${host}/${p}`);
      } catch {
        continue;
      }
      if (body.includes("fuelpro_scoped_")) scopedPrefix = true;
      if (body.includes("__owner")) ownerMarker = true;
      for (const k of LEGACY_READS) {
        if (body.includes(`localStorage.getItem("${k}")`)) leaked.add(k);
      }
    }

    const ok = scopedPrefix && ownerMarker && leaked.size === 0;
    console.log(
      JSON.stringify(
        {
          host,
          chunks: chunkPaths.length,
          scopedPrefix,
          ownerMarker,
          legacyGlobalReads: [...leaked],
          pass: ok,
        },
        null,
        2,
      ),
    );
    if (!ok) failed = true;
  }

  process.exit(failed ? 1 : 0);
})();