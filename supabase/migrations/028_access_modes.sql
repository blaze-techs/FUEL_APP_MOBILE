-- 028_access_modes.sql
-- Member access MODES: the owner decides per member (access code OR company
-- QR grant) whether they get:
--   'read'  -> read-only snapshot viewer (no changes).
--   'edit'  -> edit-only: can add/update records in their allowed tabs,
--              saved to the OWNER's main-site data, but CANNOT delete,
--              revoke, share, or touch settings/admin.
--   'full'  -> normal mode: full CRUD within their allowed tabs, activity
--              saved to the owner's main-site data (like an ordinary user).
--
-- The member NEVER writes the owner's canonical cloud keys directly.
-- Instead, `member_apply` (SECURITY DEFINER, anon-callable) validates the
-- code + mode + allowed-tabs + expiry and appends the payload into a
-- per-tab "member edits inbox" row in app_kv owned by the owner
-- (member_edits_<tab>__<ownerId>__<stationId>). The owner's app merges that
-- inbox into the canonical keys when it next publishes/refreshes, so the
-- member's activity genuinely lands in the main site.

alter table station_access_codes
  add column if not exists access_mode text not null default 'read';

-- company_grants may not exist yet if migration 027 was never applied to a
-- given project (the app stores grants in app_kv; the DB table is optional).
-- Guard the ALTER so this migration is idempotent on BOTH fresh + old DBs.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'company_grants'
  ) then
    alter table company_grants
      add column if not exists access_mode text not null default 'read';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- verify_access_code: also return the access_mode so the member's client can
-- render the correct UI (read / edit / full).
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
    'stationId',    v_row.station_id
  );
end;
$$;

grant execute on function verify_access_code(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- redeem_company_grant: also return the access_mode.
-- ---------------------------------------------------------------------------
create or replace function redeem_company_grant(
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row company_grants%rowtype;
begin
  select * into v_row
  from company_grants
  where code = p_code
  limit 1;

  if not found then
    return null;
  end if;

  if not v_row.enabled or v_row.revoked then
    return null;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return null;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('locked', true, 'retryAfter', v_row.locked_until);
  end if;

  if v_row.max_uses is not null and v_row.uses >= v_row.max_uses then
    return null;
  end if;

  update company_grants
     set uses = uses + 1,
         last_redeemed_at = now(),
         failed_attempt_count = 0,
         first_failed_at = null
   where id = v_row.id;

  return jsonb_build_object(
    'grantId',      v_row.id,
    'memberName',   v_row.member_name,
    'memberRole',   v_row.member_role,
    'allowedTabs',  v_row.allowed_tabs,
    'readOnly',     v_row.read_only,
    'accessMode',   v_row.access_mode,
    'stationId',    v_row.station_id,
    'stationOwnerId', v_row.owner_id::text,
    'expiresAt',  v_row.expires_at
  );
end;
$$;

grant execute on function redeem_company_grant(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- member_apply(p_owner_id, p_station_id, p_access_code_id, p_tab, p_payload)
-- The ONLY write path for access-code / QR-grant members. Validates:
--   1. the code exists, is enabled, not revoked, not expired;
--   2. the code's access_mode is 'edit' or 'full' (read-only members cannot
--      write);
--   3. the target tab is in the code's allowed_tabs (or allowed_tabs empty =
--      all tabs);
--   4. the payload is a JSON object (never an arbitrary raw value).
-- Then appends the payload into the owner's per-tab "member edits inbox"
-- app_kv row (member_edits_<tab>__<ownerId>__<stationId>). The owner's app
-- merges this inbox into the canonical keys on its next publish/refresh.
-- Returns {ok:true, inboxCount} or {ok:false, error}.
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
    v_mode := v_code.access_mode;
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
    v_mode := v_grant.access_mode;
    if v_mode not in ('edit', 'full') then
      return jsonb_build_object('ok', false, 'error', 'This member is read-only.');
    end if;
    v_tab_allowed := (v_grant.allowed_tabs = '[]'::jsonb)
      or v_grant.allowed_tabs ? p_tab;
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
