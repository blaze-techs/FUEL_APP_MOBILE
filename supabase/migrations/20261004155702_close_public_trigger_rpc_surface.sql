-- Trigger-only helpers must never be callable as public RPCs. PostgreSQL
-- grants EXECUTE to PUBLIC by default, so revoke it explicitly. Guarded for
-- clean databases that do not define these functions yet.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.fuelpro_sales_to_tank_movement()',
    'public.stamp_audit_log_actor()',
    'public.stamp_founder_audit_actor()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public', fn);
    end if;
  end loop;
end $$;
