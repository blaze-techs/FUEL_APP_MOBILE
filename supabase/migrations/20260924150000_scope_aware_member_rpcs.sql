-- Scope must survive the SERVER path, not just the browser.
--
-- `20260924140000` added `scope_tabs` / `scope_capabilities` to the two
-- credential tables. This migration teaches the three member-facing RPCs about
-- them:
--
--   redeem_company_grant  -> RETURN the scope so a QR session carries it
--   verify_access_code    -> RETURN the scope so an access-code session does
--   member_apply          -> ENFORCE the scope on the only write path
--
-- The read RPCs are additive: every existing field keeps its name and meaning,
-- so a client that predates scope simply ignores the new keys. `member_apply`
-- is the security-relevant one — it is the ONLY way a login-less member can
-- write anything, so the scope check must live here and not only in the UI.
--
-- Precedence, consistent with `resolveCapabilities()` in the app:
--   access_mode  -> capability ceiling (read ⊂ edit ⊂ full)
--   scope        -> may only REDUCE from that ceiling
-- An empty scope array means "no further restriction".

-- ---------------------------------------------------------------------------
-- 1. redeem_company_grant: return the scope alongside the mode.
--    Copied verbatim from 20260923110000 and extended; the legacy success
--    fields are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_company_grant(
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_grants%rowtype;
begin
  select *
    into v_row
    from public.company_grants
   where lower(code) = lower(trim(p_code))
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'reason', 'locked',
      'locked', true,
      'retryAfter', v_row.locked_until
    );
  end if;

  if v_row.locked_until is not null and v_row.locked_until <= now() then
    update public.company_grants
       set failed_attempt_count = 0,
           first_failed_at = null,
           locked_until = null
     where id = v_row.id;
    v_row.locked_until := null;
  end if;

  if v_row.revoked then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;

  if not v_row.enabled then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_row.max_uses is not null and v_row.uses >= v_row.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'used_up');
  end if;

  update public.company_grants
     set uses = uses + 1,
         last_redeemed_at = now(),
         failed_attempt_count = 0,
         first_failed_at = null
   where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'grantId', v_row.id,
    'memberName', v_row.member_name,
    'memberRole', v_row.member_role,
    'allowedTabs', v_row.allowed_tabs,
    'readOnly', v_row.read_only,
    'accessMode', v_row.access_mode,
    'scopeTabs', to_jsonb(v_row.scope_tabs),
    'scopeCapabilities', to_jsonb(v_row.scope_capabilities),
    'stationId', v_row.station_id,
    'stationOwnerId', v_row.owner_id::text,
    'expiresAt', v_row.expires_at
  );
end;
$$;

grant execute on function public.redeem_company_grant(text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. verify_access_code: return the scope alongside the mode.
--    Copied verbatim from 028_access_modes.sql and extended. Brute-force
--    accounting is unchanged.
-- ---------------------------------------------------------------------------
create or replace function verify_access_code(
  p_station_id text,
  p_username   text,
  p_password   text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row      station_access_codes%rowtype;
  v_hash     text;
  v_upper    text;
  v_max_fail integer := 5;
  v_window_s integer := 900;   -- 15 minutes
  v_lock_s   integer := 900;   -- 15 minutes
begin
  v_upper := lower(trim(p_username));

  select * into v_row
  from station_access_codes
  where station_id = p_station_id
    and lower(username) = v_upper
    and enabled = true
  limit 1;

  if not found then
    return null;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('locked', true, 'retryAfter', v_row.locked_until);
  end if;

  if v_row.locked_until is not null and v_row.locked_until <= now() then
    update station_access_codes
       set failed_attempt_count = 0,
           first_failed_at      = null,
           locked_until         = null
     where id = v_row.id;
    v_row.failed_attempt_count := 0;
    v_row.first_failed_at      := null;
    v_row.locked_until         := null;
  end if;

  v_hash := encode(extensions.digest(p_password, 'sha256'), 'hex');

  if v_hash <> v_row.password_hash then
    if v_row.first_failed_at is null or
       (now() - v_row.first_failed_at) > make_interval(secs => v_window_s) then
      update station_access_codes
         set failed_attempt_count = 1,
             first_failed_at       = now(),
             locked_until          = null
       where id = v_row.id;
    else
      update station_access_codes
         set failed_attempt_count = failed_attempt_count + 1
       where id = v_row.id;
      v_row.failed_attempt_count := v_row.failed_attempt_count + 1;
    end if;

    if v_row.failed_attempt_count + 1 >= v_max_fail then
      update station_access_codes
         set locked_until = now() + make_interval(secs => v_lock_s)
       where id = v_row.id;
      return jsonb_build_object('locked', true, 'retryAfter',
                                 now() + make_interval(secs => v_lock_s));
    end if;

    return null;
  end if;

  update station_access_codes
     set last_accessed_at     = now(),
         access_count         = access_count + 1,
         failed_attempt_count = 0,
         first_failed_at      = null,
         locked_until         = null
   where id = v_row.id;

  return jsonb_build_object(
    'accessCodeId', v_row.id,
    'memberName',   v_row.member_name,
    'memberRole',   v_row.member_role,
    'allowedTabs',  v_row.allowed_tabs,
    'readOnly',     v_row.read_only,
    'accessMode',   v_row.access_mode,
    'scopeTabs',    to_jsonb(v_row.scope_tabs),
    'scopeCapabilities', to_jsonb(v_row.scope_capabilities),
    'stationId',    v_row.station_id
  );
end;
$$;

grant execute on function verify_access_code(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. member_apply: ENFORCE the scope. This is the only write path for a
--    member with no Supabase session, so the check belongs here.
--    Copied verbatim from 028_access_modes.sql and extended; the signature is
--    deliberately unchanged so no client update is required to call it.
-- ---------------------------------------------------------------------------
create or replace function member_apply(
  p_owner_id        text,
  p_station_id      text,
  p_access_code_id  text,
  p_tab             text,
  p_payload         jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code        station_access_codes%rowtype;
  v_grant       company_grants%rowtype;
  v_mode        text;
  v_scope_caps  text[];
  v_scope_tabs  text[];
  v_tab_allowed boolean;
  v_key         text;
  v_existing    jsonb;
  v_next        jsonb;
  v_ts          text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'Payload must be a JSON object.');
  end if;

  -- Resolve the access code (preferred) or a matching QR grant by id.
  select * into v_code
  from station_access_codes
  where id = p_access_code_id
    and station_id = p_station_id
    and owner_id::text = p_owner_id
  limit 1;

  if found then
    if not v_code.enabled then
      return jsonb_build_object('ok', false, 'error', 'Access disabled.');
    end if;
    v_mode       := v_code.access_mode;
    v_scope_caps := v_code.scope_capabilities;
    v_scope_tabs := v_code.scope_tabs;
    if v_mode not in ('edit', 'full') then
      return jsonb_build_object('ok', false, 'error', 'This member is read-only.');
    end if;
    v_tab_allowed := (v_code.allowed_tabs = '[]'::jsonb)
      or v_code.allowed_tabs ? p_tab;
  else
    select * into v_grant
    from company_grants
    where id = p_access_code_id
      and station_id = p_station_id
      and owner_id::text = p_owner_id
    limit 1;

    if not found then
      return jsonb_build_object('ok', false, 'error', 'Unknown access grant.');
    end if;
    if not v_grant.enabled or v_grant.revoked then
      return jsonb_build_object('ok', false, 'error', 'Access disabled or revoked.');
    end if;
    if v_grant.expires_at is not null and v_grant.expires_at <= now() then
      return jsonb_build_object('ok', false, 'error', 'Access expired.');
    end if;
    v_mode       := v_grant.access_mode;
    v_scope_caps := v_grant.scope_capabilities;
    v_scope_tabs := v_grant.scope_tabs;
    if v_mode not in ('edit', 'full') then
      return jsonb_build_object('ok', false, 'error', 'This member is read-only.');
    end if;
    v_tab_allowed := (v_grant.allowed_tabs = '[]'::jsonb)
      or v_grant.allowed_tabs ? p_tab;
  end if;

  -- SCOPE: a non-empty capability allow-list must permit this write. Filing a
  -- change request is the "suggest"/"edit" capability, so a credential whose
  -- scope grants neither cannot write even though its LEVEL would allow it.
  -- An empty list means "no further restriction" (the level ceiling applies).
  if v_scope_caps is not null
     and array_length(v_scope_caps, 1) is not null
     and not (v_scope_caps && ARRAY['edit','suggest']::text[]) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Your access level does not allow changes to this station.'
    );
  end if;

  -- SCOPE: a non-empty tab allow-list is a second, narrower tab boundary.
  if v_scope_tabs is not null
     and array_length(v_scope_tabs, 1) is not null
     and not (v_scope_tabs @> ARRAY[p_tab]::text[]) then
    return jsonb_build_object('ok', false, 'error', 'This section is not allowed for your access.');
  end if;

  if not v_tab_allowed then
    return jsonb_build_object('ok', false, 'error', 'This section is not allowed for your access.');
  end if;

  v_key := 'member_edits_' || p_tab || '__' || p_owner_id || '__' || p_station_id;
  v_ts  := to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  select data into v_existing
  from app_kv
  where id = v_key;

  if v_existing is null or jsonb_typeof(v_existing) <> 'array' then
    v_next := jsonb_build_array(
      jsonb_build_object(
        'ts', v_ts,
        'tab', p_tab,
        'by', p_access_code_id,
        'payload', p_payload
      )
    );
  else
    v_next := v_existing || jsonb_build_object(
      'ts', v_ts,
      'tab', p_tab,
      'by', p_access_code_id,
      'payload', p_payload
    );
  end if;

  insert into app_kv (id, owner_id, station_id, collection, data, updated_at)
  values (
    v_key,
    p_owner_id::uuid,
    p_station_id::uuid,
    'member_edits',
    v_next,
    now()
  )
  on conflict (id) do update
    set data = excluded.data,
        updated_at = now();

  return jsonb_build_object('ok', true, 'inboxCount', jsonb_array_length(v_next));
end;
$$;

grant execute on function member_apply(text, text, text, text, jsonb) to anon, authenticated;
