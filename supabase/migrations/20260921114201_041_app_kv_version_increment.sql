-- Repair optimistic-concurrency version advancement for app_kv.
-- The previous function returned existing_version + 1 without persisting it,
-- causing subsequent writes to carry a version that did not exist in storage.
create or replace function public.upsert_app_kv_versioned(
  p_id text,
  p_owner_id uuid,
  p_station_id text,
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
  if p_owner_id is null then
    raise exception 'owner_id is required';
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
    'ok', false, 'id', p_id, 'version', existing_version,
    'updated_at', existing_updated::text, 'data', existing_data
  );
end;
$function$;

revoke all on function public.upsert_app_kv_versioned(text, uuid, text, text, jsonb, bigint) from public;
grant execute on function public.upsert_app_kv_versioned(text, uuid, text, text, jsonb, bigint) to authenticated;
