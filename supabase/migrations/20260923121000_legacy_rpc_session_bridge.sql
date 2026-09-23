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
begin
  if (select auth.uid()) is null or p_owner_id <> (select auth.uid()) then
    raise exception 'OWNER_AUTHENTICATION_MISMATCH';
  end if;

  if p_station_id is null then
    -- Global/unscoped data retains the legacy optimistic-concurrency path.
    return public.upsert_app_kv_versioned(
      p_id, p_owner_id, null::text, p_collection, p_data, p_expected_version
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
