-- Close the PUBLIC EXECUTE surface on the shift-continuity RPCs. PostgreSQL
-- grants EXECUTE to PUBLIC by default, so a fresh deploy that only revokes
-- from anon still leaves the functions callable. Guarded for clean databases.
do $$
begin
  if to_regprocedure('public.fuelpro_get_shift_continuity(uuid, date, text)') is not null then
    execute 'revoke execute on function public.fuelpro_get_shift_continuity(uuid, date, text) from public';
  end if;

  if to_regprocedure('public.fuelpro_enforce_shift_meter_continuity()') is not null then
    execute 'revoke execute on function public.fuelpro_enforce_shift_meter_continuity() from public';
  end if;
end $$;
