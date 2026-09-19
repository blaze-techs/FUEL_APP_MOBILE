# FuelPro Cloudflare email workflow

FuelPro uses Cloudflare Email Service as the primary email transport.

## Outbound application mail

The Communication module sends through the existing authenticated FuelPro integration API with provider `cloudflare`. The backend calls Cloudflare Email Service's REST endpoint; Cloudflare credentials remain server-side.

Required server environment variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_EMAIL_API_TOKEN` (preferred) or `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_EMAIL_FROM` (recommended: `support@fuelpro.com`)

The Cloudflare token must have **Email Sending: Edit** and the sender domain must be onboarded under Cloudflare Email Service.

## Incoming mail

`workers/email-router` is an Email Routing Worker. Route `support@fuelpro.com` to the Worker in Cloudflare Email Routing. The Worker forwards mail to the verified destination configured as `SUPPORT_FORWARD_TO`.

The destination mailbox is intentionally not committed to source control.

## Production checklist

1. Onboard `fuelpro.com` under Cloudflare Email Service > Email Sending and allow Cloudflare to create SPF/DKIM/bounce records.
2. Enable Email Routing for `fuelpro.com`.
3. Verify the real support destination mailbox.
4. Deploy `fuelpro-email-router`.
5. Add a routing rule: `support@fuelpro.com` -> Worker `fuelpro-email-router`.
6. Set the same Cloudflare account ID and an Email Sending token in the Vercel production environment.
7. In FuelPro Communication > Settings, enable Email and select Cloudflare Email Service.
8. Send a real test from FuelPro, then reply to verify the inbound route.

Do not store the Cloudflare API token in the browser, localStorage, Supabase app_kv, or Communication settings.
