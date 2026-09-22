-- 20260922130000_company_qr_unique_user_hardening.sql
-- Company QR hardening:
-- 1) one active grant per recipient per station/owner;
-- 2) every new grant is one-use by default;
-- 3) redemption is atomic so two devices cannot consume the same one-use link;
-- 4) the relational company_grants table is the canonical SOR.

alter table public.company_grants
  add column if not exists recipient_key text not null default '';

update public.company_grants
set max_uses = 1
where max_uses is null;

alter table public.company_grants
  alter column max_uses set default 1;

create unique index if not exists company_grants_active_recipient_uidx
  on public.company_grants (owner_id, station_id, recipient_key)
  where enabled = true
    and revoked = false
    and recipient_key <> '';

-- Replace the earlier non-locking RPC. FOR UPDATE serializes concurrent
-- redemptions of the same grant, so a max_uses=1 grant can only succeed once.
create or replace function public.redeem_company_grant(
  p_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.company_grants%rowtype;
  v_code text;
begin
  v_code := lower(trim(p_code));

  select *
    into v_row
    from public.company_grants
   where lower(code) = v_code
   limit 1
   for update;

  if not found then
    return null;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
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
    v_row.failed_attempt_count := 0;
    v_row.locked_until := null;
  end if;

  if not v_row.enabled or v_row.revoked then
    return null;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return null;
  end if;

  if v_row.max_uses is not null and v_row.uses >= v_row.max_uses then
    return null;
  end if;

  update public.company_grants
     set uses = uses + 1,
         last_redeemed_at = now(),
         failed_attempt_count = 0,
         first_failed_at = null
   where id = v_row.id;

  return jsonb_build_object(
    'grantId', v_row.id,
    'memberName', v_row.member_name,
    'memberRole', v_row.member_role,
    'allowedTabs', v_row.allowed_tabs,
    'readOnly', v_row.read_only,
    'accessMode', coalesce(v_row.access_mode, case when v_row.read_only then 'read' else 'full' end),
    'stationId', v_row.station_id,
    'stationOwnerId', v_row.owner_id::text,
    'expiresAt', v_row.expires_at
  );
end;
$$;

grant execute on function public.redeem_company_grant(text) to anon, authenticated;
