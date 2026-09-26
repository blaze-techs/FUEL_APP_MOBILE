-- Production audit hardening: close arbitrary SQL execution, protect founder
-- credential metadata, and remove only advisor-confirmed duplicate indexes.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.exec_sql_select(text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS founder_creds_public_read ON public.founder_credentials;

CREATE POLICY founder_creds_founder_read
  ON public.founder_credentials
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IN (
      SELECT u.id
      FROM public.users AS u
      WHERE u.role IN ('founder', 'admin')
    )
  );

DROP INDEX IF EXISTS public.idx_inventory_station;
DROP INDEX IF EXISTS public.idx_po_station;
DROP INDEX IF EXISTS public.idx_sales_date;
DROP INDEX IF EXISTS public.idx_sales_enhanced_station;

COMMIT;
