-- Access mode is the SINGLE SOURCE OF TRUTH; read_only is derived from it.
--
-- The bug this closes: `access_mode = 'full'` and `read_only = true` could
-- coexist on the same row. Different readers picked different columns, so the
-- Company QR card said "Normal" while the member view said "Read only". The
-- direction is now hard-pinned in the database as well as in the app:
--
--     access_mode  ->  read_only   (derived, never the input)
--
-- A trigger forces the invariant on every INSERT/UPDATE, so no client, RPC or
-- manual SQL can leave the two columns contradicting each other.
--
-- NOTE: this migration intentionally does NOT change access_mode from the
-- legacy boolean. `read_only = false` used to mean "full" and that is
-- preserved by the app-side resolver only when access_mode is absent. Once
-- this migration runs, access_mode is always present, so it wins.

-- 1. Guarantee the canonical column exists on both credential tables.
ALTER TABLE public.station_access_codes
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'read';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) THEN
    ALTER TABLE public.company_grants
      ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'read';
  END IF;
END $$;

-- 2. Sanitize: any value outside the three levels becomes the safe default
--    BEFORE the CHECK is added, so this migration cannot fail on a DB that
--    accumulated junk from an older client.
UPDATE public.station_access_codes
   SET access_mode = 'read'
 WHERE access_mode IS NULL OR access_mode NOT IN ('read','edit','full');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) THEN
    UPDATE public.company_grants
       SET access_mode = 'read'
     WHERE access_mode IS NULL OR access_mode NOT IN ('read','edit','full');
  END IF;
END $$;

-- 3. Constrain access_mode to the three known levels (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'station_access_codes_access_mode_check'
  ) THEN
    ALTER TABLE public.station_access_codes
      ADD CONSTRAINT station_access_codes_access_mode_check
      CHECK (access_mode IN ('read','edit','full'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_grants_access_mode_check'
  ) THEN
    ALTER TABLE public.company_grants
      ADD CONSTRAINT company_grants_access_mode_check
      CHECK (access_mode IN ('read','edit','full'));
  END IF;
END $$;

-- 4. Backfill: bring every legacy read_only into agreement with access_mode.
--
-- The direction is fixed and one-way. `access_mode` is the canonical column
-- (migration 028 gave it `NOT NULL DEFAULT 'read'`, so it is always present),
-- therefore `read_only` is simply derived from it. We deliberately do NOT
-- infer a mode *from* `read_only` here.
--
-- In particular, a row holding `read_only = false` alongside the default
-- `access_mode = 'read'` is NOT promoted to 'full'. Before this migration the
-- app already rendered such a row as "Read only" (every UI read `accessMode`
-- first), so promoting it would silently widen a member's permissions. The
-- single source of truth is `access_mode`; nothing else may override it.
UPDATE public.station_access_codes
   SET read_only = (access_mode = 'read')
 WHERE read_only IS DISTINCT FROM (access_mode = 'read');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) THEN
    UPDATE public.company_grants
       SET read_only = (access_mode = 'read')
     WHERE read_only IS DISTINCT FROM (access_mode = 'read');
  END IF;
END $$;

-- 5. Derive read_only on every write, so the mirror can never drift.
CREATE OR REPLACE FUNCTION public.sync_access_mode_read_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.read_only := (NEW.access_mode = 'read');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_station_access_codes_access_mode ON public.station_access_codes;
CREATE TRIGGER trg_station_access_codes_access_mode
  BEFORE INSERT OR UPDATE ON public.station_access_codes
  FOR EACH ROW EXECUTE FUNCTION public.sync_access_mode_read_only();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_company_grants_access_mode ON public.company_grants';
    EXECUTE 'CREATE TRIGGER trg_company_grants_access_mode
             BEFORE INSERT OR UPDATE ON public.company_grants
             FOR EACH ROW EXECUTE FUNCTION public.sync_access_mode_read_only()';
  END IF;
END $$;
