-- Migration 017: Fix infinite recursion in stations_member_select RLS policy.
--
-- ROOT CAUSE: migration 016 added stations_member_select which checks
-- station_members. But station_members has the station_members_owner_manage
-- policy (FOR ALL) which checks stations.owner_id = auth.uid(). This creates
-- infinite recursion: reading stations → checks station_members → which
-- checks stations → which checks station_members → ...
-- Error: "infinite recursion detected in policy for relation stations"
--
-- FIX: replace the inline EXISTS check with a SECURITY DEFINER function
-- that bypasses RLS (SECURITY DEFINER runs as the function owner, which is
-- postgres, so RLS is not applied to the inner query). This breaks the
-- recursion because the station_members query inside the function doesn't
-- trigger the stations RLS policies.

CREATE OR REPLACE FUNCTION public.is_station_member(check_station_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM station_members
    WHERE station_members.station_id = check_station_id
      AND station_members.user_id = auth.uid()
      AND station_members.status IN ('accepted', 'active')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_station_member(uuid) TO authenticated;

-- Replace the recursive stations_member_select policy with one that uses
-- the SECURITY DEFINER function (no recursion).
DROP POLICY IF EXISTS "stations_member_select" ON stations;
CREATE POLICY "stations_member_select" ON stations FOR SELECT
  TO authenticated
  USING (
    public.is_station_member(stations.id)
  );

-- Also replace the other member policies from migration 016 to use the
-- function (they have the same recursion problem via station_members).
DROP POLICY IF EXISTS "products_member_select" ON products;
CREATE POLICY "products_member_select" ON products FOR SELECT
  TO authenticated
  USING (public.is_station_member(products.station_id));

DROP POLICY IF EXISTS "sales_enhanced_member_select" ON sales_enhanced;
CREATE POLICY "sales_enhanced_member_select" ON sales_enhanced FOR SELECT
  TO authenticated
  USING (public.is_station_member(sales_enhanced.station_id));

DROP POLICY IF EXISTS "inventory_member_select" ON inventory;
CREATE POLICY "inventory_member_select" ON inventory FOR SELECT
  TO authenticated
  USING (public.is_station_member(inventory.station_id));

DROP POLICY IF EXISTS "pumps_member_select" ON pumps;
CREATE POLICY "pumps_member_select" ON pumps FOR SELECT
  TO authenticated
  USING (public.is_station_member(pumps.station_id));

-- INSERT policies also use the function to avoid recursion.
DROP POLICY IF EXISTS "sales_enhanced_member_insert" ON sales_enhanced;
CREATE POLICY "sales_enhanced_member_insert" ON sales_enhanced FOR INSERT
  TO authenticated
  WITH CHECK (public.is_station_member(sales_enhanced.station_id));

DROP POLICY IF EXISTS "inventory_transactions_member_insert" ON inventory_transactions;
CREATE POLICY "inventory_transactions_member_insert" ON inventory_transactions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_station_member(inventory_transactions.station_id));
