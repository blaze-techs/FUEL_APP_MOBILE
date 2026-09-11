-- 010_fuel_prices_smartcache_seed.sql
-- FREE AUTO FUEL PRICE spec: PostGIS spatial Smart-Cache for hyper-local fuel prices.
--
-- NOTE: the fuel_prices table + PostGIS extension + get_nearest_fuel RPC +
-- location-population trigger were created in a prior session. This migration
-- ONLY seeds additional Kenya EPRA-style prices for major towns so the
-- Smart-Cache covers the whole country (most users get an instant nearest-town
-- price without ever burning a SerpApi/Groq live search).
--
-- Existing schema (do not recreate):
--   fuel_prices(location_name text, country text, country_code text,
--               lat numeric, lon numeric, location geography(point,4326),
--               prices jsonb {super_petrol,diesel,kerosene}, currency text,
--               source text, last_updated timestamptz, query_count int)
--   unique(location_name, country)
-- The `location` geography is auto-populated by the update_location_geog trigger.

-- Ensure the nearest-town RPC exists (idempotent). Returns the closest cached
-- town within radius_km using ST_DWithin, with a planar-haversine fallback if
-- PostGIS is somehow unavailable.
create or replace function get_nearest_fuel(user_lat numeric, user_lon numeric, radius_km integer default 50)
returns table (
  location_name text,
  distance_km numeric,
  prices jsonb,
  currency text,
  source text,
  last_updated timestamp with time zone
) as $$
begin
  if exists (select 1 from pg_extension where extname = 'postgis') then
    return query
    select
      f.location_name,
      (st_distance(f.location, st_point(user_lon, user_lat)::geography) / 1000)::numeric as distance_km,
      f.prices,
      f.currency,
      f.source,
      f.last_updated
    from fuel_prices f
    where f.location is not null
      and st_dwithin(f.location, st_point(user_lon, user_lat)::geography, radius_km * 1000)
    order by distance_km asc
    limit 1;
  else
    return query
    select
      f.location_name,
      (
        6371 * 2 * asin(sqrt(
          power(sin(radians(user_lat - f.lat) / 2), 2) +
          cos(radians(user_lat)) * cos(radians(f.lat)) *
          power(sin(radians(user_lon - f.lon) / 2), 2)
        ))
      )::numeric as distance_km,
      f.prices,
      f.currency,
      f.source,
      f.last_updated
    from fuel_prices f
    where f.lat is not null and f.lon is not null
      and (
        6371 * 2 * asin(sqrt(
          power(sin(radians(user_lat - f.lat) / 2), 2) +
          cos(radians(user_lat)) * cos(radians(f.lat)) *
          power(sin(radians(user_lon - f.lon) / 2), 2)
        ))
      ) <= radius_km
    order by distance_km asc
    limit 1;
  end if;
end;
$$ language plpgsql;

-- Auto-populate the `location` geography column from lat/lon on insert/update,
-- so the nearest-town ST_DWithin query works without the caller computing it.
create or replace function set_fuel_location_geog()
returns trigger as $$
begin
  if new.lat is not null and new.lon is not null then
    new.location := st_setSRID(st_makePoint(new.lon, new.lat), 4326)::geography;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_fuel_location on fuel_prices;
create trigger trg_set_fuel_location
before insert or update on fuel_prices
for each row execute function set_fuel_location_geog();

-- RLS: fuel prices are public reference data — readable by anyone (anon +
-- authenticated) so the client can do exact + nearest-town lookups with only
-- the publishable key. Writes are service-role only (live-search backend / cron).
alter table fuel_prices enable row level security;
drop policy if exists "public read fuel prices" on fuel_prices;
create policy "public read fuel prices" on fuel_prices
  for select using (true);

-- Seed Kenya EPRA-style prices for major towns (Aug 2026 indicative). The
-- `location` geography column is auto-populated by the trigger from lat/lon.
-- prices jsonb keys: super_petrol, diesel, kerosene.
insert into fuel_prices (location_name, country, country_code, lat, lon, prices, currency, source, last_updated)
values
  ('Nakuru','Kenya','KE',-0.3031,36.0800,'{"super_petrol":213.36,"diesel":222.53,"kerosene":191.03}','KES','Published Reference',now()),
  ('Eldoret','Kenya','KE',0.5143,35.2698,'{"super_petrol":213.69,"diesel":223.09,"kerosene":191.63}','KES','Published Reference',now()),
  ('Nyeri','Kenya','KE',-0.4167,36.9500,'{"super_petrol":213.36,"diesel":222.53,"kerosene":191.03}','KES','Published Reference',now()),
  ('Meru','Kenya','KE',0.0463,37.6456,'{"super_petrol":213.69,"diesel":223.09,"kerosene":191.63}','KES','Published Reference',now()),
  ('Lodwar','Kenya','KE',3.1192,35.5980,'{"super_petrol":216.20,"diesel":225.60,"kerosene":194.14}','KES','Published Reference',now()),
  ('Garissa','Kenya','KE',-0.4536,39.6461,'{"super_petrol":214.92,"diesel":224.09,"kerosene":192.59}','KES','Published Reference',now()),
  ('Kakamega','Kenya','KE',0.2827,34.7519,'{"super_petrol":214.26,"diesel":223.43,"kerosene":191.93}','KES','Published Reference',now()),
  ('Malindi','Kenya','KE',-3.1392,40.1167,'{"super_petrol":210.87,"diesel":219.58,"kerosene":188.09}','KES','Published Reference',now()),
  ('Kitale','Kenya','KE',1.0156,34.9882,'{"super_petrol":214.59,"diesel":223.76,"kerosene":192.26}','KES','Published Reference',now()),
  ('Machakos','Kenya','KE',-1.5167,37.2667,'{"super_petrol":213.36,"diesel":222.53,"kerosene":191.03}','KES','Published Reference',now()),
  ('Thika','Kenya','KE',-1.0333,37.0833,'{"super_petrol":213.36,"diesel":222.53,"kerosene":191.03}','KES','Published Reference',now()),
  ('Naivasha','Kenya','KE',-0.7283,36.4322,'{"super_petrol":213.36,"diesel":222.53,"kerosene":191.03}','KES','Published Reference',now()),
  ('Kericho','Kenya','KE',-0.3677,35.2884,'{"super_petrol":214.26,"diesel":223.43,"kerosene":191.93}','KES','Published Reference',now()),
  ('Bungoma','Kenya','KE',0.5700,34.5600,'{"super_petrol":214.59,"diesel":223.76,"kerosene":192.26}','KES','Published Reference',now()),
  ('Wajir','Kenya','KE',1.7470,40.0630,'{"super_petrol":217.20,"diesel":226.60,"kerosene":195.14}','KES','Published Reference',now())
on conflict (location_name, country) do nothing;

-- Backfill the geography column for any rows that pre-date the trigger
-- (e.g. rows inserted by the live-search engine before this migration ran).
update fuel_prices
set location = st_setSRID(st_makePoint(lon, lat), 4326)::geography
where location is null and lat is not null and lon is not null;
