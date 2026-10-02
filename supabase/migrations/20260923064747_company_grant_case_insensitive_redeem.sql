-- Fix QR grant redemption for mixed-case generated codes.
-- QR codes intentionally contain upper/lower-case characters. Redemption must
-- normalize both the stored code and supplied URL/QR value.
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
    return null;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('locked', true, 'retryAfter', v_row.locked_until);
  end if;

  if v_row.locked_until is not null and v_row.locked_until <= now() then
    update public.company_grants
       set failed_attempt_count = 0,
           first_failed_at = null,
           locked_until = null
     where id = v_row.id;
    v_row.failed_attempt_count := 0;
    v_row.first_failed_at := null;
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
    'accessMode', v_row.access_mode,
    'stationId', v_row.station_id,
    'stationOwnerId', v_row.owner_id::text,
    'expiresAt', v_row.expires_at
  );
end;
$$;

grant execute on function public.redeem_company_grant(text)
  to anon, authenticated;
