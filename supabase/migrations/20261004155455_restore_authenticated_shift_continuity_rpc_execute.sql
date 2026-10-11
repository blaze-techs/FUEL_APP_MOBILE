-- Re-grant EXECUTE on the shift-continuity read RPC to authenticated only.
-- The preceding migrations removed PUBLIC/anon; this restores the intended
-- caller (authenticated station members). Guarded for clean databases.
do $$
begin
  if to_regprocedure('public.fuelpro_get_shift_continuity(uuid, date, text)') is not null then
    execute 'grant execute on function public.fuelpro_get_shift_continuity(uuid, date, text) to authenticated';
  end if;
end $$;
