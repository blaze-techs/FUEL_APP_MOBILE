-- Security hardening: trigger/internal shift-continuity RPCs must not be
-- callable anonymously.
--
-- * fuelpro_enforce_shift_meter_continuity() runs from PostgreSQL trigger
--   context; it is not a client RPC and must not be exposed via PUBLIC.
-- * fuelpro_get_shift_continuity(uuid, date, text) already requires an
--   authenticated station role, so exposing it to anon only widens the
--   SECURITY DEFINER attack surface.
--
-- Guarded with to_regprocedure so the migration is a no-op on a database
-- that does not yet define the functions (e.g. a clean CI bootstrap).
do $$
begin
  if to_regprocedure('public.fuelpro_enforce_shift_meter_continuity()') is not null then
    execute 'revoke execute on function public.fuelpro_enforce_shift_meter_continuity() from public';
  end if;

  if to_regprocedure('public.fuelpro_get_shift_continuity(uuid, date, text)') is not null then
    execute 'revoke execute on function public.fuelpro_get_shift_continuity(uuid, date, text) from anon';
  end if;
end $$;
