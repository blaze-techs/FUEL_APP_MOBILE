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
