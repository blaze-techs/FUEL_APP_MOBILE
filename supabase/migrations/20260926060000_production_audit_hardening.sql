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

-- Canonical reporting views are aggregates over RLS-protected base tables.
-- SECURITY INVOKER preserves the caller's station/user row visibility.
ALTER VIEW public.canonical_sales_effective SET (security_invoker = true);
ALTER VIEW public.canonical_shift_close_summary SET (security_invoker = true);
ALTER VIEW public.canonical_payment_daily_summary SET (security_invoker = true);
ALTER VIEW public.canonical_credit_balances SET (security_invoker = true);
ALTER VIEW public.canonical_tank_balances SET (security_invoker = true);
ALTER VIEW public.canonical_sale_payment_status SET (security_invoker = true);
ALTER VIEW public.canonical_shift_payment_totals SET (security_invoker = true);
ALTER VIEW public.canonical_shift_nozzle_sales SET (security_invoker = true);

COMMIT;
