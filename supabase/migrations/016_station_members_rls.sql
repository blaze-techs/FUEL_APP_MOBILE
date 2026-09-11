-- Migration 016: Allow station members (invited Manager/Staff/Auditor) to
-- READ the station they were invited to.
--
-- ROOT CAUSE: the stations table RLS only allows `owner_id = auth.uid()`.
-- An invited user (manager/staff/auditor) who accepted an invite via
-- /#/join/<token> has a row in station_members (station_id, user_id,
-- status='accepted') but does NOT own the station. So the station never
-- appears in their StationContext.syncStationsWithSupabase query → they
-- land on the "create station" screen even though they just joined a
-- station as a manager.
--
-- FIX: add a SELECT policy that allows a user to read any station where
-- they have an accepted station_members row. This is the minimal,
-- least-privilege policy — members can READ the station (so it appears
-- in their station list) but CANNOT update/delete it (only the owner can).

DROP POLICY IF EXISTS "stations_member_select" ON stations;
CREATE POLICY "stations_member_select" ON stations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM station_members
      WHERE station_members.station_id = stations.id
        AND station_members.user_id = auth.uid()
        AND station_members.status IN ('accepted', 'active')
    )
  );

-- Also allow members to read inventory/sales/pumps/etc for their station
-- (these were previously owner-only, so invited staff couldn't see any
-- station data even after joining). These are SELECT-only policies —
-- members can READ station data but writes are governed by the existing
-- owner-scoped policies (or per-table member policies added below).

-- Products: members can read
DROP POLICY IF EXISTS "products_member_select" ON products;
CREATE POLICY "products_member_select" ON products FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM station_members sm
      JOIN stations s ON s.id = sm.station_id
      WHERE sm.user_id = auth.uid() AND sm.status IN ('accepted', 'active')
        AND products.station_id = sm.station_id
    )
  );

-- Sales: members can read
DROP POLICY IF EXISTS "sales_enhanced_member_select" ON sales_enhanced;
CREATE POLICY "sales_enhanced_member_select" ON sales_enhanced FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM station_members sm
      WHERE sm.user_id = auth.uid() AND sm.status IN ('accepted', 'active')
        AND sales_enhanced.station_id = sm.station_id
    )
  );

-- Inventory: members can read
DROP POLICY IF EXISTS "inventory_member_select" ON inventory;
CREATE POLICY "inventory_member_select" ON inventory FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM station_members sm
      WHERE sm.user_id = auth.uid() AND sm.status IN ('accepted', 'active')
        AND inventory.station_id = sm.station_id
    )
  );

-- Pumps: members can read
DROP POLICY IF EXISTS "pumps_member_select" ON pumps;
CREATE POLICY "pumps_member_select" ON pumps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM station_members sm
      WHERE sm.user_id = auth.uid() AND sm.status IN ('accepted', 'active')
        AND pumps.station_id = sm.station_id
    )
  );

-- Allow members to INSERT sales (so staff can use POS) and inventory
-- transactions (so staff can adjust stock) for their station.
DROP POLICY IF EXISTS "sales_enhanced_member_insert" ON sales_enhanced;
CREATE POLICY "sales_enhanced_member_insert" ON sales_enhanced FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM station_members sm
      WHERE sm.user_id = auth.uid() AND sm.status IN ('accepted', 'active')
        AND sales_enhanced.station_id = sm.station_id
    )
  );

-- Allow members to INSERT inventory transactions (stock adjustments, transfers)
DROP POLICY IF EXISTS "inventory_transactions_member_insert" ON inventory_transactions;
CREATE POLICY "inventory_transactions_member_insert" ON inventory_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM station_members sm
      WHERE sm.user_id = auth.uid() AND sm.status IN ('accepted', 'active')
        AND inventory_transactions.station_id = sm.station_id
    )
  );
