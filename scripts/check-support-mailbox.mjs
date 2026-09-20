#!/usr/bin/env node
/**
 * Support-mailbox readiness probe.
 *
 * `support@fuelpro.com` is an EXTERNAL infrastructure dependency: the domain
 * owner provisions the mailbox at a mail provider (MX + SPF + DKIM + DMARC)
 * before the address can receive mail. This script answers one question —
 * "is that provisioning done yet?" — without needing provider credentials.
 *
 * It resolves the public DNS records over DNS-over-HTTPS (Google) so it works
 * from any environment, including sandboxes with no resolver configured.
 *
 * Usage:  node scripts/check-support-mailbox.mjs [domain]
 * Exit 0 when the domain is mailbox-ready, 1 otherwise (never throws).
 */

const DOMAIN = process.argv[2] || "fuelpro.com";
const MAILBOX = `support@${DOMAIN}`;

const doh = async (name, type) => {
  const res = await fetch(
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    { headers: { Accept: "application/dns-json" } },
  );
  if (!res.ok) throw new Error(`DoH ${type} ${name} -> HTTP ${res.status}`);
  return res.json();
};

const records = (json) => (json.Answer || []).map((a) => a.data);

const txtFlatten = (data) => data.replace(/^"|"$/g, "").replace(/"\s+"/g, "");

const main = async () => {
  const out = { domain: DOMAIN, mailbox: MAILBOX, checks: {} };

  const [mx, spf, dmarc, a] = await Promise.all([
    doh(DOMAIN, "MX").catch((e) => ({ error: e.message })),
    doh(DOMAIN, "TXT").catch((e) => ({ error: e.message })),
    doh(`_dmarc.${DOMAIN}`, "TXT").catch((e) => ({ error: e.message })),
    doh(DOMAIN, "A").catch((e) => ({ error: e.message })),
  ]);

  const mxRecords = records(mx).sort(
    (x, y) => (parseInt(x, 10) || 0) - (parseInt(y, 10) || 0),
  );
  const txtRecords = records(spf).map(txtFlatten);
  const spfRecord = txtRecords.find((t) => /^v=spf1/i.test(t)) || "";
  const dmarcRecords = records(dmarc).map(txtFlatten);
  const dmarcRecord = dmarcRecords.find((t) => /^v=DMARC1/i.test(t)) || "";

  out.checks.mx = mxRecords;
  out.checks.spf = spfRecord;
  out.checks.dmarc = dmarcRecord;
  out.checks.a = records(a);

  const ready = mxRecords.length > 0 && Boolean(spfRecord);
  out.mailboxReady = ready;

  console.log(JSON.stringify(out, null, 2));
  console.log("");
  if (!ready) {
    console.log(`NOT PROVISIONED — ${MAILBOX} cannot receive mail yet.`);
    if (!mxRecords.length) {
      console.log(
        `  • No MX records on ${DOMAIN}. Add your mail provider's MX records ` +
          `at the DNS host (Cloudflare for this zone).`,
      );
    }
    if (!spfRecord) {
      console.log(
        `  • No SPF record (v=spf1). Add one so replies are not marked spam.`,
      );
    }
    if (!dmarcRecord) {
      console.log(
        `  • No DMARC record (_dmarc.${DOMAIN}). Recommended, not blocking.`,
      );
    }
    console.log(
      `  See docs/CLOUDFLARE_EMAIL_ROUTING.md for the step-by-step setup.`,
    );
  } else {
    console.log(`READY — ${MAILBOX} has MX + SPF and can receive mail.`);
    if (!dmarcRecord) {
      console.log(`  • DMARC still missing (deliverability hardening).`);
    }
  }

  process.exit(ready ? 0 : 1);
};

main().catch((err) => {
  console.error("probe failed:", err.message);
  process.exit(1);
});
