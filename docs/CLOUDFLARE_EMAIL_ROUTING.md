# FuelPro support email — Cloudflare Email Routing

Public support address: **support@fuelpro.com**

FuelPro uses Cloudflare Email Routing for incoming support mail. Cloudflare requires a verified destination address before a routing rule can be activated.

## Production setup

1. In Cloudflare, open **Compute → Email Service → Email Routing** for the `fuelpro.com` zone.
2. Onboard the domain if it is not already onboarded.
3. Add the real support mailbox as a **Destination address** and complete Cloudflare verification.
4. Create a routing rule for `support` on `fuelpro.com` with action **Send to an email** and select the verified destination.
5. Test from a different mailbox.

The destination mailbox is not stored in the frontend or repository. A phone number is not hard-coded until FuelPro provisions an owned/verified number; then set `VITE_SUPPORT_PHONE` in production.

## Check whether provisioning is done

Run the readiness probe — it resolves the public DNS records over
DNS-over-HTTPS, needs no provider credentials, and exits non-zero while the
mailbox cannot receive mail:

```bash
node scripts/check-support-mailbox.mjs            # defaults to fuelpro.com
```

Exit `0` means MX + SPF are published and the address can receive mail.

## Verified state (2026-09-19)

The probe reports `mailboxReady: false`. The records currently published on
`fuelpro.com` are:

| Record         | Value                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| MX             | **none** — the domain cannot receive mail                                                    |
| SPF            | `v=spf1 include:spf.octane-systems.com -all`                                                 |
| DMARC          | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s; rua=mailto:…@dmarc-reports.cloudflare.net;` |
| `*._domainkey` | `v=DKIM1; p=` (empty key — placeholder only)                                                 |

SPF shows **Octane Systems** is (or was) the mail host, and DMARC is already
at `p=reject`, so the remaining step is publishing Octane's MX records.

The zone's nameservers are `alexandra.ns.cloudflare.com` /
`melnicoff.ns.cloudflare.com` — a **different** Cloudflare account from the one
the deployment token belongs to (that token is Pages-scoped and cannot read
DNS at all), so the records cannot be published from this repository.
`fuelpropay.com` is unregistered (NXDOMAIN) and cannot be used as a fallback
domain. Provisioning therefore requires the domain owner's login at the mail
provider. The mailbox password belongs in that provider — never in this repo
or the app.
