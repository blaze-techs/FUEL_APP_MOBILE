BEGIN;
DROP INDEX IF EXISTS public.station_access_codes_station_username_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS station_access_codes_station_username_uq
  ON public.station_access_codes (station_id, lower(username));
COMMIT;
