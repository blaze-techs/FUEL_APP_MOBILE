/**
 * Weather with a fail-safe provider chain.
 *
 * Open-Meteo stays authoritative (keyless, no attribution burden). MET Norway
 * and wttr.in are keyless independent sources so a station's weather context
 * survives an Open-Meteo outage, and so the temperature can be cross-checked.
 */

import { withFailover, type ProviderAttempt } from "./provider-failover";

export interface WeatherReading {
  /** Degrees Celsius. */
  temperatureC: number;
  /** km/h, when the provider reports it. */
  windKph: number | null;
  /** Provider id that produced this reading. */
  provider?: string;
  corroborated?: boolean;
}

const UA = "FuelAppMobile/1.0 (fuel-app-mobile.vercel.app)";

async function viaOpenMeteo(
  lat: number,
  lon: number,
): Promise<WeatherReading | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m`;
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const d = (await res.json()) as {
    current?: { temperature_2m?: number; wind_speed_10m?: number };
  };
  const t = d.current?.temperature_2m;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  return {
    temperatureC: t,
    windKph:
      typeof d.current?.wind_speed_10m === "number"
        ? d.current.wind_speed_10m
        : null,
  };
}

async function viaMetNo(
  lat: number,
  lon: number,
): Promise<WeatherReading | null> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`MET Norway ${res.status}`);
  const d = (await res.json()) as {
    properties?: {
      timeseries?: {
        data?: {
          instant?: { details?: Record<string, number> };
        };
      }[];
    };
  };
  const details = d.properties?.timeseries?.[0]?.data?.instant?.details;
  const t = details?.air_temperature;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  const windMs = details?.wind_speed;
  return {
    temperatureC: t,
    windKph:
      typeof windMs === "number" && Number.isFinite(windMs)
        ? Math.round(windMs * 3.6 * 10) / 10
        : null,
  };
}

async function viaWttr(
  lat: number,
  lon: number,
): Promise<WeatherReading | null> {
  const res = await fetch(`https://wttr.in/${lat},${lon}?format=j1`, {
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`wttr.in ${res.status}`);
  const d = (await res.json()) as {
    current_condition?: {
      temp_C?: string;
      windspeedKmph?: string;
    }[];
  };
  const c = d.current_condition?.[0];
  const t = c?.temp_C ? Number(c.temp_C) : NaN;
  if (!Number.isFinite(t)) return null;
  const w = c?.windspeedKmph ? Number(c.windspeedKmph) : NaN;
  return {
    temperatureC: t,
    windKph: Number.isFinite(w) ? w : null,
  };
}

/**
 * Read the current weather. Throws only when every provider fails.
 *
 * Temperature is rounded to 1 dp before comparison so two providers reporting
 * 21.4 and 21.44 still corroborate each other.
 */
export async function getWeather(
  lat: number,
  lon: number,
): Promise<WeatherReading> {
  const round = (r: WeatherReading): WeatherReading => ({
    ...r,
    temperatureC: Math.round(r.temperatureC * 10) / 10,
  });

  const attempts: ProviderAttempt<WeatherReading>[] = [
    {
      id: "open-meteo",
      run: async () => round((await viaOpenMeteo(lat, lon))!),
    },
    { id: "met-no", run: async () => round((await viaMetNo(lat, lon))!) },
    { id: "wttr", run: async () => round((await viaWttr(lat, lon))!) },
  ];

  const outcome = await withFailover(attempts, {
    timeoutMs: 9000,
    confirmWith: 2,
    // Corroboration tolerance: independent forecast models rarely agree to the
    // decimal, so within 2 °C counts as agreement.
    agrees: (a, b) => Math.abs(a.temperatureC - b.temperatureC) <= 2,
  });

  if (!outcome) throw new Error("Weather failed: all providers unavailable");
  return {
    ...outcome.value,
    provider: outcome.servedBy,
    corroborated: outcome.corroborated,
  };
}
