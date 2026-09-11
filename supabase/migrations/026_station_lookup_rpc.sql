-- 026_station_lookup_rpc.sql
-- Public station lookup by code or name for member login.
--
-- PROBLEM: a team member logging in with a station-assigned username +
-- password shouldn't need to know the station OWNER's UUID + the station's
-- UUID (which the current /#/station-access page requires). They should be
-- able to enter a station code (e.g. "founder-admin-station-abc12") or the
-- station name, then their username + password.
--
-- The `stations` table has owner-scoped RLS (auth.uid() = owner_id), so an
-- UNAUTHENTICATED member cannot SELECT from it directly. This migration
-- adds a SECURITY DEFINER RPC `lookup_station(p_query text)` that an anon
-- caller can invoke to resolve a station code/name to the minimal fields
-- needed for access-code login: station_id, owner_id, station_name. It
-- returns ONLY those three fields (no addresses, phone numbers, financial
-- data, or other PII) so it's safe to expose publicly.
--
-- The RPC also powers the main AuthLogin "Station Member" login mode.

-- Case-insensitive, partial-match lookup. Returns up to 10 matches so the
-- member can pick the right station from a short list when several stations
-- share a name prefix.
create or replace function lookup_station(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text;
begin
  v_q := lower(trim(coalesce(p_query, '')));
  if v_q = '' then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'stationId',   s.id,
      'ownerId',     s.owner_id,
      'stationName', s.station_name,
      'code',        s.code
    ) order by
      -- Exact code match first, then exact name match, then partial.
      case when lower(s.code) = v_q then 0
           when lower(s.station_name) = v_q then 1
           else 2 end,
      s.station_name
    )
    from stations s
    where lower(s.code) = v_q
       or lower(s.station_name) = v_q
       or lower(s.code) like '%' || v_q || '%'
       or lower(s.station_name) like '%' || v_q || '%'
    limit 10
  ), '[]'::jsonb);
end;
$$;

-- Anon (unauthenticated members) + authenticated users can call the lookup.
grant execute on function lookup_station(text) to anon, authenticated;
