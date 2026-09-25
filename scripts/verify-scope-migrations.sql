-- Verifies the SCOPE migrations end to end on a clean PostgreSQL:
--   20260924140000_access_scope_capabilities.sql
--   20260924150000_scope_aware_member_rpcs.sql
--
-- Runs without Supabase auth/roles: the migrations only touch the two
-- credential tables, so a minimal schema plus the two Roles the RPCs GRANT to
-- is enough to exercise every branch.
--
-- Fails loudly (RAISE EXCEPTION) so CI catches a regression the moment the
-- server stops agreeing with `resolveCapabilities()` in the app.

BEGIN;

-- 1. Roles Supabase provides and a bare PostgreSQL does not.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $do$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- On Supabase pgcrypto lives in `extensions`; a bare cluster (or the canonical
-- CI set) already has it in `public`, in which case the CREATE above is a
-- no-op and the RPCs' `extensions.digest(...)` would not resolve. Move it so
-- the server code under test runs exactly as it does in production. DDL is
-- transactional, so the ROLLBACK at the end of this script restores it.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'extensions' AND p.proname = 'digest'
  ) THEN
    ALTER EXTENSION pgcrypto SET SCHEMA extensions;
  END IF;
END $do$;

-- 2. Minimal credential tables. Scope columns are added by the migration
--    under test, so they are deliberately absent here.
CREATE TABLE public.app_kv (
  id text PRIMARY KEY, owner_id uuid, station_id uuid,
  collection text, data jsonb, updated_at timestamptz
);

CREATE TABLE public.station_access_codes (
  id text PRIMARY KEY, owner_id uuid, station_id text, username text,
  password_hash text, member_name text, member_role text,
  allowed_tabs jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_mode text NOT NULL DEFAULT 'read',
  read_only boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  locked_until timestamptz, failed_attempt_count int DEFAULT 0,
  first_failed_at timestamptz, last_accessed_at timestamptz,
  access_count int DEFAULT 0
);

CREATE TABLE public.company_grants (
  id text PRIMARY KEY, code text, owner_id uuid, station_id text,
  member_name text, member_role text,
  allowed_tabs jsonb NOT NULL DEFAULT '[]'::jsonb,
  access_mode text NOT NULL DEFAULT 'read',
  read_only boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true, revoked boolean NOT NULL DEFAULT false,
  expires_at timestamptz, max_uses int, uses int DEFAULT 0,
  locked_until timestamptz, failed_attempt_count int DEFAULT 0,
  first_failed_at timestamptz, last_redeemed_at timestamptz
);

-- 3. Seed the rows the sanitation step must fix BEFORE the migration runs:
--    an older client could have written junk, so the migration sanitises
--    first and constrains second.
INSERT INTO public.company_grants
  (id, code, owner_id, station_id, member_name, member_role, access_mode)
VALUES
  ('junk',  'JUNK',  gen_random_uuid(), 's', 'A', 'Staff', 'full'),
  ('ronly', 'RONLY', gen_random_uuid(), 's', 'B', 'Staff', 'read');

-- The scope columns do not exist yet, so add them the way the migration will,
-- then write the bad values it is expected to clean up.
ALTER TABLE public.company_grants
  ADD COLUMN scope_tabs TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN scope_capabilities TEXT[] NOT NULL DEFAULT '{}';

UPDATE public.company_grants
   SET scope_capabilities = ARRAY['view', 'NONSENSE', 'manage'] WHERE id = 'junk';
UPDATE public.company_grants
   SET scope_capabilities = ARRAY['view', 'export', 'manage'] WHERE id = 'ronly';

-- 4. Apply both migrations under test.
\i /tmp/scope.sql
\i /tmp/rpcs.sql

-- 5. Re-running must be a no-op (idempotent).
\i /tmp/scope.sql
\i /tmp/rpcs.sql

-- 6. Scope columns exist and default to "no restriction".
DO $do$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'company_grants'
     AND column_name IN ('scope_tabs', 'scope_capabilities');
  IF n <> 2 THEN
    RAISE EXCEPTION 'scope columns missing on company_grants (found %)', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'station_access_codes'
     AND column_name IN ('scope_tabs', 'scope_capabilities');
  IF n <> 2 THEN
    RAISE EXCEPTION 'scope columns missing on station_access_codes (found %)', n;
  END IF;

  INSERT INTO public.company_grants (id, code, owner_id, station_id, member_name, member_role)
  VALUES ('def', 'DEF', gen_random_uuid(), 's', 'X', 'Staff');
  SELECT count(*) INTO n FROM public.company_grants
   WHERE id = 'def' AND scope_tabs = '{}' AND scope_capabilities = '{}';
  IF n <> 1 THEN
    RAISE EXCEPTION 'scope columns did not default to empty';
  END IF;
END $do$;

-- 7. Sanitation: junk capabilities are DROPPED, never defaulted to privilege,
--    and a read-only level cannot carry write capabilities.
DO $do$
DECLARE
  caps text[];
  sorted text[];
BEGIN
  -- Compare as SETS: array order is not part of the contract.
  SELECT array_agg(x ORDER BY x) INTO sorted
    FROM unnest(ARRAY['view', 'manage']) AS x;

  SELECT array_agg(x ORDER BY x) INTO caps
    FROM unnest((SELECT scope_capabilities FROM public.company_grants WHERE id = 'junk')) AS x;
  IF caps IS DISTINCT FROM sorted THEN
    RAISE EXCEPTION 'junk capability was not dropped cleanly (got %)', caps;
  END IF;

  -- read ceiling is view/export only, so `manage` must be stripped.
  SELECT array_agg(x ORDER BY x) INTO sorted
    FROM unnest(ARRAY['view', 'export']) AS x;
  SELECT array_agg(x ORDER BY x) INTO caps
    FROM unnest((SELECT scope_capabilities FROM public.company_grants WHERE id = 'ronly')) AS x;
  IF caps IS DISTINCT FROM sorted THEN
    RAISE EXCEPTION 'read-only row kept a write capability (got %)', caps;
  END IF;

  BEGIN
    UPDATE public.company_grants
       SET scope_capabilities = ARRAY['not_a_capability'] WHERE id = 'junk';
    RAISE EXCEPTION 'expected the capability CHECK to reject junk';
  EXCEPTION
    WHEN check_violation THEN NULL;  -- expected
  END;
END $do$;

-- 8. The RPCs return the scope so a session can carry it, while every legacy
--    field keeps its name and meaning.
INSERT INTO public.company_grants
  (id, code, owner_id, station_id, member_name, member_role, access_mode,
   scope_tabs, scope_capabilities)
VALUES
  ('g_full',  'CODEFULL',  '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'A', 'Staff', 'full', '{}', '{}'),
  ('g_nocap', 'CODENOCAP', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'B', 'Staff', 'edit', '{}',
   ARRAY['view', 'export']),
  ('g_tab',   'CODETAB',   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'C', 'Staff', 'edit',
   ARRAY['sales'], '{}'),
  ('g_read',  'CODEREAD',  '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'D', 'Staff', 'read', '{}', '{}');

-- pgcrypto lives in `extensions` on Supabase and in `public` on a bare
-- cluster; set a search_path that finds it in either.
SET search_path = public, extensions;

INSERT INTO public.station_access_codes
  (id, owner_id, station_id, username, password_hash, member_name, member_role, access_mode)
VALUES
  ('c_edit', '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'joe',
   encode(digest('pw1234', 'sha256'), 'hex'), 'Joe', 'Staff', 'edit');

DO $do$
DECLARE
  r jsonb;
BEGIN
  -- redeem_company_grant returns scope + every legacy field.
  r := public.redeem_company_grant('CODETAB');
  IF (r -> 'scopeTabs') IS NULL OR (r -> 'scopeCapabilities') IS NULL THEN
    RAISE EXCEPTION 'redeem_company_grant did not return the scope: %', r;
  END IF;
  IF r ->> 'accessMode' <> 'edit' OR r ->> 'memberName' <> 'C'
     OR r ->> 'grantId' <> 'g_tab'
     OR r ->> 'stationOwnerId' <> '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'redeem_company_grant dropped a legacy field: %', r;
  END IF;

  -- verify_access_code returns scope + mode.
  r := public.verify_access_code(
    '22222222-2222-2222-2222-222222222222', 'joe', 'pw1234');
  IF (r -> 'scopeCapabilities') IS NULL OR r ->> 'accessMode' <> 'edit' THEN
    RAISE EXCEPTION 'verify_access_code did not return the scope: %', r;
  END IF;
END $do$;

-- 9. member_apply is the ONLY login-less write path, so the scope must be
--    enforced HERE and not only in the UI.
DO $do$
DECLARE
  r jsonb;
  o text := '11111111-1111-1111-1111-111111111111';
  s text := '22222222-2222-2222-2222-222222222222';
  payload jsonb := '{"v": 1}'::jsonb;
BEGIN
  -- full + unrestricted CAN write.
  r := public.member_apply(o, s, 'g_full', 'sales', payload);
  IF (r ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'full grant could not write: %', r;
  END IF;

  -- A scope that omits the write capabilities is REJECTED.
  r := public.member_apply(o, s, 'g_nocap', 'sales', payload);
  IF (r ->> 'ok') <> 'false' THEN
    RAISE EXCEPTION 'scope lacking write caps still wrote: %', r;
  END IF;

  -- A tab outside scope_tabs is REJECTED, inside is ALLOWED.
  r := public.member_apply(o, s, 'g_tab', 'inventory', payload);
  IF (r ->> 'ok') <> 'false' THEN
    RAISE EXCEPTION 'out-of-scope tab wrote: %', r;
  END IF;
  r := public.member_apply(o, s, 'g_tab', 'sales', payload);
  IF (r ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'in-scope tab was refused: %', r;
  END IF;

  -- A read-only level cannot write, whatever the scope says.
  r := public.member_apply(o, s, 'g_read', 'sales', payload);
  IF (r ->> 'ok') <> 'false' THEN
    RAISE EXCEPTION 'read-only level wrote: %', r;
  END IF;

  -- `suggest` alone is enough for the suggestion path.
  UPDATE public.company_grants
     SET scope_capabilities = ARRAY['view', 'suggest'] WHERE id = 'g_tab';
  r := public.member_apply(o, s, 'g_tab', 'sales', payload);
  IF (r ->> 'ok') <> 'true' THEN
    RAISE EXCEPTION 'suggest-only scope was refused: %', r;
  END IF;

  -- The access-code path is enforced by the same check.
  UPDATE public.station_access_codes
     SET scope_capabilities = ARRAY['view'] WHERE id = 'c_edit';
  r := public.member_apply(o, s, 'c_edit', 'sales', payload);
  IF (r ->> 'ok') <> 'false' THEN
    RAISE EXCEPTION 'access-code scope was ignored: %', r;
  END IF;
END $do$;

DO $do$
BEGIN
  RAISE NOTICE 'scope migrations: all invariants hold';
END $do$;

ROLLBACK;
