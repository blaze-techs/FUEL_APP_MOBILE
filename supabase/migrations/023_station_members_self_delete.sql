-- Migration 023: Allow members to DELETE their own station_members rows (leave a station)
-- The existing RLS only allows self_read (SELECT) and self_update (UPDATE). A member
-- who wants to LEAVE a shared station needs to DELETE their membership row, but the
-- only DELETE policy is station_members_owner_manage (requires being the station owner).
-- This adds a self_delete policy so a user can delete rows where they are the member.
-- Mirrors the self_read/self_update pattern (user_id match OR invited_email match).

DROP POLICY IF EXISTS "station_members_self_delete" ON public.station_members;
CREATE POLICY "station_members_self_delete" ON public.station_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR invited_email = (
      SELECT email FROM auth.users WHERE id = auth.uid()
    )
  );
