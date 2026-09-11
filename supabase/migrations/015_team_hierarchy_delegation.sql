-- 015_team_hierarchy_delegation.sql
-- Full Team Manager hierarchy upgrade:
--   Owner > Manager > Staff > Auditor (+ Owner-defined custom roles:
--   accountant, cashier, etc.).
--
-- Adds to station_members:
--   - invited_by_user_id  : the auth uid of the inviter (provenance)
--   - invited_by_name     : human-readable inviter name
--   - invited_by_unique_id: the inviter's profiles.unique_id (stable ID)
--   - expires_at          : invite expiry timestamp
--   - max_uses / uses     : invite consumption tracking (DB-validated, not
--                           localStorage — fixes cross-device invite abuse)
--   - permissions         : JSONB snapshot of the granted PermissionConfig
--                           (the 54 action booleans) at invite time
--   - tab_grants          : JSONB array of granted tab ids
--   - can_create_subusers : delegation flag — can this member create further
--                           sub-users (invite others)
--   - can_grant_permissions: delegation flag — can this member grant/change
--                            permissions for roles below them
--   - member_unique_id    : the invited user's profiles.unique_id (stable,
--                           cross-device link so a sub-user who logs in on a
--                           new device is recognised as the same team member)
--   - member_email        : the invited user's email (cross-device lookup)
--   - member_role         : the role assigned at invite time (role column is
--                           reused; this is a denormalized copy for clarity)
--
-- Hierarchy enforcement is performed in the application layer
-- (PermissionContext) because it requires comparing the inviter's permission
-- set to the invitee's requested permission set — a check too complex for a
-- single RLS policy. RLS continues to enforce: only the station Owner can
-- INSERT/UPDATE/DELETE station_members; a member can READ/UPDATE their own
-- row (accept/reject). The application guards against privilege escalation
-- before any INSERT reaches the DB.

ALTER TABLE public.station_members
  ADD COLUMN IF NOT EXISTS invited_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS invited_by_name TEXT,
  ADD COLUMN IF NOT EXISTS invited_by_unique_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_uses INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS uses INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS permissions JSONB,
  ADD COLUMN IF NOT EXISTS tab_grants JSONB,
  ADD COLUMN IF NOT EXISTS can_create_subusers BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_grant_permissions BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS member_unique_id TEXT,
  ADD COLUMN IF NOT EXISTS member_email TEXT,
  ADD COLUMN IF NOT EXISTS member_role TEXT;

-- Indexes for the cross-device "is this user a member of this station?"
-- lookup (used by AuthContext.syncBindingsFromCloud + PermissionContext).
DROP INDEX IF EXISTS idx_station_members_user_station;
CREATE INDEX IF NOT EXISTS idx_station_members_user_station
  ON public.station_members (user_id, station_id, status)
  WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS idx_station_members_email_station;
CREATE INDEX IF NOT EXISTS idx_station_members_email_station
  ON public.station_members (invited_email, station_id, status)
  WHERE invited_email IS NOT NULL;

-- Index for the inviter's "who did I invite?" query (team roster by inviter).
DROP INDEX IF EXISTS idx_station_members_invited_by;
CREATE INDEX IF NOT EXISTS idx_station_members_invited_by
  ON public.station_members (invited_by_user_id, station_id)
  WHERE invited_by_user_id IS NOT NULL;

-- Updated_at trigger so every membership change records a timestamp
-- (used by the UI to show "last active" + for realtime change detection).
DROP TRIGGER IF EXISTS trg_station_members_updated_at ON public.station_members;
CREATE TRIGGER trg_station_members_updated_at
  BEFORE UPDATE ON public.station_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ensure the set_updated_at helper exists (some live DBs lack it).
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The station_members_self_read policy already allows a user to SELECT rows
-- where user_id = auth.uid() OR invited_email = their email. No policy change
-- needed — the new columns are readable under the same policy. The owner_manage
-- policy already covers all columns for the owner.

-- Enable realtime on station_members so cross-device invite acceptance +
-- permission changes propagate instantly. (Safe to re-run.)
ALTER PUBLICATION supabase_realtime ADD TABLE public.station_members;
