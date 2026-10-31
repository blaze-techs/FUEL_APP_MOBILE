# Google sign-in setup for FuelPro

FuelPro uses Supabase Auth for Google sign-in. The browser's Google Identity Services flow exchanges an ID token with Supabase; the OAuth redirect flow is a fallback.

## Google Cloud OAuth client

Use a **Web application** OAuth client.

- Authorized JavaScript origins:
  - `https://fuel-app-mobile.pages.dev`
  - `https://fuel-app-mobile.vercel.app` (only if this deployment is used)
  - `http://localhost:5173` (local development only)
- Authorized redirect URI for Supabase OAuth fallback:
  - `https://ojjscjwatikixlpshmub.supabase.co/auth/v1/callback`

The Google OAuth client secret must stay server-side / in the Supabase provider settings. Never commit it or expose it in `VITE_*`, `NEXT_PUBLIC_*`, frontend bundles, or logs.

## Supabase

In **Authentication → Sign In / Providers → Google**:

1. Enable Google.
2. Set the Google Client ID to the same Web OAuth client used by the app.
3. Set the matching Google Client Secret in the Supabase dashboard (not in source control).
4. In **Authentication → URL Configuration**, set the site URL to `https://fuel-app-mobile.pages.dev` and add the active deployment URLs plus `http://localhost:5173` to the allowed redirect URLs.
5. Save and test both new-account registration and returning-user login.

## Deployment variables

Set `VITE_GOOGLE_CLIENT_ID` to the same public Google OAuth client ID in each Vite build environment (Cloudflare Pages, Vercel, and any Railway-hosted frontend build). Rebuild/redeploy after changing it. The code includes a matching public-client fallback, so this variable is optional for the Pages deployment but recommended for environment consistency.

## Security follow-up

If a Google client secret was shared in a chat, rotate it in Google Cloud Console and update the Supabase Google provider with the new secret. Do not reuse the exposed secret.
