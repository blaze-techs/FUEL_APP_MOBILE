import { useState } from "react";
import { useLocation } from "@/react-app/context/LocationContext";
import { useStations } from "@/react-app/context/StationContext";
import {
  Globe,
  MapPin,
  Check,
  ChevronDown,
  Navigation,
  Clock,
  Phone,
  DollarSign,
  Receipt,
  Users,
  CreditCard,
  Fuel,
  Shield,
  BookOpen,
  Ruler,
  Languages,
  Newspaper,
  Search,
} from "lucide-react";

interface LocationSelectorProps {
  compact?: boolean;
  onChange?: () => void;
}

export default function LocationSelector({
  compact = false,
  onChange,
}: LocationSelectorProps) {
  const { currentStation } = useStations();
  const location = useLocation();
  const [showSelector, setShowSelector] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);

  if (!currentStation) return null;

  const stationId = currentStation.id;
  const stationCountry = location.getStationCountry(stationId);
  const currentLoc = location.getStationLocation(stationId);

  const filteredCountries = location.allCountries.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.currency.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.region.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleSelect = (countryCode: string) => {
    location.setStationCountry(stationId, countryCode);
    setShowSelector(false);
    setDetectedCountry(null);
    onChange?.();
  };

  const handleAutoDetect = async () => {
    setDetecting(true);
    try {
      const loc = await location.detectLocation(stationId);
      setDetectedCountry(loc.countryCode);
    } catch {
      // Fallback handled in detectLocation
    } finally {
      setDetecting(false);
    }
  };

  if (compact) {
    return (
      <button
        onClick={() => setShowSelector(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-xs transition-colors border border-amber-500/30"
      >
        <Globe size={14} />
        <span>
          {stationCountry.flag} {stationCountry.name}
        </span>
        <span className="text-amber-400/70">
          {stationCountry.currency.code}
        </span>
      </button>
    );
  }

  return (
    <>
      {/* Selector Trigger */}
      <button
        onClick={() => setShowSelector(true)}
        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm transition-all border border-white/20 hover:border-white/30"
      >
        <span className="text-lg">{stationCountry.flag}</span>
        <span className="font-medium">{stationCountry.name}</span>
        <span className="text-xs text-gray-400">
          {stationCountry.currency.code}
        </span>
        <ChevronDown size={14} className="text-gray-400" />
      </button>

      {/* Full Selector Modal */}
      {showSelector && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          onClick={() => setShowSelector(false)}
        >
          <div
            className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto shadow-2xl border border-white/20"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-slate-800 border-b border-white/10 p-5 z-10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Globe size={20} className="text-amber-400" />
                  Select Station Location
                </h3>
                <button
                  onClick={() => setShowSelector(false)}
                  className="text-gray-400 hover:text-white"
                >
                  Close
                </button>
              </div>

              {/* Search & Auto-detect */}
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search country, currency, or region..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <button
                  onClick={handleAutoDetect}
                  disabled={detecting}
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-600 text-gray-900 text-sm rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  <Navigation
                    size={14}
                    className={detecting ? "animate-spin" : ""}
                  />
                  {detecting ? "Detecting..." : "Auto-detect"}
                </button>
              </div>

              {detectedCountry && (
                <div className="mt-3 bg-green-500/20 border border-green-500/30 rounded-lg p-3 flex items-center gap-2 text-sm text-green-300">
                  <Check size={14} />
                  Location detected: {
                    location.getCountry(detectedCountry).name
                  }{" "}
                  ({location.getCountry(detectedCountry).currency.code})
                </div>
              )}
            </div>

            {/* Country List */}
            <div className="p-5 space-y-3">
              {filteredCountries.map((country) => {
                const isSelected = stationCountry.id === country.id;
                const loc = location.getStationLocation(stationId);
                const hasLocation = loc?.countryCode === country.id;

                return (
                  <button
                    key={country.id}
                    onClick={() => handleSelect(country.id)}
                    className={`w-full text-left rounded-xl p-4 transition-all border ${
                      isSelected
                        ? "bg-amber-500/20 border-amber-500/40"
                        : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl flex-shrink-0">
                        {country.flag}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-white">
                            {country.name}
                          </p>
                          {isSelected && (
                            <Check size={14} className="text-amber-400" />
                          )}
                          <span className="text-xs text-gray-400 bg-white/10 px-2 py-0.5 rounded">
                            {country.region}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                          <div className="flex items-center gap-1.5 text-xs text-gray-300">
                            <DollarSign size={12} className="text-green-400" />
                            {country.currency.code} ({country.currency.symbol})
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-gray-300">
                            <Receipt size={12} className="text-amber-400" />
                            {country.revenueAuthority.shortName} VAT{" "}
                            {country.revenueAuthority.vatRate}%
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-gray-300">
                            <CreditCard size={12} className="text-amber-400" />
                            {country.mobileMoney.length} Mobile Money
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-gray-300">
                            <Languages size={12} className="text-purple-400" />
                            {country.defaultLanguage.toUpperCase()}
                          </div>
                        </div>

                        {/* Expanded details */}
                        {isSelected && (
                          <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Shield size={12} className="text-red-400" />
                              {country.revenueAuthority.name}
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Fuel size={12} className="text-orange-400" />
                              Price controlled:{" "}
                              {country.fuelRegulations.priceControlled
                                ? "Yes"
                                : "No"}
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Ruler size={12} className="text-teal-400" />
                              {country.units.fuelVolume}
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Phone size={12} className="text-pink-400" />
                              {country.communication.countryCode}
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Clock size={12} className="text-amber-400" />
                              {country.timezone
                                .split("/")[1]
                                ?.replace(/_/g, " ") || country.timezone}
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-400">
                              <Newspaper
                                size={12}
                                className="text-indigo-400"
                              />
                              {country.newsSources.length} News Sources
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filteredCountries.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Globe size={32} className="mx-auto mb-2" />
                  <p>No countries found matching "{searchQuery}"</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
