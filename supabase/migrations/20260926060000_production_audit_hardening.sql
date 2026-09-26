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

-- Operational SECURITY DEFINER RPCs are callable only by signed-in users.
-- Their own permission checks remain the authorization boundary.
GRANT EXECUTE ON FUNCTION public.fuelpro_approve_shift_variance(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_close_cash_drawer(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_close_shift(uuid,jsonb,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_lock_period(uuid,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_open_shift(uuid,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_post_credit_charge(uuid,uuid,uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_post_sale(uuid,uuid,uuid,numeric,numeric,numeric,text,uuid,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_post_tank_movement(uuid,uuid,uuid,text,numeric,uuid,numeric,text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_reconcile_reading(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_reopen_shift(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_reverse_sale(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_sales_to_tank_movement() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_sync_apply(uuid,text,text,bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_has_permission(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_is_station_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_period_is_locked(uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_user_role(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuelpro_audit_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_app_kv_versioned(text,uuid,uuid,text,jsonb,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_founder_session(boolean,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_founder_audit(text,text,text,jsonb) TO authenticated;

COMMIT;
