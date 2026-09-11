-- 022_access_code_brute_force_protection.sql
-- Add rate limiting / lockout to the verify_access_code RPC so an
-- unauthenticated attacker cannot brute-force a member's password by
-- hammering the anon-callable RPC.
--
-- Policy: after 5 consecutive failed attempts within a 15-minute window,
-- the account is locked for 15 minutes. A successful login resets the
-- counters. The lockout is per (station_id, username), not per IP (we
-- can't reliably identify the client IP from inside the RPC and members
-- may share NAT IPs).

alter table station_access_codes
  add column if not exists failed_attempt_count integer not null default 0,
  add column if not exists first_failed_at       timestamptz,
  add column if not exists locked_until           timestamptz;

create index if not exists station_access_codes_locked_until_idx
  on station_access_codes (locked_until) where locked_until is not null;

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
  -- Normalize username to lowercase (matches how createAccessCode stores it).
  v_upper := lower(trim(p_username));

  select * into v_row
  from station_access_codes
  where station_id = p_station_id
    and lower(username) = v_upper
    and enabled = true
  limit 1;

  if not found then
    -- Don't reveal whether the username exists; return null.
    return null;
  end if;

  -- LOCKED: still within the lockout window.
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('locked', true, 'retryAfter', v_row.locked_until);
  end if;

  -- If the lockout window has expired, clear it.
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

  -- SHA-256 hex of the supplied password (pgcrypto digest).
  v_hash := encode(extensions.digest(p_password, 'sha256'), 'hex');

  if v_hash <> v_row.password_hash then
    -- WRONG PASSWORD: bump the failed-attempt counter. Reset the window if
    -- the first failure was more than `v_window_s` ago (the user retried
    -- after the window, so start fresh).
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

    -- Lock the account if the threshold is reached.
    if v_row.failed_attempt_count + 1 >= v_max_fail then
      update station_access_codes
         set locked_until = now() + make_interval(secs => v_lock_s)
       where id = v_row.id;
      return jsonb_build_object('locked', true, 'retryAfter',
                                 now() + make_interval(secs => v_lock_s));
    end if;

    return null;
  end if;

  -- SUCCESS: reset the counters, record the access, return the config.
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
    'stationId',    v_row.station_id
  );
end;
$$;

-- Re-grant (the function signature is unchanged).
grant execute on function verify_access_code(text, text, text) to anon, authenticated;
