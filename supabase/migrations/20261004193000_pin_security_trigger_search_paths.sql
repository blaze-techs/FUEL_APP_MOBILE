-- Pin trigger-function search paths so role-level search_path changes cannot
-- alter object resolution inside SECURITY DEFINER/trigger-adjacent code.
ALTER FUNCTION public.guard_fuel_price_mutation() SET search_path = pg_catalog, public;
ALTER FUNCTION public.sync_access_mode_read_only() SET search_path = pg_catalog, public;
