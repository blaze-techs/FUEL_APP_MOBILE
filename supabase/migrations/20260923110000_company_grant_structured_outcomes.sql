-- 20260923110000_company_grant_structured_outcomes.sql
--
-- WHY: before this, `redeem_company_grant` returned NULL for EVERY failure
-- mode (unknown code, disabled, revoked, expired, usage-exhausted). The
-- member-facing page therefore had no way to distinguish them and rendered a
-- single catch-all message:
--
--   "This link is invalid, expired, or has been revoked by the station owner."
--
-- That is actively misleading: a grant that is still ACTIVE but has merely
-- reached its redemption cap (or a disabled one) was reported as "revoked"
-- even though `revoked = false` in the database. Owners saw an active grant
-- described to their members as revoked.
--
-- This RPC now returns a STRUCTURED jsonb outcome:
--   success : { ok:true, grantId, memberName, ... }
--   failure : { ok:false, reason:'invalid' | 'disabled' | 'revoked'
--                                | 'expired' | 'used_up' | 'locked' }
-- `reason` is what the UI uses to report the truth instead of guessing.
--
-- Backward compatibility: the legacy success fields are unchanged, and the
-- legacy `{locked:true,retryAfter}` shape is retained alongside the new
-- `reason:'locked'`, so an older client that only knows the old contract
-- keeps working.

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

  -- Checked in priority order so the most specific/actionable reason wins.
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
    'stationId', v_row.station_id,
    'stationOwnerId', v_row.owner_id::text,
    'expiresAt', v_row.expires_at
  );
end;
$$;

grant execute on function public.redeem_company_grant(text)
  to anon, authenticated;
