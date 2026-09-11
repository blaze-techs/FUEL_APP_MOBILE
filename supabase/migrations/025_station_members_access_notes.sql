-- 025_station_members_access_notes.sql
-- Enhances station_members with member-access tracking + owner notes, used by
-- the restructured "Access Another Station" feature (2026-08-23).
--
-- Adds:
--   - last_accessed_at : the last time the member accessed/switched to the
--                        station (updated by acceptInvite + switchStation).
--                        Lets the owner see "last active" per member.
--   - notes            : free-text owner notes about a member (e.g. "Auditor
--                        for Q3 review", "Temp contractor — revoke Aug 30").
--
-- Both columns are nullable. They're covered by the existing
-- station_members_owner_manage (owner INSERT/UPDATE/DELETE) and
-- station_members_self_read (member SELECT own row) policies, so no RLS
-- changes are required. Safe to re-run (IF NOT EXISTS).

ALTER TABLE public.station_members
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Index for "recently active members" queries.
CREATE INDEX IF NOT EXISTS idx_station_members_last_accessed
  ON public.station_members (station_id, last_accessed_at DESC)
  WHERE last_accessed_at IS NOT NULL;

-- Re-confirm realtime publication membership (safe to re-run).
ALTER PUBLICATION supabase_realtime ADD TABLE public.station_members;
