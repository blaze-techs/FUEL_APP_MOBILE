-- Pin a safe search_path on SECURITY DEFINER trigger helpers so a caller
-- cannot hijack name resolution with a shadowing schema. pg_catalog first,
-- then public. Guarded for clean databases.
do $$
begin
  if to_regprocedure('public.guard_fuel_price_mutation()') is not null then
    execute 'alter function public.guard_fuel_price_mutation() set search_path = pg_catalog, public';
  end if;

  if to_regprocedure('public.sync_access_mode_read_only()') is not null then
    execute 'alter function public.sync_access_mode_read_only() set search_path = pg_catalog, public';
  end if;
end $$;
