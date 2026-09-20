-- FuelPro price integrity: require Supabase Auth AAL2 for any mutation that
-- can change an operational selling price, and keep an immutable audit trail.

create table if not exists public.fuel_price_security_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  station_id uuid,
  storage_key text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.fuel_price_security_audit enable row level security;

drop policy if exists "Owners and station managers can read price security audit" on public.fuel_price_security_audit;
create policy "Owners and station managers can read price security audit"
on public.fuel_price_security_audit
for select to authenticated
using (
  actor_id = auth.uid()
  or exists (
    select 1 from public.stations s
    where s.id = fuel_price_security_audit.station_id
      and s.owner_id = auth.uid()
  )
);

create or replace function public.fuelpro_price_key(id_text text)
returns boolean language sql immutable as $$
  select id_text like 'priceboard_data__%'
      or id_text like 'fuel_types_config__%'
      or id_text like 'price_schedules__%'
      or id_text like 'pricing_mode__%'
      or id_text like '%_compact';
$$;

create or replace function public.fuelpro_price_payload_changed(old_data jsonb, new_data jsonb)
returns boolean language sql immutable as $$
  select coalesce(old_data->>'pmsPrice','') is distinct from coalesce(new_data->>'pmsPrice','')
      or coalesce(old_data->>'agoPrice','') is distinct from coalesce(new_data->>'agoPrice','')
      or coalesce(old_data->>'petrolPrice','') is distinct from coalesce(new_data->>'petrolPrice','')
      or coalesce(old_data->>'dieselPrice','') is distinct from coalesce(new_data->>'dieselPrice','')
      or coalesce(old_data->>'fuelPricesByType','') is distinct from coalesce(new_data->>'fuelPricesByType','')
      or coalesce(old_data->>'fuelTypes','') is distinct from coalesce(new_data->>'fuelTypes','');
$$;

create or replace function public.guard_fuel_price_mutation()
returns trigger language plpgsql security invoker as $$
declare
  sensitive boolean := public.fuelpro_price_key(coalesce(new.id, old.id));
  price_changed boolean := true;
  aal text := coalesce((select auth.jwt()->>'aal'), 'aal1');
begin
  if TG_OP = 'UPDATE' and not sensitive then
    price_changed := public.fuelpro_price_payload_changed(old.data, new.data);
  elsif TG_OP = 'INSERT' and sensitive and coalesce(new.id,'') like '%_compact' then
    price_changed := (
      new.data ? 'pmsPrice' or new.data ? 'agoPrice' or
      new.data ? 'petrolPrice' or new.data ? 'dieselPrice' or
      new.data ? 'fuelPricesByType' or new.data ? 'fuelTypes'
    );
  end if;

  if sensitive and price_changed and aal <> 'aal2' then
    raise exception using errcode = '42501',
      message = 'Fuel price changes require verified 2FA (AAL2).';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_fuel_price_mutation on public.app_kv;
create trigger trg_guard_fuel_price_mutation
before insert or update or delete on public.app_kv
for each row execute function public.guard_fuel_price_mutation();

create or replace function public.audit_fuel_price_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.fuelpro_price_key(coalesce(new.id, old.id)) then
    insert into public.fuel_price_security_audit(
      actor_id, station_id, storage_key, operation, before_data, after_data
    ) values (
      auth.uid(), coalesce(new.station_id, old.station_id), coalesce(new.id, old.id),
      TG_OP,
      case when TG_OP in ('UPDATE','DELETE') then old.data else null end,
      case when TG_OP in ('INSERT','UPDATE') then new.data else null end
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_fuel_price_mutation on public.app_kv;
create trigger trg_audit_fuel_price_mutation
after insert or update or delete on public.app_kv
for each row execute function public.audit_fuel_price_mutation();

grant select on public.fuel_price_security_audit to authenticated;
