-- Verifies the access-mode single-source-of-truth migration in isolation.
--
-- Runs against a clean PostgreSQL (no Supabase auth/roles needed): the
-- migration only touches the two credential tables plus catalog views, so a
-- minimal schema is enough to exercise it end to end.
--
-- Fails loudly (RAISE EXCEPTION) if any invariant is broken, so CI catches a
-- regression the moment the migration stops agreeing with the app.

BEGIN;

-- 1. Minimal credential tables, matching the real column definitions.
CREATE TABLE public.station_access_codes (
  id            text PRIMARY KEY,
  access_mode   text    NOT NULL DEFAULT 'read',
  read_only     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.company_grants (
  id            text PRIMARY KEY,
  access_mode   text    NOT NULL DEFAULT 'read',
  read_only     boolean NOT NULL DEFAULT true
);

-- 2. Seed the exact production contradiction plus out-of-range values.
INSERT INTO public.station_access_codes (id, access_mode, read_only) VALUES
  ('c_full',   'full', true),   -- canonical full, stale legacy flag
  ('c_edit',   'edit', true),   -- canonical edit, stale legacy flag
  ('c_read',   'read', false),  -- canonical read, stale legacy flag
  ('c_junk',   'junk', true);   -- junk an old client may have written

INSERT INTO public.company_grants (id, access_mode, read_only) VALUES
  ('g_full', 'full', true),
  ('g_junk', 'bogus', false);

-- 3. Apply the migration under test.
\i /tmp/ssot.sql

-- 4. Assert the invariants.
DO $$
DECLARE
  n int;
BEGIN
  -- access_mode is never modified for in-range rows: full/edit stay full/edit.
  SELECT count(*) INTO n FROM public.station_access_codes
   WHERE id = 'c_full' AND access_mode = 'full' AND read_only = true;
  IF n <> 0 THEN
    RAISE EXCEPTION 'full grant was demoted to read-only';
  END IF;

  SELECT count(*) INTO n FROM public.station_access_codes
   WHERE id = 'c_edit' AND access_mode = 'edit' AND read_only = true;
  IF n <> 0 THEN
    RAISE EXCEPTION 'edit grant was demoted to read-only';
  END IF;

  -- read_only is now derived from access_mode for every row.
  SELECT count(*) INTO n FROM public.station_access_codes
   WHERE read_only IS DISTINCT FROM (access_mode = 'read');
  IF n <> 0 THEN
    RAISE EXCEPTION 'read_only did not converge to access_mode';
  END IF;

  SELECT count(*) INTO n FROM public.company_grants
   WHERE read_only IS DISTINCT FROM (access_mode = 'read');
  IF n <> 0 THEN
    RAISE EXCEPTION 'grants: read_only did not converge to access_mode';
  END IF;

  -- Out-of-range values are sanitized to the safe default, never kept.
  SELECT count(*) INTO n FROM public.station_access_codes
   WHERE id = 'c_junk' AND access_mode = 'read' AND read_only = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'junk access_mode was not sanitized';
  END IF;

  SELECT count(*) INTO n FROM public.company_grants
   WHERE id = 'g_junk' AND access_mode = 'read' AND read_only = true;
  IF n <> 1 THEN
    RAISE EXCEPTION 'grants: junk access_mode was not sanitized';
  END IF;

  -- The write-time trigger keeps the mirror honest in BOTH directions.
  UPDATE public.station_access_codes SET access_mode = 'full' WHERE id = 'c_read';
  SELECT count(*) INTO n FROM public.station_access_codes
   WHERE id = 'c_read' AND access_mode = 'full' AND read_only = false;
  IF n <> 1 THEN
    RAISE EXCEPTION 'trigger did not derive read_only on access_mode change';
  END IF;

  UPDATE public.station_access_codes SET read_only = true WHERE id = 'c_full';
  SELECT count(*) INTO n FROM public.station_access_codes
   WHERE id = 'c_full' AND access_mode = 'full' AND read_only = false;
  IF n <> 1 THEN
    RAISE EXCEPTION 'trigger did not correct a stale read_only write';
  END IF;

  RAISE NOTICE 'access-mode SSOT migration: all invariants hold';
END $$;

-- 5. Constraints reject junk written after the migration.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.station_access_codes (id, access_mode) VALUES ('bad', 'bogus');
    RAISE EXCEPTION 'expected access_mode CHECK to reject junk';
  EXCEPTION
    WHEN check_violation THEN NULL;  -- expected
  END;

  BEGIN
    INSERT INTO public.company_grants (id, access_mode) VALUES ('bad', 'bogus');
    RAISE EXCEPTION 'expected grants access_mode CHECK to reject junk';
  EXCEPTION
    WHEN check_violation THEN NULL;  -- expected
  END;
END $$;

-- 6. Re-running must be a no-op (idempotent) and still leave invariants intact.
\i /tmp/ssot.sql

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM public.station_access_codes
   WHERE read_only IS DISTINCT FROM (access_mode = 'read');
  IF n <> 0 THEN
    RAISE EXCEPTION 'read_only drifted after a second migration run';
  END IF;
  RAISE NOTICE 'access-mode SSOT migration: idempotent re-run OK';
END $$;

ROLLBACK;
