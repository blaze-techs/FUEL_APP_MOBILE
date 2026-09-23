-- Compatibility bridge: old clients still calling the six-argument RPC
-- receive a short-lived server lease instead of bypassing session fencing.
-- Once a newer client owns the lease, legacy callers are blocked until that
-- active lease expires. This prevents the live DB hardening from breaking
-- older builds while still preventing stale offline replay from overwriting
-- the current active session.
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
set search_path = ''
as $function$
declare
  v_legacy_session text;
  v_claim jsonb;
  v_station_id uuid;
  v_existing_version bigint;
  v_existing_data jsonb;
  v_existing_updated timestamptz;
  v_new_version bigint;
  v_inserted boolean := false;
begin
  if (select auth.uid()) is null or p_owner_id <> (select auth.uid()) then
    raise exception 'OWNER_AUTHENTICATION_MISMATCH';
  end if;

  if p_station_id is null then
    -- Global/unscoped data retains the existing optimistic-concurrency path.
    select version, data, updated_at
      into v_existing_version, v_existing_data, v_existing_updated
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
          p_id, p_collection, p_owner_id, null, p_data, 1, now()
        );
        v_inserted := true;
      exception
        when unique_violation then
          v_inserted := false;
      end;

      if v_inserted then
        return jsonb_build_object(
          'ok', true, 'id', p_id, 'version', 1,
          'updated_at', now()::text, 'data', p_data
        );
      end if;

      select version, data, updated_at
        into v_existing_version, v_existing_data, v_existing_updated
        from public.app_kv
       where id = p_id
         and owner_id = p_owner_id
       for update;
    end if;

    if p_expected_version is null
       or p_expected_version = 0
       or v_existing_version = p_expected_version then
      v_new_version := v_existing_version + 1;

      update public.app_kv
         set data = p_data,
             station_id = null,
             collection = coalesce(p_collection, collection),
             version = v_new_version,
             updated_at = now()
       where id = p_id
         and owner_id = p_owner_id;

      return jsonb_build_object(
        'ok', true, 'id', p_id, 'version', v_new_version,
        'updated_at', now()::text, 'data', p_data
      );
    end if;

    return jsonb_build_object(
      'ok', false, 'id', p_id, 'version', v_existing_version,
      'updated_at', v_existing_updated::text, 'data', v_existing_data
    );
  end if;

  begin
    v_station_id := p_station_id::uuid;
  exception when invalid_text_representation then
    raise exception 'STATION_ID_INVALID';
  end;

  v_legacy_session :=
    'legacy:' || p_owner_id::text || ':' || v_station_id::text;

  v_claim := public.claim_station_active_session(
    v_station_id,
    v_legacy_session
  );

  if coalesce((v_claim ->> 'granted')::boolean, false) is not true then
    raise exception 'ACTIVE_SESSION_REQUIRED';
  end if;

  return public.upsert_app_kv_session_versioned(
    p_id,
    p_owner_id,
    v_station_id,
    p_collection,
    p_data,
    p_expected_version,
    v_legacy_session,
    (v_claim ->> 'fence_token')::bigint
  );
end;
$function$;

revoke all on function public.upsert_app_kv_versioned(
  text, uuid, text, text, jsonb, bigint
) from public, anon;
grant execute on function public.upsert_app_kv_versioned(
  text, uuid, text, text, jsonb, bigint
) to authenticated;
