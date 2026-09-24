-- Direct Site Access mode is a station-membership property.
-- It is canonical in station_members and only narrows the existing RBAC role.
-- Existing members remain "full" so this migration is backwards compatible.
ALTER TABLE public.station_members
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'station_members_access_mode_check'
  ) THEN
    ALTER TABLE public.station_members
      ADD CONSTRAINT station_members_access_mode_check
      CHECK (access_mode IN ('read','edit','full'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_station_members_station_access_mode
  ON public.station_members (station_id, access_mode);

-- Backend write enforcement for the member-write tables exposed by the
-- existing member RLS. Read-only members must not be able to bypass the UI.
DROP POLICY IF EXISTS "sales_enhanced_member_insert" ON public.sales_enhanced;
CREATE POLICY "sales_enhanced_member_insert" ON public.sales_enhanced FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.station_members sm
      WHERE sm.user_id = auth.uid()
        AND sm.station_id = sales_enhanced.station_id
        AND sm.status IN ('accepted','active')
        AND sm.access_mode IN ('edit','full')
    )
  );

DROP POLICY IF EXISTS "inventory_transactions_member_insert" ON public.inventory_transactions;
CREATE POLICY "inventory_transactions_member_insert" ON public.inventory_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.station_members sm
      WHERE sm.user_id = auth.uid()
        AND sm.station_id = inventory_transactions.station_id
        AND sm.status IN ('accepted','active')
        AND sm.access_mode IN ('edit','full')
    )
  );
