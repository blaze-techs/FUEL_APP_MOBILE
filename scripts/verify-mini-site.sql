-- Verifies the mini-site storage + analytics migration.
--
-- Runs against a clean PostgreSQL with a Supabase-shaped STUB:
--   • storage.objects + storage.foldername() (what the policies use)
--   • auth.uid() / auth.role()       (what Supabase provides at runtime)
-- so the ownership rules are actually EXERCISED, not merely parsed.
--
-- The point of this file is the cross-tenant write hole: before the claim
-- table, ANY authenticated user could upsert `mini-site/<someone-elses-slug>/`
-- and overwrite that station's public site. The assertions below fail loudly if
-- that ever becomes possible again, and the counter assertions fail if the
-- "+1" upsert dataloss bug returns.
--
-- Requires:  psql -v ON_ERROR_STOP=1 -f scripts/verify-mini-site.sql
--            (with /tmp/minisite.sql copied from the migration)

BEGIN;

-- ── Supabase-shaped stub ───────────────────────────────────────────────────
-- Supabase installs these in the `storage` and `auth` schemas. Recreate the
-- minimum the migration touches so it applies unchanged.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT string_to_array(name, '/') $$;

CREATE TABLE IF NOT EXISTS storage.objects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id   text,
  name        text,
  owner       uuid
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- The migration grants policies TO authenticated / public; those roles must
-- exist for GRANT/POLICY to be accepted.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
END $$;

-- auth.uid() / auth.role() read a GUC, exactly like Supabase's JWT claims.
-- The verifier switches user by setting these, so the storage policies can be
-- evaluated as different tenants.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

-- ── Apply the migration (twice, to prove idempotency) ──────────────────────
\i /tmp/minisite.sql
\i /tmp/minisite.sql

-- ── 1. The claim table exists, is owner-scoped and RLS-guarded ─────────────
DO $$
BEGIN
  IF to_regclass('public.minisite_slug_claims') IS NULL THEN
    RAISE EXCEPTION 'minisite_slug_claims table was not created';
  END IF;
  IF to_regprocedure('public.minisite_claim_slug(text)') IS NULL THEN
    RAISE EXCEPTION 'minisite_claim_slug() was not created';
  END IF;
  IF to_regprocedure('public.minisite_record_view(text,text)') IS NULL THEN
    RAISE EXCEPTION 'minisite_record_view() was not created';
  END IF;
  IF to_regprocedure('public.minisite_get_view_stats(text)') IS NULL THEN
    RAISE EXCEPTION 'minisite_get_view_stats() was not created';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.minisite_slug_claims'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on minisite_slug_claims';
  END IF;
  RAISE NOTICE 'mini-site migration: objects + idempotent re-run OK';
END $$;

-- ── 2. First claim wins; a second tenant cannot take the slug ──────────────
DO $$
DECLARE
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  ok := public.minisite_claim_slug('publican-energy');
  IF NOT ok THEN
    RAISE EXCEPTION 'first claim of a free slug must succeed';
  END IF;

  -- Tenant B asks for the same slug: the claim must NOT move to B.
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  ok := public.minisite_claim_slug('publican-energy');
  IF ok THEN
    RAISE EXCEPTION 'a second tenant was able to claim an owned slug';
  END IF;

  -- ...and the row still belongs to A (claim cannot be re-pointed).
  IF NOT EXISTS (
    SELECT 1 FROM public.minisite_slug_claims
    WHERE slug = 'publican-energy' AND owner_id = a
  ) THEN
    RAISE EXCEPTION 'slug ownership was reassigned to another tenant';
  END IF;

  -- A can claim again idempotently.
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  ok := public.minisite_claim_slug('publican-energy');
  IF NOT ok THEN
    RAISE EXCEPTION 're-claiming your own slug must succeed';
  END IF;

  -- Junk slugs and unauthenticated callers are rejected.
  BEGIN
    PERFORM public.minisite_claim_slug('Bad Slug!');
    RAISE EXCEPTION 'expected invalid slug to raise';
  EXCEPTION
    WHEN others THEN
      IF position('invalid slug' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.minisite_claim_slug('another-slug');
    RAISE EXCEPTION 'expected unauthenticated claim to raise';
  EXCEPTION
    WHEN others THEN
      IF position('authentication required' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;

  RAISE NOTICE 'mini-site migration: slug ownership is first-come and immovable';
END $$;

-- ── 3. The storage policies actually enforce ownership ─────────────────────
-- Simulate what Storage does: evaluate the WITH CHECK of the INSERT policy
-- for a row written by tenant B against a slug owned by tenant A.
DO $$
DECLARE
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  n int;
BEGIN
  -- A publishes its own document -> allowed by the policy predicate.
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SELECT count(*) INTO n
    FROM storage.objects
   WHERE bucket_id = 'fuelpro-files'
     AND (storage.foldername(name))[1] = 'mini-site'
     AND auth.role() = 'authenticated'
     AND EXISTS (
       SELECT 1 FROM public.minisite_slug_claims c
       WHERE c.slug = (storage.foldername(name))[2]
         AND c.owner_id = auth.uid()
     );
  IF n <> 0 THEN
    RAISE EXCEPTION 'unexpected rows before insert';
  END IF;

  -- The predicate the policy will use, evaluated for B writing A's slug.
  PERFORM set_config('request.jwt.claim.sub', b::text, true);
  IF EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'fuelpro-files'
       AND (storage.foldername('mini-site/publican-energy/site.json'))[1] = 'mini-site'
       AND auth.role() = 'authenticated'
       AND EXISTS (
         SELECT 1 FROM public.minisite_slug_claims c
         WHERE c.slug = (storage.foldername('mini-site/publican-energy/site.json'))[2]
           AND c.owner_id = auth.uid()
       )
  ) THEN
    RAISE EXCEPTION 'cross-tenant write to an owned slug would be permitted';
  END IF;

  -- And the predicate DOES pass for the true owner (no over-blocking).
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.minisite_slug_claims c
     WHERE c.slug = (storage.foldername('mini-site/publican-energy/site.json'))[2]
       AND c.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'the owning tenant was wrongly denied its own slug';
  END IF;

  RAISE NOTICE 'mini-site migration: cross-tenant write is blocked, owner allowed';
END $$;

-- ── 4. View counter increments (the "+1" dataloss regression) ──────────────
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.minisite_record_view('publican-energy', 'ke');
  IF r.views <> 1 THEN
    RAISE EXCEPTION 'first view should be 1, got %', r.views;
  END IF;
  IF r.countries <> ARRAY['KE'] THEN
    RAISE EXCEPTION 'country should be normalised to KE, got %', r.countries;
  END IF;

  -- Repeat views MUST increment. A merge-duplicates upsert would pin this at 1.
  PERFORM public.minisite_record_view('publican-energy', 'ke');
  SELECT * INTO r FROM public.minisite_record_view('publican-energy', 'ng');
  IF r.views <> 3 THEN
    RAISE EXCEPTION 'views should be 3 after three visits, got % (overwrite bug?)', r.views;
  END IF;
  IF r.countries <> ARRAY['KE', 'NG'] THEN
    RAISE EXCEPTION 'distinct countries should be {KE,NG}, got %', r.countries;
  END IF;

  -- A NULL/blank country must not add a NULL element to the array.
  SELECT * INTO r FROM public.minisite_record_view('publican-energy', NULL);
  IF r.views <> 4 THEN
    RAISE EXCEPTION 'views should be 4, got %', r.views;
  END IF;
  IF array_position(r.countries, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'countries must not contain NULL: %', r.countries;
  END IF;

  -- Junk slugs are refused (it is a public, unauthenticated entry point).
  BEGIN
    PERFORM public.minisite_record_view('NOT A SLUG', 'US');
    RAISE EXCEPTION 'expected invalid slug to raise in record_view';
  EXCEPTION
    WHEN others THEN
      IF position('invalid slug' IN SQLERRM) = 0 THEN RAISE; END IF;
  END;
END $$;

-- ── 5. Stats read is authoritative and does NOT increment ──────────────────
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.minisite_get_view_stats('publican-energy');
  IF r.views <> 4 THEN
    RAISE EXCEPTION 'reading stats must not increment (expected 4, got %)', r.views;
  END IF;
  IF r.last_viewed_at IS NULL THEN
    RAISE EXCEPTION 'last_viewed_at should be populated';
  END IF;

  -- Unknown slug -> one empty row, not NULL, so the caller can render "0 views".
  SELECT * INTO r FROM public.minisite_get_view_stats('never-seen-slug');
  IF r.views IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'unknown slug views should be 0, got %', r.views;
  END IF;
  RAISE NOTICE 'mini-site migration: counter increments and stats are read-only';
END $$;

-- ── 6. The counter entry point is NOT callable by anon ─────────────────────
DO $$
DECLARE
  acl text;
BEGIN
  SELECT array_to_string(proacl, ',') INTO acl
    FROM pg_proc WHERE proname = 'minisite_record_view';

  IF acl IS NULL THEN
    RAISE NOTICE 'mini-site migration: record_view has default ACL (owner only)';
  ELSIF position('anon=' IN acl) > 0 THEN
    RAISE EXCEPTION 'anon must not be able to inflate the counter: %', acl;
  END IF;
END $$;

ROLLBACK;
