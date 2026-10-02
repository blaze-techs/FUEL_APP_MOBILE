-- Align server-side price mutation protection with the app's current
-- explicit-confirmation flow. The UI no longer uses AAL2/TOTP for ordinary
-- price changes, so the old trigger rejected valid schedule and pricing-mode
-- writes after the user had already confirmed in the UI.
--
-- The RPC remains restricted to authenticated callers and binds owner_id to
-- auth.uid(), preventing SECURITY DEFINER abuse.

create or replace function public.guard_fuel_price_mutation()
returns trigger
language plpgsql
as $function$
declare
  sensitive boolean := public.fuelpro_price_key(coalesce(new.id, old.id));
  price_changed boolean := true;
begin
  if TG_OP = 'UPDATE' and not sensitive then
    price_changed := public.fuelpro_price_payload_changed(old.data, new.data);
  elsif TG_OP = 'INSERT' and sensitive and coalesce(new.id,'') like '%_compact' then
    price_changed := (
      new.data ? 'pmsPrice'
      or new.data ? 'agoPrice'
      or new.data ? 'petrolPrice'
      or new.data ? 'dieselPrice'
      or new.data ? 'fuelPricesByType'
      or new.data ? 'fuelTypes'
    );
  end if;

  if sensitive and price_changed and auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authenticated session required for fuel price changes.';
  end if;

  return coalesce(new, old);
end;
$function$;

create or replace function public.upsert_app_kv_versioned(
  p_id text,
  p_owner_id uuid,
  p_station_id uuid,
  p_collection text,
  p_data jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  existing_version bigint;
  existing_data jsonb;
  existing_updated timestamptz;
  new_version bigint;
  inserted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authenticated session required.';
  end if;

  if p_owner_id is null or p_owner_id <> auth.uid() then
    raise exception 'The authenticated user does not own this app_kv write.';
  end if;

  select version, data, updated_at
    into existing_version, existing_data, existing_updated
    from public.app_kv
   where id = p_id
     and owner_id = p_owner_id
   for update;

  if not found then
    begin
      insert into public.app_kv (
        id, collection, owner_id, station_id, data, version, updated_at
      )
      values (
        p_id, p_collection, p_owner_id, p_station_id, p_data, 1, now()
      );
      inserted := true;
    exception
      when unique_violation then
        inserted := false;
    end;

    if inserted then
      return jsonb_build_object(
        'ok', true, 'id', p_id, 'version', 1,
        'updated_at', now()::text, 'data', p_data
      );
    end if;

    select version, data, updated_at
      into existing_version, existing_data, existing_updated
      from public.app_kv
     where id = p_id
       and owner_id = p_owner_id
     for update;

    if not found then
      raise exception 'app_kv row disappeared during concurrent write: %', p_id;
    end if;
  end if;

  if p_expected_version is null
     or p_expected_version = 0
     or existing_version = p_expected_version then
    new_version := existing_version + 1;

    update public.app_kv
       set data = p_data,
           station_id = coalesce(p_station_id, station_id),
           collection = coalesce(p_collection, collection),
           version = new_version,
           updated_at = now()
     where id = p_id
       and owner_id = p_owner_id;

    return jsonb_build_object(
      'ok', true, 'id', p_id, 'version', new_version,
      'updated_at', now()::text, 'data', p_data
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'id', p_id,
    'version', existing_version,
    'updated_at', existing_updated::text,
    'data', existing_data
  );
end;
$function$;

revoke all on function public.upsert_app_kv_versioned(text, uuid, uuid, text, jsonb, bigint) from public;
grant execute on function public.upsert_app_kv_versioned(text, uuid, uuid, text, jsonb, bigint) to authenticated;
