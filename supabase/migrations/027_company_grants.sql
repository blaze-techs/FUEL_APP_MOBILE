-- 027_company_grants.sql
-- Secure, revocable, expiring "Company QR / access grant" for the Branding &
-- Tools → Company QR Code feature.
--
-- PROBLEM addressed: previously the Company QR Code was a static JSON blob
-- (company name/VAT/phone) rendered by an external API (qrserver.com) that
-- encoded no actual access — scanning it granted nothing. The replacement:
-- owner creates a crypto-random, revocable, expiring grant that lets a
-- member open the shared link and view the station's read-only data for a
-- specified period WITHOUT a password or account.
--
-- The grant secret is the `code` (~93 bits of randomness, never stored in a
-- form that reveals itself to other rows). Verification happens in a
-- SECURITY DEFINER RPC `redeem_company_grant` so an UNAUTHENTICATED member
-- (no Supabase session, no RLS access to app_kv) can redeem a shared link.

create extension if not exists pgcrypto;

create table if not exists company_grants (
  id         text primary key,
  code       text not null unique,
  station_id text not null,
  owner_id   uuid not null,
  -- the owner whose data the grant grants access to
  member_name text not null default '',   -- hint label (shown to the redeemer)
  member_role text not null default 'Staff', -- role label for the viewer
  allowed_tabs  jsonb not null default '[]'::jsonb, -- empty = all tabs
  read_only  boolean not null default true,
  enabled   boolean not null default true,
  revoked   boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  max_uses   integer,            -- null = unlimited
  uses       integer not null default 0,
  last_redeemed_at timestamptz,
  failed_attempt_count integer not null default 0,
  first_failed_at  timestamptz,
  locked_until     timestamptz
);

create index if not exists company_grants_owner_station_idx
  on company_grants (owner_id, station_id);

-- RLS: the OWNER (auth.uid() = owner_id) can CRUD their own grants. The
-- redeem RPC is SECURITY DEFINER and callable by anon.
alter table company_grants enable row level security;

drop policy if exists company_grants_owner_select on company_grants;
create policy company_grants_owner_select
  on company_grants for select
  using (auth.uid() = owner_id);

drop policy if exists company_grants_owner_insert on company_grants;
create policy company_grants_owner_insert
  on company_grants for insert
  with check (auth.uid() = owner_id);

drop policy if exists company_grants_owner_update on company_grants;
create policy company_grants_owner_update
  on company_grants for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists company_grants_owner_delete on company_grants;
create policy company_grants_owner_delete
  on company_grants for delete
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- redeem_company_grant(p_code text)
-- Anon-callable SECURITY DEFINER RPC. Looks up the grant by code and returns
-- the access config (with the owner + station ids so the member's client can
-- fetch the owner's public snapshot) on success, or NULL on any failure
-- (unknown code / disabled / revoked / expired / locked). Bumps usage
-- counters only on a successful redeem. The code column is the secret; an
-- attacker who guesses a code gets only the non-secret access config, and a
-- wrong code is indistinguishable from "no such grant".
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
  v_code text;
begin
  v_code := lower(trim(p_code));

  select * into v_row
  from company_grants
  where code = v_code
  limit 1;

  if not found then
    return null;
  end if;

  -- LOCKED (brute-force guard, mirroring verify_access_code).
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('locked', true, 'retryAfter', v_row.locked_until);
  end if;

  if v_row.locked_until is not null and v_row.locked_until <= now() then
    update company_grants
       set failed_attempt_count = 0,
           first_failed_at = null,
           locked_until = null
     where id = v_row.id;
    v_row.failed_attempt_count := 0;
    v_row.locked_until := null;
  end if;

  if not v_row.enabled or v_row.revoked then
    -- Burn the attempt budget so an attacker can't probe codes rapidly.
    update company_grants
       set failed_attempt_count = failed_attempt_count + 1
     where id = v_row.id;
    return null;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    update company_grants
       set failed_attempt_count = failed_attempt_count + 1
     where id = v_row.id;
    return null;
  end if;

  -- MAX-USE hard cap (server-side; never possible to exceed).
  if v_row.max_uses is not null and v_row.uses >= v_row.max_uses then
    return null;
  end if;

  -- SUCCESS: record the redeem, return the (non-secret) config.
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
    'stationId',    v_row.station_id,
    'stationOwnerId', v_row.owner_id::text,
    'expiresAt',  v_row.expires_at
  );
end;
$$;

grant execute on function redeem_company_grant(text) to anon, authenticated;