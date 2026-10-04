-- Production hardening: shift-continuity internals are not anonymous RPCs.
-- The trigger function executes from PostgreSQL trigger context and needs no
-- client EXECUTE privilege. The read RPC is authenticated-only because it
-- already resolves authorization through fuelpro_user_role().
REVOKE EXECUTE ON FUNCTION public.fuelpro_enforce_shift_meter_continuity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fuelpro_get_shift_continuity(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fuelpro_get_shift_continuity(uuid, date, text) TO authenticated;
