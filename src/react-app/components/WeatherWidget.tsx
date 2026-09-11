import { useState, useEffect, useCallback, useRef } from "react";
import {
  Cloud,
  Sun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Droplets,
  Wind,
  Eye,
  RefreshCw,
  MapPin,
  Loader2,
} from "lucide-react";
import { useLocation } from "@/react-app/context/LocationContext";
import { useStations } from "@/react-app/context/StationContext";
import { getCountryById, CAPITAL_COORDS } from "@/react-app/config/countries";
import { getDetectedCountryCode } from "@/react-app/lib/currency";

interface WeatherData {
  temp: number;
  condition: string;
  description: string;
  humidity: number;
  windSpeed: number;
  visibility: number;
  icon: string;
  feelsLike: number;
  location: string;
  lat: number;
  lng: number;
}

export default function WeatherWidget() {
  const { currentStation } = useStations();
  const { preciseLocation, preciseLocationLoading, detectPreciseLocation } =
    useLocation();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [usingPrecise, setUsingPrecise] = useState(false);

  const fetchWeather = useCallback(
    async (lat: number, lng: number, locationName: string) => {
      setLoading(true);
      setError("");
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,visibility&timezone=auto`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Weather API error");
        const data = await res.json();
        const current = data.current;

        const code = current.weather_code;
        let condition = "Clear";
        let description = "Clear sky";
        if (code === 0) {
          condition = "Clear";
          description = "Clear sky";
        } else if (code >= 1 && code <= 3) {
          condition = "Cloudy";
          description = "Partly cloudy";
        } else if (code >= 45 && code <= 48) {
          condition = "Foggy";
          description = "Foggy conditions";
        } else if (code >= 51 && code <= 67) {
          condition = "Rain";
          description = "Rainy conditions";
        } else if (code >= 71 && code <= 77) {
          condition = "Snow";
          description = "Snowfall";
        } else if (code >= 80 && code <= 82) {
          condition = "Rain";
          description = "Heavy showers";
        } else if (code >= 85 && code <= 86) {
          condition = "Snow";
          description = "Snow showers";
        } else if (code >= 95) {
          condition = "Storm";
          description = "Thunderstorm";
        }

        setWeather({
          temp: current.temperature_2m,
          condition,
          description,
          humidity: current.relative_humidity_2m,
          windSpeed: current.wind_speed_10m,
          visibility: current.visibility / 1000,
          icon: condition,
          feelsLike: current.apparent_temperature,
          location: locationName,
          lat,
          lng,
        });
        setUsingPrecise(locationName !== "Default");
        setLastUpdated(new Date());
      } catch {
        setError("Failed to load weather");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Use precise location when available. Depend on primitive coordinate fields
  // rather than the whole preciseLocation object (which is a new reference
  // every set, causing the weather fetch + "Precise GPS" badge to churn).
  const lastFetchedKeyRef = useRef("");
  useEffect(() => {
    const lat = preciseLocation?.lat;
    const lng = preciseLocation?.lng;
    const addr = preciseLocation?.address;
    const stationLoc = currentStation?.location;

    if (lat != null && lng != null) {
      const key = `p:${lat.toFixed(2)},${lng.toFixed(2)}`;
      if (key === lastFetchedKeyRef.current) return; // already fetched
      lastFetchedKeyRef.current = key;
      fetchWeather(lat, lng, addr);
    } else if (!preciseLocationLoading) {
      const cc = getDetectedCountryCode();
      const detectedCountry = getCountryById(cc);
      const fallbackCity = detectedCountry?.capital || "Your location";
      const capitalCoords = CAPITAL_COORDS[cc.toUpperCase()] || {
        lat: -1.2921,
        lng: 36.8219,
      };
      const fallback = stationLoc
        ? { lat: capitalCoords.lat, lng: capitalCoords.lng, name: stationLoc }
        : {
            lat: capitalCoords.lat,
            lng: capitalCoords.lng,
            name: fallbackCity,
          };
      const key = `f:${fallback.lat},${fallback.lng}`;
      if (key === lastFetchedKeyRef.current) return;
      lastFetchedKeyRef.current = key;
      fetchWeather(fallback.lat, fallback.lng, fallback.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    preciseLocation?.lat,
    preciseLocation?.lng,
    preciseLocation?.address,
    preciseLocationLoading,
    currentStation?.location,
    fetchWeather,
  ]);

  const getIcon = () => {
    if (!weather) return <Sun size={32} className="text-amber-400" />;
    switch (weather.icon) {
      case "Clear":
        return <Sun size={32} className="text-amber-400" />;
      case "Cloudy":
        return <Cloud size={32} className="text-gray-500 dark:text-gray-400" />;
      case "Rain":
        return <CloudRain size={32} className="text-blue-400" />;
      case "Snow":
        return <CloudSnow size={32} className="text-cyan-300" />;
      case "Storm":
        return <CloudLightning size={32} className="text-purple-400" />;
      default:
        return <Sun size={32} className="text-amber-400" />;
    }
  };

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-200 dark:border-blue-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-2">
          <MapPin size={15} />
          {usingPrecise ? "Current Location Weather" : "Station Weather"}
        </h3>
        <div className="flex items-center gap-2">
          {usingPrecise && (
            <span className="flex items-center gap-1 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded">
              <MapPin size={8} /> Precise GPS
            </span>
          )}
          <button
            onClick={() => detectPreciseLocation()}
            className="text-blue-500 hover:text-blue-700 transition-colors"
            title="Refresh precise location"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading || preciseLocationLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="text-blue-400 animate-spin" />
          <span className="text-sm text-gray-500 ml-2">
            Getting precise location...
          </span>
        </div>
      ) : error ? (
        <div className="text-center py-6">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={() => detectPreciseLocation()}
            className="mt-2 text-xs text-blue-500 hover:text-blue-700"
          >
            Retry
          </button>
        </div>
      ) : weather ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {getIcon()}
              <div>
                <p className="text-3xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
                  {Math.round(weather.temp)}°C
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                  Feels like {Math.round(weather.feelsLike)}°C
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {weather.description}
              </p>
              <p className="text-xs text-gray-500">{weather.location}</p>
              {lastUpdated && (
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  Updated {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                icon: Droplets,
                label: "Humidity",
                value: `${weather.humidity}%`,
                color: "text-blue-500",
              },
              {
                icon: Wind,
                label: "Wind",
                value: `${weather.windSpeed} km/h`,
                color: "text-teal-500",
              },
              {
                icon: Eye,
                label: "Visibility",
                value: `${weather.visibility.toFixed(1)} km`,
                color: "text-purple-500",
              },
            ].map((m) => (
              <div
                key={m.label}
                className="bg-white/50 dark:bg-gray-50 dark:bg-white/5 rounded-lg p-2.5 text-center"
              >
                <m.icon size={16} className={`mx-auto mb-1 ${m.color}`} />
                <p className="text-[10px] text-gray-500">{m.label}</p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
