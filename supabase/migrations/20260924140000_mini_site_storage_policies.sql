-- Mini Site storage policies (the "mini site" public station website)
--
-- A published mini site is a compact, curated, READ-ONLY JSON document:
--   fuelpro-files/mini-site/<slug>/site.json
--
-- The `fuelpro-files` bucket is already PUBLIC (fuelpro_files_public_read
-- SELECT policy on storage.objects), so the document is fetchable by an
-- anonymous visitor with a plain GET and no Authorization header. That is
-- intentional: the mini site is a public marketing page and its readers have
-- no Supabase session, so RLS on app_kv would block them.
--
-- The existing owner-scoped upload/update policies use
-- `(storage.foldername(name))[2] = auth.uid()`, which matches
-- `logos/<uid>/...` and `documents/<uid>/...` but NOT
-- `mini-site/<slug>/...` (foldername[1] is 'mini-site' and foldername[2] is
-- the SLUG, not the uid). Without these policies the owner's publish upload
-- is rejected by Storage RLS.
--
-- These policies are narrowed to the STATION THAT CLAIMED THE SLUG (see
-- `minisite_slug_claims` above). The document contains only content the owner
-- chose to publish (station name, address, phone, published fuel prices,
-- marketing copy) and is never a path to another station's private rows — a
-- station's private data lives in app_kv, guarded by owner-scoped RLS.

-- ── Slug ownership ────────────────────────────────────────────────────────
-- The slug is the public address, so it must be a first-come claim: without
-- this, ANY authenticated user could upsert `mini-site/<slug>/site.json` and
-- overwrite the station that already owns that address (the `mini-site/`
-- prefix is shared by every tenant, and the document itself carries no owner).
-- Storage RLS cannot see application state, so ownership lives in this table
-- and the write policies below test it.
--
-- `auth.uid()` is the only trusted source of the owner (a policy cannot be
-- fooled by a forged body field), so a client cannot claim a slug on behalf of
-- someone else.
CREATE TABLE IF NOT EXISTS public.minisite_slug_claims (
  slug text PRIMARY KEY,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS minisite_slug_claims_owner_idx
  ON public.minisite_slug_claims (owner_id);

ALTER TABLE public.minisite_slug_claims ENABLE ROW LEVEL SECURITY;

-- An authenticated user may read a claim (to see whether a slug is taken) and
-- create their OWN claim. They may not hand a slug to another user, and the
-- PRIMARY KEY makes the first claim win: a second user's INSERT conflicts.
DROP POLICY IF EXISTS minisite_claims_read ON public.minisite_slug_claims;
CREATE POLICY minisite_claims_read
  ON public.minisite_slug_claims
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS minisite_claims_insert_own ON public.minisite_slug_claims;
CREATE POLICY minisite_claims_insert_own
  ON public.minisite_slug_claims
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- No UPDATE/DELETE policy: a claim is released only by deleting the station's
-- own document through the deliberate path, never by rewriting the owner.

-- Claim helper. Returns true when the caller now owns the slug (or already
-- did). SECURITY DEFINER so the check is not affected by RLS ordering, but the
-- owner is always `auth.uid()` — never a parameter — so it cannot be spoofed.
CREATE OR REPLACE FUNCTION public.minisite_claim_slug(p_slug text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'invalid slug';
  END IF;

  INSERT INTO public.minisite_slug_claims (slug, owner_id)
  VALUES (p_slug, v_uid)
  ON CONFLICT (slug) DO NOTHING;

  RETURN EXISTS (
    SELECT 1 FROM public.minisite_slug_claims
    WHERE slug = p_slug AND owner_id = v_uid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.minisite_claim_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.minisite_claim_slug(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.minisite_claim_slug(text) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'mini_site_auth_upload'
  ) THEN
    CREATE POLICY mini_site_auth_upload
      ON storage.objects
      FOR INSERT
      WITH CHECK (
        bucket_id = 'fuelpro-files'
        AND (storage.foldername(name))[1] = 'mini-site'
        AND auth.role() = 'authenticated'
        -- Only the station that claimed THIS slug may publish to it.
        AND EXISTS (
          SELECT 1 FROM public.minisite_slug_claims c
          WHERE c.slug = (storage.foldername(name))[2]
            AND c.owner_id = auth.uid()
        )
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'mini_site_auth_update'
  ) THEN
    CREATE POLICY mini_site_auth_update
      ON storage.objects
      FOR UPDATE
      USING (
        bucket_id = 'fuelpro-files'
        AND (storage.foldername(name))[1] = 'mini-site'
        AND auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.minisite_slug_claims c
          WHERE c.slug = (storage.foldername(name))[2]
            AND c.owner_id = auth.uid()
        )
      )
      WITH CHECK (
        bucket_id = 'fuelpro-files'
        AND (storage.foldername(name))[1] = 'mini-site'
        AND auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.minisite_slug_claims c
          WHERE c.slug = (storage.foldername(name))[2]
            AND c.owner_id = auth.uid()
        )
      );
  END IF;
END$$;

-- ── Anonymous mini-site view counter ──────────────────────────────────────
-- A public page is read by visitors with no Supabase session, so the counter
-- is incremented server-side with the service role. It is a NON-AUTHORITATIVE
-- convenience for the owner (the "views" tile in the Mini Site manager).
-- RLS is enabled with NO public policies, so only the service role (which
-- bypasses RLS) can read or write it — an anonymous client cannot enumerate
-- the table or inflate another station's counter via PostgREST.
CREATE TABLE IF NOT EXISTS public.minisite_views (
  slug text PRIMARY KEY,
  views bigint NOT NULL DEFAULT 0,
  countries text[] NOT NULL DEFAULT '{}',
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.minisite_views ENABLE ROW LEVEL SECURITY;

-- Atomic view recording.
--
-- A plain PostgREST upsert cannot express "+1": `resolution=merge-duplicates`
-- REPLACES the row, so the counter would be pinned at 1 forever. It also
-- cannot append to an array without read-modify-write, which two concurrent
-- visitors would race. This function does both in one statement.
--
-- SECURITY DEFINER + `search_path` pinned so the anon role cannot redirect the
-- lookup through a planted schema. Only this narrow operation is exposed; RLS
-- stays enabled on the table with no public policies, so the table itself is
-- not enumerable or writable via PostgREST.
CREATE OR REPLACE FUNCTION public.minisite_record_view(
  p_slug text,
  p_country text DEFAULT NULL
)
RETURNS TABLE (views bigint, countries text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_country text := upper(nullif(btrim(coalesce(p_country, '')), ''));
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'invalid slug';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    v_country := NULL;
  END IF;

  INSERT INTO public.minisite_views AS mv (slug, views, countries, last_viewed_at)
  VALUES (p_slug, 1, CASE WHEN v_country IS NULL THEN '{}'::text[] ELSE ARRAY[v_country] END, now())
  ON CONFLICT (slug) DO UPDATE
    SET views = mv.views + 1,
        -- Dedupe, drop the NULL left by a visitor whose country could not be
        -- resolved, and cap the list so a popular site cannot grow the row
        -- without bound.
        countries = (
          SELECT (COALESCE(array_agg(DISTINCT c ORDER BY c), '{}'::text[]))[1:40]
          FROM unnest(mv.countries || CASE
                 WHEN v_country IS NULL THEN '{}'::text[]
                 ELSE ARRAY[v_country]
               END) AS t(c)
          WHERE c IS NOT NULL
        ),
        last_viewed_at = now();

  RETURN QUERY
    SELECT mv.views, mv.countries FROM public.minisite_views mv WHERE mv.slug = p_slug;
END;
$$;

-- Only the server (service role) executes these. The public page reports a
-- view through the serverless dispatcher, which holds the service key — it
-- never calls the RPC with the publishable anon key. Granting EXECUTE to anon
-- would let any visitor inflate an arbitrary slug's counter.
REVOKE ALL ON FUNCTION public.minisite_record_view(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.minisite_record_view(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minisite_record_view(text, text) TO service_role;

-- Owner-side read (no increment).
CREATE OR REPLACE FUNCTION public.minisite_get_view_stats(p_slug text)
RETURNS TABLE (views bigint, countries text[], last_viewed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT mv.views, mv.countries, mv.last_viewed_at
  FROM public.minisite_views mv
  WHERE mv.slug = p_slug
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.minisite_get_view_stats(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.minisite_get_view_stats(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minisite_get_view_stats(text) TO service_role;

-- "Unpublish" deletes the object so the public URL genuinely 404s (a stale
-- copy must never keep serving after the owner withdraws the site).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'mini_site_auth_delete'
  ) THEN
    CREATE POLICY mini_site_auth_delete
      ON storage.objects
      FOR DELETE
      USING (
        bucket_id = 'fuelpro-files'
        AND (storage.foldername(name))[1] = 'mini-site'
        AND auth.role() = 'authenticated'
        AND EXISTS (
          SELECT 1 FROM public.minisite_slug_claims c
          WHERE c.slug = (storage.foldername(name))[2]
            AND c.owner_id = auth.uid()
        )
      );
  END IF;
END$$;
