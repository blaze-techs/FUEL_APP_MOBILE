BEGIN;

-- Access-code usernames must be unambiguous per station.
CREATE UNIQUE INDEX IF NOT EXISTS station_access_codes_station_username_uq
  ON public.station_access_codes (station_id, lower(username));

-- Upgrade legacy unsalted SHA-256 access-code passwords to bcrypt on the next
-- successful login. New and already-upgraded hashes are checked with crypt().
CREATE OR REPLACE FUNCTION public.verify_access_code(
  p_station_id text, p_username text, p_password text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row station_access_codes%ROWTYPE;
  v_hash text;
  v_upper text;
  v_max_fail integer := 5;
  v_window_s integer := 900;
  v_lock_s integer := 900;
  v_password_ok boolean := false;
BEGIN
  v_upper := lower(trim(coalesce(p_username,'')));
  IF v_upper='' OR coalesce(p_password,'')='' THEN RETURN NULL; END IF;
  SELECT * INTO v_row
  FROM station_access_codes
  WHERE station_id=p_station_id AND lower(username)=v_upper AND enabled=true
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until>now() THEN
    RETURN jsonb_build_object('locked',true,'retryAfter',v_row.locked_until);
  END IF;
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until<=now() THEN
    UPDATE station_access_codes
      SET failed_attempt_count=0,first_failed_at=null,locked_until=null
      WHERE id=v_row.id;
    v_row.failed_attempt_count:=0; v_row.first_failed_at:=null; v_row.locked_until:=null;
  END IF;

  IF left(v_row.password_hash,3)='$2' THEN
    v_password_ok := extensions.crypt(p_password,v_row.password_hash)=v_row.password_hash;
  ELSE
    v_hash := encode(extensions.digest(p_password,'sha256'),'hex');
    v_password_ok := v_hash=v_row.password_hash;
  END IF;

  IF NOT v_password_ok THEN
    IF v_row.first_failed_at IS NULL OR (now()-v_row.first_failed_at)>make_interval(secs=>v_window_s) THEN
      UPDATE station_access_codes
        SET failed_attempt_count=1,first_failed_at=now(),locked_until=null
        WHERE id=v_row.id;
      v_row.failed_attempt_count:=1;
    ELSE
      UPDATE station_access_codes
        SET failed_attempt_count=failed_attempt_count+1
        WHERE id=v_row.id
        RETURNING failed_attempt_count INTO v_row.failed_attempt_count;
    END IF;
    IF v_row.failed_attempt_count>=v_max_fail THEN
      UPDATE station_access_codes
        SET locked_until=now()+make_interval(secs=>v_lock_s)
        WHERE id=v_row.id;
      RETURN jsonb_build_object('locked',true,'retryAfter',now()+make_interval(secs=>v_lock_s));
    END IF;
    RETURN NULL;
  END IF;

  IF left(v_row.password_hash,3)<>'$2' THEN
    UPDATE station_access_codes
      SET password_hash=extensions.crypt(p_password,extensions.gen_salt('bf',12))
      WHERE id=v_row.id;
  END IF;

  UPDATE station_access_codes
    SET last_accessed_at=now(),access_count=access_count+1,
        failed_attempt_count=0,first_failed_at=null,locked_until=null
    WHERE id=v_row.id;

  RETURN jsonb_build_object(
    'accessCodeId',v_row.id,'memberName',v_row.member_name,
    'memberRole',v_row.member_role,'allowedTabs',v_row.allowed_tabs,
    'readOnly',v_row.read_only,'accessMode',v_row.access_mode,
    'scopeTabs',to_jsonb(v_row.scope_tabs),
    'scopeCapabilities',to_jsonb(v_row.scope_capabilities),
    'stationId',v_row.station_id
  );
END;
$$;

-- Serialize member edits and cap the anonymous/no-login inbox so concurrent
-- edits cannot overwrite one another or grow without bound.
CREATE OR REPLACE FUNCTION public.member_apply(
  p_owner_id text,p_station_id text,p_access_code_id text,p_tab text,p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_code station_access_codes%ROWTYPE;
  v_grant company_grants%ROWTYPE;
  v_mode text; v_scope_caps text[]; v_scope_tabs text[];
  v_tab_allowed boolean; v_key text; v_existing jsonb; v_next jsonb; v_ts text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RETURN jsonb_build_object('ok',false,'error','Payload must be a JSON object.');
  END IF;
  IF octet_length(p_payload::text)>65536 THEN
    RETURN jsonb_build_object('ok',false,'error','Payload too large.');
  END IF;

  SELECT * INTO v_code FROM station_access_codes
  WHERE id=p_access_code_id AND station_id=p_station_id AND owner_id::text=p_owner_id LIMIT 1;
  IF FOUND THEN
    IF NOT v_code.enabled THEN RETURN jsonb_build_object('ok',false,'error','Access disabled.'); END IF;
    v_mode:=v_code.access_mode; v_scope_caps:=v_code.scope_capabilities; v_scope_tabs:=v_code.scope_tabs;
    IF v_mode NOT IN ('edit','full') THEN RETURN jsonb_build_object('ok',false,'error','This member is read-only.'); END IF;
    v_tab_allowed:=(v_code.allowed_tabs='[]'::jsonb) OR v_code.allowed_tabs ? p_tab;
  ELSE
    SELECT * INTO v_grant FROM company_grants
    WHERE id=p_access_code_id AND station_id=p_station_id AND owner_id::text=p_owner_id LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','Unknown access grant.'); END IF;
    IF NOT v_grant.enabled OR v_grant.revoked THEN RETURN jsonb_build_object('ok',false,'error','Access disabled or revoked.'); END IF;
    IF v_grant.expires_at IS NOT NULL AND v_grant.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'error','Access expired.'); END IF;
    IF v_grant.max_uses IS NOT NULL AND v_grant.uses>=v_grant.max_uses THEN RETURN jsonb_build_object('ok',false,'error','Access grant exhausted.'); END IF;
    v_mode:=v_grant.access_mode; v_scope_caps:=v_grant.scope_capabilities; v_scope_tabs:=v_grant.scope_tabs;
    IF v_mode NOT IN ('edit','full') THEN RETURN jsonb_build_object('ok',false,'error','This member is read-only.'); END IF;
    v_tab_allowed:=(v_grant.allowed_tabs='[]'::jsonb) OR v_grant.allowed_tabs ? p_tab;
  END IF;

  IF v_scope_caps IS NOT NULL AND array_length(v_scope_caps,1) IS NOT NULL
     AND NOT (v_scope_caps && ARRAY['edit','suggest']::text[]) THEN
    RETURN jsonb_build_object('ok',false,'error','Your access level does not allow changes to this station.');
  END IF;
  IF v_scope_tabs IS NOT NULL AND array_length(v_scope_tabs,1) IS NOT NULL
     AND NOT (v_scope_tabs @> ARRAY[p_tab]::text[]) THEN
    RETURN jsonb_build_object('ok',false,'error','This section is not allowed for your access.');
  END IF;
  IF NOT v_tab_allowed THEN RETURN jsonb_build_object('ok',false,'error','This section is not allowed for your access.'); END IF;

  v_key:='member_edits_'||p_tab||'__'||p_owner_id||'__'||p_station_id;
  v_ts:=to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"');
  SELECT data INTO v_existing FROM app_kv
  WHERE id=v_key AND owner_id=p_owner_id::uuid AND station_id=p_station_id::uuid
    AND collection='member_edits'
  FOR UPDATE;

  IF v_existing IS NULL OR jsonb_typeof(v_existing)<>'array' THEN
    v_next:=jsonb_build_array(jsonb_build_object('ts',v_ts,'tab',p_tab,'by',p_access_code_id,'payload',p_payload));
  ELSE
    v_next:=v_existing||jsonb_build_object('ts',v_ts,'tab',p_tab,'by',p_access_code_id,'payload',p_payload);
    IF jsonb_array_length(v_next)>500 THEN
      SELECT coalesce(jsonb_agg(x order by (x->>'ts') desc),'[]'::jsonb) INTO v_next
      FROM (SELECT x FROM jsonb_array_elements(v_next) x ORDER BY (x->>'ts') DESC LIMIT 500) q;
    END IF;
  END IF;

  INSERT INTO app_kv(id,owner_id,station_id,collection,data,updated_at)
  VALUES(v_key,p_owner_id::uuid,p_station_id::uuid,'member_edits',v_next,now())
  ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=now();
  RETURN jsonb_build_object('ok',true,'inboxCount',jsonb_array_length(v_next));
END;
$$;

COMMIT;
