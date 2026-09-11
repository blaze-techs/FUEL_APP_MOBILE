/**
 * Server-side Supabase admin client.
 *
 * Uses the SERVICE ROLE key which bypasses RLS — so this module must NEVER be
 * imported by anything that ends up in the client bundle (no `src/react-app/`
 * imports). It is only referenced by `api/*.ts` serverless functions, which
 * Vercel/Cloudflare run in a serverless (Node) context, not the browser.
 *
 * The keys are read from process.env so they stay out of the VITE_-prefixed
 * build-time environment and are never shipped to the browser.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://ojjscjwatikixlpshmub.supabase.co";

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  // Don't throw at module load — the serverless function may handle the
  // missing-key case gracefully (e.g. fall back to another data source).
  // Consumers must check `supabaseAdmin` for null before use.
  console.warn(
    "[supabase-admin] SUPABASE_SERVICE_ROLE_KEY is not set — admin client is unavailable.",
  );
}

export const supabaseAdmin = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
