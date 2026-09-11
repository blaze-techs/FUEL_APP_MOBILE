-- 021_station_access_codes_table.sql
-- Dedicated table + SECURITY DEFINER RPC for station access-code login.
--
-- PROBLEM (fixed here): access codes were stored in app_kv under the OWNER's
-- owner_id with RLS (owner_id = auth.uid()). A team member logging in via
-- access code has NO Supabase session, so currentUserId() returned null and
-- getAccessCodes() read [] -> "Invalid username or the access has been
-- disabled." Even with a session, RLS would block reading another user's
-- rows. Additionally, app_kv data is now gzip-compressed
-- ({__compressed:true, c:<base64>}), so server-side validation in SQL is
-- impossible.
--
-- SOLUTION: a dedicated `station_access_codes` table (owner-scoped RLS for
-- the owner's CRUD) + a SECURITY DEFINER RPC `verify_access_code` that an
-- UNAUTHENTICATED member can call to validate their credentials across the
-- RLS boundary. The RPC hashes the supplied password (SHA-256, pgcrypto)
-- and compares it to the stored hash; on success it returns the access
-- config (member name/role/allowed tabs/read-only) and bumps the access
-- counters. The password hash is NEVER returned.

create extension if not exists pgcrypto;

create table if not exists station_access_codes (
  id               text primary key,
  station_id       text not null,
  owner_id         uuid not null,
  username         text not null,           -- stored lowercased
  password_hash    text not null,           -- sha256 hex (lowercase)
  member_name      text not null default '',
  member_role      text not null default 'Staff',
  allowed_tabs     jsonb not null default '[]'::jsonb,
  read_only        boolean not null default true,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count     integer not null default 0
);

-- One username per station (case-insensitive, since username is lowercased).
create unique index if not exists station_access_codes_station_username_uniq
  on station_access_codes (station_id, lower(username));

-- Owner-side lookups.
create index if not exists station_access_codes_owner_station_idx
  on station_access_codes (owner_id, station_id);

-- RLS: the OWNER (auth.uid() = owner_id) can CRUD their own codes. Anyone
-- (including anon/unauthenticated members) can call the verify RPC, which
-- is SECURITY DEFINER and bypasses RLS.
alter table station_access_codes enable row level security;

drop policy if exists station_access_codes_owner_select on station_access_codes;
create policy station_access_codes_owner_select
  on station_access_codes for select
  using (auth.uid() = owner_id);

drop policy if exists station_access_codes_owner_insert on station_access_codes;
create policy station_access_codes_owner_insert
  on station_access_codes for insert
  with check (auth.uid() = owner_id);

drop policy if exists station_access_codes_owner_update on station_access_codes;
create policy station_access_codes_owner_update
  on station_access_codes for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists station_access_codes_owner_delete on station_access_codes;
create policy station_access_codes_owner_delete
  on station_access_codes for delete
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- verify_access_code(p_station_id, p_username, p_password)
-- Callable by anon (unauthenticated members). SECURITY DEFINER so it runs
-- as the function owner (postgres) and bypasses RLS. Returns the access
-- config on success, or NULL on any failure (bad username / disabled /
-- wrong password). Records access (last_accessed_at + access_count) only
-- on a successful match.
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
  v_row   station_access_codes%rowtype;
  v_hash  text;
  v_upper text;
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
    return null;
  end if;

  -- SHA-256 hex of the supplied password (pgcrypto digest).
  v_hash := encode(extensions.digest(p_password, 'sha256'), 'hex');

  if v_hash <> v_row.password_hash then
    return null;
  end if;

  -- Success: record the access, then return the (non-secret) config.
  update station_access_codes
     set last_accessed_at = now(),
         access_count     = access_count + 1
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

-- Allow anon (unauthenticated members) to call the verify RPC. By default
-- the public role can execute functions; ensure it explicitly.
grant execute on function verify_access_code(text, text, text) to anon, authenticated;
