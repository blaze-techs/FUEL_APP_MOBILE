-- These SECURITY DEFINER functions are invoked only as PostgreSQL triggers.
-- They must not be callable as arbitrary PostgREST RPCs.
REVOKE EXECUTE ON FUNCTION public.fuelpro_sales_to_tank_movement() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stamp_audit_log_actor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.stamp_founder_audit_actor() FROM PUBLIC;
