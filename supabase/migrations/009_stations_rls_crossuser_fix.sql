-- Migration 009: Fix cross-user station leak via overly-permissive RLS policies
-- Applied live 2026-08-09.
--
-- ROOT CAUSE: the `stations` table had three broad "authenticated_*" RLS
-- policies that allowed ANY authenticated user to SELECT/UPDATE/INSERT
-- ALL stations regardless of ownership:
--   authenticated_select: (auth.role() = 'authenticated')   -- read ALL stations
--   authenticated_update:  (auth.role() = 'authenticated')   -- update ALL stations
--   authenticated_insert:  (auth.role() = 'authenticated')   -- insert as anyone
-- These shadowed the proper owner-scoped policies (auth.uid() = owner_id),
-- so a logged-in user received the GLOBAL station list — including every
-- other user's stations — via the cloud sync query. The leak was then
-- persisted into the (now user-scoped) localStorage cache, so even a
-- brand-new device showed another user's station on first login.
--
-- FIX: drop the three broad policies. The remaining owner-scoped policies
-- (auth.uid() = owner_id) now govern access, so a user can only SELECT /
-- UPDATE / DELETE stations they own. INSERT policies check
-- (auth.uid() = owner_id) via WITH CHECK.
--
-- The client (StationContext.syncStationsWithSupabase) ALSO adds an
-- explicit `.eq('owner_id', userId)` filter as defense-in-depth.

DROP POLICY IF EXISTS authenticated_select ON stations;
DROP POLICY IF EXISTS authenticated_update ON stations;
DROP POLICY IF EXISTS authenticated_insert ON stations;

-- The same overly-permissive "authenticated_*" pattern existed on several
-- other tables, allowing ANY authenticated user to read/update/insert
-- EVERYONE's rows (cross-user data leak for profiles, inventory, sales,
-- audit logs, and config). Drop them so the owner-scoped policies govern.
DROP POLICY IF EXISTS authenticated_select ON users;
DROP POLICY IF EXISTS authenticated_update ON users;
DROP POLICY IF EXISTS authenticated_insert ON users;
DROP POLICY IF EXISTS authenticated_select ON inventory;
DROP POLICY IF EXISTS authenticated_update ON inventory;
DROP POLICY IF EXISTS authenticated_insert ON inventory;
DROP POLICY IF EXISTS authenticated_select ON sales;
DROP POLICY IF EXISTS authenticated_insert ON sales;
DROP POLICY IF EXISTS authenticated_select ON audit_logs;
DROP POLICY IF EXISTS authenticated_insert ON audit_logs;
DROP POLICY IF EXISTS authenticated_select ON config;
DROP POLICY IF EXISTS authenticated_insert ON config;

-- Verify no broad authenticated_* policies remain.
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE policyname LIKE 'authenticated_%';

-- Backfill created_by for existing stations (was NULL for all pre-existing
-- rows). The "Users can view own stations" / "Users can update own
-- stations" policies key on (created_by = auth.uid()), so NULL created_by
-- left those stations unreachable via that policy path (only the
-- owner_id path matched). Set created_by = owner_id so both owner-scoped
-- policies cover every existing station.
UPDATE stations SET created_by = owner_id WHERE created_by IS NULL;
