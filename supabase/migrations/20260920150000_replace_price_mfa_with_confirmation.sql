-- Replace the previous AAL2/2FA fuel-price mutation gate with explicit
-- user confirmation at the application layer.
--
-- Security controls retained:
--   * existing authenticated/RLS access to app_kv
--   * immutable fuel_price_security_audit history
--   * role/permission checks in application workflows
--
-- The UI now requires an explicit "ARE YOU SURE?" confirmation immediately
-- before an operational fuel-price mutation.

drop trigger if exists trg_guard_fuel_price_mutation on public.app_kv;

create or replace function public.guard_fuel_price_mutation()
returns trigger language plpgsql security invoker as $$
begin
  return coalesce(new, old);
end;
$$;
