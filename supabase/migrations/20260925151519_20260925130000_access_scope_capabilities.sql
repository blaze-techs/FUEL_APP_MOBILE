-- Access SCOPE: an owner-authored restriction layered on top of the level.
--
-- `access_mode` (read | edit | full) decides WHAT a member may do. Scope
-- decides HOW MUCH of the station they may do it in. The two are separate
-- columns because they answer different questions, and keeping them separate
-- is what lets the Company QR card and the member portal agree:
--
--     access_mode  -> capability CEILING   (read ⊂ edit ⊂ full)
--     scope        -> capability REDUCTION (may only remove)
--
-- Both directions are one-way. A scope can NEVER add a capability the level
-- does not grant, so a junk/hostile scope cannot escalate a member. The app
-- enforces this in `resolveCapabilities()`; this migration only stores and
-- sanitises the data.
--
-- `scope_tabs` is deliberately a TEXT[] (not JSON) so the existing
-- `allowed_tabs` containment logic keeps working unchanged.

-- 1. Add the scope columns. Empty array = "no further restriction".
ALTER TABLE public.station_access_codes
  ADD COLUMN IF NOT EXISTS scope_tabs TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_capabilities TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) THEN
    ALTER TABLE public.company_grants
      ADD COLUMN IF NOT EXISTS scope_tabs TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS scope_capabilities TEXT[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- 2. Sanitize junk BEFORE constraining, so this cannot fail on a DB that
--    accumulated values from an older/other client.
--
--    Unknown capabilities are DROPPED rather than defaulted: a scope is a
--    restriction, so discarding an unrecognised value can only ever make the
--    member's access NARROWER (the level ceiling still applies). Defaulting
--    to a privileged value would be the escalation this whole design avoids.
UPDATE public.station_access_codes
   SET scope_capabilities = (
         SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), '{}')
         FROM unnest(scope_capabilities) AS c
         WHERE c IN ('view','export','suggest','edit','settings','manage')
       )
 WHERE scope_capabilities IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM unnest(scope_capabilities) AS c
     WHERE c NOT IN ('view','export','suggest','edit','settings','manage')
   );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) THEN
    UPDATE public.company_grants
       SET scope_capabilities = (
             SELECT COALESCE(array_agg(DISTINCT c ORDER BY c), '{}')
             FROM unnest(scope_capabilities) AS c
             WHERE c IN ('view','export','suggest','edit','settings','manage')
           )
     WHERE scope_capabilities IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM unnest(scope_capabilities) AS c
         WHERE c NOT IN ('view','export','suggest','edit','settings','manage')
       );
  END IF;
END $$;

-- 3. Constrain the capability vocabulary (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'station_access_codes_scope_capabilities_check'
  ) THEN
    ALTER TABLE public.station_access_codes
      ADD CONSTRAINT station_access_codes_scope_capabilities_check
      CHECK (scope_capabilities <@ ARRAY['view','export','suggest','edit','settings','manage']::TEXT[]);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_grants_scope_capabilities_check'
  ) THEN
    ALTER TABLE public.company_grants
      ADD CONSTRAINT company_grants_scope_capabilities_check
      CHECK (scope_capabilities <@ ARRAY['view','export','suggest','edit','settings','manage']::TEXT[]);
  END IF;
END $$;

-- 4. A read-only row can never carry write capabilities in its scope. The
--    scope is redundant for `read` (the ceiling already excludes them), but
--    storing an impossible combination would let a future reader trust the
--    scope over the level. Strip them so the two columns cannot disagree.
UPDATE public.station_access_codes
   SET scope_capabilities = (
         SELECT COALESCE(array_agg(c ORDER BY c), '{}')
         FROM unnest(scope_capabilities) AS c
         WHERE c IN ('view','export')
       )
 WHERE access_mode = 'read'
   AND EXISTS (
     SELECT 1 FROM unnest(scope_capabilities) AS c
     WHERE c NOT IN ('view','export')
   );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'company_grants'
  ) THEN
    UPDATE public.company_grants
       SET scope_capabilities = (
             SELECT COALESCE(array_agg(c ORDER BY c), '{}')
             FROM unnest(scope_capabilities) AS c
             WHERE c IN ('view','export')
           )
     WHERE access_mode = 'read'
       AND EXISTS (
         SELECT 1 FROM unnest(scope_capabilities) AS c
         WHERE c NOT IN ('view','export')
       );
  END IF;
END $$;
