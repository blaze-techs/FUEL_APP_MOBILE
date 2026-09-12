import { useFuel } from "@/react-app/context/FuelContext";
import { useLocation } from "@/react-app/context/LocationContext";
import { useStations } from "@/react-app/context/StationContext";
import { useAutoSync } from "@/react-app/hooks/useAutoSync";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import {
  getSyncedFuelPrice,
  getPriceForCity,
} from "@/react-app/services/DataSyncService";
import RegulatoryAlerts from "@/react-app/components/RegulatoryAlerts";
import SyncStatusIndicator from "@/react-app/components/SyncStatusIndicator";
import WeatherWidget from "@/react-app/components/WeatherWidget";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Fuel,
  Users,
  AlertTriangle,
  BarChart3,
  Clock,
  Receipt,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  ShoppingCart,
  Droplets,
  CreditCard,
  Wallet,
  Globe,
  Zap,
  FileText,
  Smartphone,
  Truck,
  Plug,
  Printer,
} from "lucide-react";
import { formatNumber } from "@/react-app/utils/formatUtils";
import {
  CANONICAL_FUEL_TYPES,
  currencySymbolFor,
} from "@/react-app/config/pricing";
import { getCountryById } from "@/react-app/config/countries";
import { getLocaleForCountry } from "@/react-app/lib/currency";
import {
  navigateToTab,
  type StkPushPrefill,
  type FuelPricePrefill,
} from "@/react-app/lib/mpesa-integration-service";
import { useState, useEffect, useMemo, useCallback } from "react";
import { on } from "@/react-app/lib/automation-engine";

// API base URL getter. Uses the VITE_BACKEND_URL env var (empty string when
// unset, which makes the fetch a same-origin relative path — correct on
// Vercel where /api/* is served by the same origin, and a harmless 404 on
// static-only hosts where the result is ignored).
function getApiBase(): string {
  return import.meta.env.VITE_BACKEND_URL || "";
}

// Import chart.js components
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// Royal Professional chart typography (matches dashboard.html spec)
ChartJS.defaults.font.family =
  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
ChartJS.defaults.color = "#cbd5e1";

/**
 * Tank fill percentage for the Dashboard tank-level bar.
 *
 * Uses the period's opening reading as the true capacity denominator (the
 * opening reading is the tank's known-full level at the start of the period),
 * so the bar shows real fill rather than the old `closing/(closing+5000)`
 * magic-number heuristic that was wrong for every station whose tank wasn't
 * ~5000 L. When no opening reading exists, falls back to the closing reading
 * alone (treats it as full) so the bar is never 0% for a tank that clearly
 * has fuel.
 */
function tankFillPercent(opening: number, closing: number): number {
  const o = Math.max(0, Number(opening) || 0);
  const c = Math.max(0, Number(closing) || 0);
  if (c <= 0) return 0;
  const denom = o > 0 ? o : c;
  return Math.min(100, Math.max(0, (c / denom) * 100));
}

export default function Dashboard() {
  const { state } = useFuel();
  const location = useLocation();
  const { currentStation } = useStations();
  // Dynamic fuel-type support for the "Current Pump Prices" cards: read the
  // station's configured fuel types so the cards reflect EVERY fuel the
  // station sells (Kerosene, LPG, V-Power, etc.), not just Petrol/Diesel.
  // NOTE: prefer the real StationContext station id (currentStation?.id) —
  // that is the id FuelTypesManager writes fuel_types_config under. The
  // FuelContext `state.currentStationId` is a legacy "default_station" value
  // that resolves to a DIFFERENT (empty) cloud row, so the cards would never
  // show the configured fuel types.
  const stationId = currentStation?.id ?? state.currentStationId ?? undefined;
  const fuelTypeApi = useStationFuelTypes(stationId);
  // The station's country is the authoritative source for pricing/tax/currency
  // — NOT the GPS-detected country (which may be a VPN/tourist location and
  // would otherwise show foreign prices on a station's dashboard). Fall back to
  // the detected country only until the station has been loaded from cloud.
  const stationCountry = currentStation?.country || location.currentCountry.id;
  const {
    fuelPrice,
    taxRates,
    exchangeRates: _exchangeRates,
    isSyncing,
    lastSync: _lastSync,
    syncNow,
    locationPrice,
    currentLocation,
    refreshLocation: _refreshLocation,
    refreshPrices,
  } = useAutoSync(stationCountry);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Backend data state
  const [backendStats, setBackendStats] = useState<{
    totalRevenue: number;
    netProfit: number;
    fuelSold: number;
    balanceDue: number;
  } | null>(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const [hasBackendData, setHasBackendData] = useState(false);
  // Production mode - use real data

  // Resolve the station's own country profile (authoritative) for fuel-
  // regulation labels and the default city, falling back to the GPS-detected
  // profile so the UI always has a valid object even before the station loads
  // from cloud. Declared before stationCity so the capital fallback is in
  // scope.
  const stationCountryProfile =
    getCountryById(stationCountry.toUpperCase()) || location.currentCountry;

  // Use precise location-based fuel prices (auto-synced with GPS)
  const stationCity =
    currentStation?.location || stationCountryProfile?.capital || "—";
  // The useAutoSync hook's `fuelPrice` state can lag the synced cache during a
  // country switch (the station loads from cloud AFTER the hook's initial KE
  // sync). Read the persisted synced price for the STATION's country directly
  // so a German station shows €1.85 immediately instead of the Kenya default
  // (state.pmsPrice = 214.03) until the hook catches up.
  const effectiveFuelPrice = fuelPrice ?? getSyncedFuelPrice(stationCountry);
  const regionalPrice = getPriceForCity(effectiveFuelPrice, stationCity);
  // Prefer the STATION'S OWN configured price (state.pmsPrice/agoPrice) over
  // the global/EPRA synced price. The user's configured pump price is the
  // authoritative price they actually charge — the global price is only a
  // reference. Previously the global price took priority, causing a US station
  // with $1.10/L configured to show $3.45/L (global average) on the Dashboard.
  // Sanity guard for the legacy scalar prices: if the station is NOT in
  // Kenya but a stored price looks like a Kenya KSh price (>= 100 per
  // litre — absurd in USD/EUR/etc.), it's a stale Kenya default. Fall
  // through to the country-appropriate fallback instead so a US station
  // doesn't show "$220.08/L" for petrol or "$229.95/L" for diesel.
  const pmsPriceSanityOk =
    stationCountry === "KE" || !state.pmsPrice || state.pmsPrice < 100;
  const displayPmsPrice = pmsPriceSanityOk
    ? (state.pmsPrice ??
      locationPrice?.petrolPrice ??
      (regionalPrice.isRegional ? regionalPrice.petrol : null) ??
      effectiveFuelPrice?.petrolPrice ??
      fuelTypeApi.getPriceFor(CANONICAL_FUEL_TYPES.petrol.label) ??
      0)
    : (locationPrice?.petrolPrice ??
      (regionalPrice.isRegional ? regionalPrice.petrol : null) ??
      effectiveFuelPrice?.petrolPrice ??
      fuelTypeApi.getPriceFor(CANONICAL_FUEL_TYPES.petrol.label) ??
      0);
  const agoPriceSanityOk =
    stationCountry === "KE" || !state.agoPrice || state.agoPrice < 100;
  const displayAgoPrice = agoPriceSanityOk
    ? (state.agoPrice ??
      locationPrice?.dieselPrice ??
      (regionalPrice.isRegional ? regionalPrice.diesel : null) ??
      effectiveFuelPrice?.dieselPrice ??
      fuelTypeApi.getPriceFor(CANONICAL_FUEL_TYPES.diesel.label) ??
      0)
    : (locationPrice?.dieselPrice ??
      (regionalPrice.isRegional ? regionalPrice.diesel : null) ??
      effectiveFuelPrice?.dieselPrice ??
      fuelTypeApi.getPriceFor(CANONICAL_FUEL_TYPES.diesel.label) ??
      0);
  const keroseneConfigured = fuelTypeApi.getPriceFor(
    CANONICAL_FUEL_TYPES.kerosene.label,
  );
  const keroseneSanityOk =
    stationCountry === "KE" || !keroseneConfigured || keroseneConfigured < 100;
  const displayKerosenePrice = keroseneSanityOk
    ? (keroseneConfigured ??
      locationPrice?.kerosenePrice ??
      effectiveFuelPrice?.kerosenePrice ??
      0)
    : (locationPrice?.kerosenePrice ?? effectiveFuelPrice?.kerosenePrice ?? 0);
  // Show the detected city for location-based pricing
  const priceCityName =
    locationPrice?.cityName || regionalPrice.cityName || stationCity;
  const isLocationBased = !!locationPrice;

  /**
   * Dynamic "Current Pump Prices" card list. Built from the station's
   * configured fuel types (canonical-normalized) so a station selling
   * Kerosene/LPG/V-Power etc. shows a card for EACH fuel — not just the
   * hardcoded Petrol/Diesel/Kerosene. Falls back to the 3 legacy cards
   * (petrol/diesel/kerosene) when the station hasn't configured fuel types
   * yet, so there's no regression for existing stations.
   */
  const priceCards: Array<{
    key: string;
    label: string;
    price: number;
    color: string;
  }> = useMemo(() => {
    const active = fuelTypeApi.activeFuelTypes;
    if (active.length > 0) {
      // Map the configured fuel types to display prices. The user's
      // explicitly-configured price (ft.price, set in Fuel Type Manager) is
      // the source of truth — prefer it over the national-average fallback so
      // a station that sells Kerosene at $164.90 doesn't show the national
      // average of $3.20. Only when the configured price is 0/missing do we
      // fall back to the location/regional/national resolved price
      // (petrol/diesel/kerosene) or the FuelContext dynamic price store.
      return active.map((ft) => {
        const canonical = fuelTypeApi.canonicalOf(ft.name);
        const label = fuelTypeApi.labelOf(ft.name);
        let configured =
          typeof ft.price === "number" && ft.price > 0 ? ft.price : null;
        // Sanity guard: if the station is NOT in Kenya and the configured
        // price looks like a Kenya KSh price (>= 100 per litre — absurd in
        // USD/EUR/etc.), the stored value is a stale Kenya default. Discard
        // it so the country-appropriate fallback is used instead.
        if (
          configured != null &&
          stationCountry !== "KE" &&
          configured >= 100
        ) {
          configured = null;
        }
        let price = 0;
        if (configured != null) {
          price = configured;
        } else if (canonical === "petrol") price = displayPmsPrice;
        else if (canonical === "diesel") price = displayAgoPrice;
        else if (canonical === "kerosene") price = displayKerosenePrice;
        else {
          price =
            fuelTypeApi.getPriceFor(ft.name) ??
            state.fuelPricesByType?.[canonical ?? ft.name] ??
            ft.price ??
            0;
        }
        const color =
          canonical === "petrol"
            ? "text-green-700 dark:text-green-400"
            : canonical === "diesel"
              ? "text-amber-700 dark:text-amber-400"
              : canonical === "kerosene"
                ? "text-rose-700 dark:text-rose-400"
                : "text-indigo-700 dark:text-indigo-400";
        return { key: ft.id || canonical || ft.name, label, price, color };
      });
    }
    // Fallback: legacy 3 cards.
    return [
      {
        key: "petrol",
        label: CANONICAL_FUEL_TYPES.petrol.label,
        price: displayPmsPrice,
        color: "text-green-700 dark:text-green-400",
      },
      {
        key: "diesel",
        label: CANONICAL_FUEL_TYPES.diesel.label,
        price: displayAgoPrice,
        color: "text-amber-700 dark:text-amber-400",
      },
      {
        key: "kerosene",
        label: CANONICAL_FUEL_TYPES.kerosene.label,
        price: displayKerosenePrice,
        color: "text-rose-700 dark:text-rose-400",
      },
    ];
  }, [
    fuelTypeApi,
    displayPmsPrice,
    displayAgoPrice,
    displayKerosenePrice,
    state.fuelPricesByType,
    stationCountry,
  ]);

  /**
   * Dynamic "Pump Status" card list. One card per configured fuel type,
   * showing the count of pumps for that fuel (from the FuelContext
   * per-canonical-type store `fuelPumpsByType`, falling back to the legacy
   * `pmsPumps`/`agoPumps` for petrol/diesel). When no fuel types are
   * configured, falls back to the legacy petrol/diesel pair.
   */
  const pumpStatusCards: Array<{
    key: string;
    label: string;
    count: number;
    bg: string;
    text: string;
  }> = useMemo(() => {
    const active = fuelTypeApi.activeFuelTypes;
    if (active.length > 0) {
      const palette: Record<string, { bg: string; text: string }> = {
        petrol: {
          bg: "bg-green-50 dark:bg-green-900/20",
          text: "text-green-700 dark:text-green-300",
        },
        diesel: {
          bg: "bg-amber-50 dark:bg-amber-900/20",
          text: "text-amber-700 dark:text-amber-300",
        },
        kerosene: {
          bg: "bg-rose-50 dark:bg-rose-900/20",
          text: "text-rose-700 dark:text-rose-300",
        },
      };
      const fallback = {
        bg: "bg-indigo-50 dark:bg-indigo-900/20",
        text: "text-indigo-700 dark:text-indigo-300",
      };
      return active.map((ft) => {
        const canonical = fuelTypeApi.canonicalOf(ft.name);
        const pumps =
          (canonical && state.fuelPumpsByType?.[canonical]) ||
          (canonical === "petrol"
            ? state.pmsPumps
            : canonical === "diesel"
              ? state.agoPumps
              : []) ||
          [];
        const colors = (canonical && palette[canonical]) || fallback;
        return {
          key: ft.id || canonical || ft.name,
          label: fuelTypeApi.labelOf(ft.name),
          count: Array.isArray(pumps) ? pumps.length : 0,
          ...colors,
        };
      });
    }
    return [
      {
        key: "petrol",
        label: CANONICAL_FUEL_TYPES.petrol.label,
        count: state.pmsPumps.length,
        bg: "bg-green-50 dark:bg-green-900/20",
        text: "text-green-700 dark:text-green-300",
      },
      {
        key: "diesel",
        label: CANONICAL_FUEL_TYPES.diesel.label,
        count: state.agoPumps.length,
        bg: "bg-amber-50 dark:bg-amber-900/20",
        text: "text-amber-700 dark:text-amber-300",
      },
    ];
  }, [fuelTypeApi, state.fuelPumpsByType, state.pmsPumps, state.agoPumps]);

  // Tank Level cards — dynamic per fuel type (was hardcoded to only
  // Super Petrol Tank + Diesel Tank). A station with Kerosene/V-Power/LPG
  // etc. gets a tank card for each configured fuel type.
  const tankLevelCards: Array<{
    key: string;
    label: string;
    opening: number;
    closing: number;
    barClass: string;
  }> = useMemo(() => {
    const active = fuelTypeApi.activeFuelTypes;
    const barPalette: Record<string, string> = {
      petrol: "from-green-400 to-green-600",
      diesel: "from-amber-400 to-amber-600",
      kerosene: "from-rose-400 to-rose-600",
    };
    const fallbackBar = "from-indigo-400 to-indigo-600";
    const build = (
      key: string,
      label: string,
      opening: number,
      closing: number,
      canonical?: string | null,
    ) => ({
      key,
      label,
      opening,
      closing,
      barClass: (canonical && barPalette[canonical]) || fallbackBar,
    });
    if (active.length > 0) {
      return active.map((ft) => {
        const canonical = fuelTypeApi.canonicalOf(ft.name);
        const tv =
          canonical === "petrol"
            ? { opening: state.pmsTankOpening, closing: state.pmsTankClosing }
            : canonical === "diesel"
              ? { opening: state.agoTankOpening, closing: state.agoTankClosing }
              : (state.fuelTankValuesByType?.[canonical || ft.name] ?? {
                  opening: 0,
                  closing: 0,
                });
        return build(
          ft.id || canonical || ft.name,
          fuelTypeApi.labelOf(ft.name),
          tv.opening,
          tv.closing,
          canonical,
        );
      });
    }
    return [
      build(
        "petrol",
        CANONICAL_FUEL_TYPES.petrol.label,
        state.pmsTankOpening,
        state.pmsTankClosing,
        "petrol",
      ),
      build(
        "diesel",
        CANONICAL_FUEL_TYPES.diesel.label,
        state.agoTankOpening,
        state.agoTankClosing,
        "diesel",
      ),
    ];
  }, [
    fuelTypeApi,
    state.fuelTankValuesByType,
    state.pmsTankOpening,
    state.pmsTankClosing,
    state.agoTankOpening,
    state.agoTankClosing,
  ]);

  // Currency symbol must match the STATION's currency (e.g. "€" for a German
  // station), never the GPS/browser-detected currency. Fall back to the
  // location-derived symbol only if the station has no currency set.
  const currencySymbol =
    currentStation?.currencySymbol ||
    currencySymbolFor(currentStation?.currency || "") ||
    location.currencySymbol;
  const [animatedValues, setAnimatedValues] = useState({
    revenue: 0,
    profit: 0,
    fuelSold: 0,
    debt: 0,
  });
  // Locale for date/number formatting — derived from the STATION's country
  // (never a hardcoded "en-KE"), so a German station formats dates in de-DE.
  // Falls back to the browser locale if the station country is unknown.
  const stationLocale = useMemo(() => {
    const langs = stationCountryProfile?.languages;
    const cc = stationCountryProfile?.id || stationCountry;
    if (langs && langs.length > 0 && cc) {
      try {
        const loc = new Intl.Locale(`${langs[0]}-${cc.toUpperCase()}`);
        return loc.toString();
      } catch {
        /* fall through */
      }
    }
    return undefined; // browser default
  }, [stationCountryProfile, stationCountry]);

  // Fetch dashboard stats from backend
  const fetchBackendStats = useCallback(async () => {
    // Get auth token
    let token: string | null = null;
    try {
      const sessionJson = localStorage.getItem("fuelpro_founder_session");
      if (sessionJson) {
        const session = JSON.parse(sessionJson);
        if (session.active && session.token) {
          token = session.token;
        }
      }
    } catch {
      /* no session */
    }

    if (!token) return;

    setBackendLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/dashboard/stats`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setBackendStats(data.data);
          setHasBackendData(true);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch backend stats:", e);
    } finally {
      setBackendLoading(false);
    }
  }, []);

  // Fetch on mount and periodically
  useEffect(() => {
    fetchBackendStats();
    const interval = setInterval(fetchBackendStats, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchBackendStats]);

  // Re-fetch dashboard data when the automation engine signals a refresh
  // (e.g. a sale completed or a price changed elsewhere in the app).
  useEffect(() => {
    const unsubSale = on("sale:completed", () => {
      fetchBackendStats();
    });
    const unsubPrice = on("price:changed", () => {
      refreshPrices();
      fetchBackendStats();
    });
    const onRefresh = () => {
      fetchBackendStats();
    };
    window.addEventListener("automation:refresh-dashboard", onRefresh);
    window.addEventListener("automation:refresh-prices", onRefresh);
    return () => {
      unsubSale();
      unsubPrice();
      window.removeEventListener("automation:refresh-dashboard", onRefresh);
      window.removeEventListener("automation:refresh-prices", onRefresh);
    };
  }, [fetchBackendStats, refreshPrices]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Calculate totals from sales history (declared before the animation
  // effect so the effect can depend on these values — otherwise the KPI
  // cards never re-animate when sales data loads from cloud after mount,
  // leaving them stuck at 0).
  const {
    totalRevenue,
    netProfit,
    totalFuelSold,
    totalDebt,
    totalExpenses,
    todaySales,
  } = useMemo(() => {
    const history = Object.values(state.salesHistory);
    let revenue = 0;
    let expenses = 0;
    let fuel = 0;
    let profit = 0;

    history.forEach((entry: any) => {
      const pmsTotal = (entry.pmsPumps || []).reduce(
        (s: number, p: any) => s + (p.salesKsh || 0),
        0,
      );
      const agoTotal = (entry.agoPumps || []).reduce(
        (s: number, p: any) => s + (p.salesKsh || 0),
        0,
      );
      // Sum dynamic fuel types from Sales Tracking (fuelPumpsByType is a
      // Record<fuelType, Pump[]> — covers LPG, Kerosene, V-Power, etc.)
      const byTypeTotal = Object.values(entry.fuelPumpsByType || {}).reduce(
        (s: number, pumps: any) =>
          s +
          (Array.isArray(pumps)
            ? pumps.reduce((ps: number, p: any) => ps + (p.salesKsh || 0), 0)
            : 0),
        0,
      );
      // Also count POS sales (from PointOfSale tab) — previously these were
      // silently excluded, so a completed POS sale never showed in Total Revenue.
      const pos = entry.posSales || {};
      const posPms = pos.pmsAmount || 0;
      const posAgo = pos.agoAmount || 0;
      const posByType = Object.values(pos.byTypeAmount || {}).reduce(
        (s: number, v: any) => s + (Number(v) || 0),
        0,
      );
      // byTypeAmount may include PMS/AGO too, so avoid double-counting:
      // prefer byTypeAmount when present (it's the canonical record), else
      // fall back to pmsAmount + agoAmount.
      const posTotal =
        Object.keys(pos.byTypeAmount || {}).length > 0
          ? posByType
          : posPms + posAgo;
      revenue += pmsTotal + agoTotal + byTypeTotal + posTotal;

      // Fuel sold: pump litres + POS litres
      fuel += (entry.pmsPumps || []).reduce(
        (s: number, p: any) => s + (p.salesL || 0),
        0,
      );
      fuel += (entry.agoPumps || []).reduce(
        (s: number, p: any) => s + (p.salesL || 0),
        0,
      );
      // Dynamic fuel type litres from Sales Tracking
      fuel += Object.values(entry.fuelPumpsByType || {}).reduce(
        (s: number, pumps: any) =>
          s +
          (Array.isArray(pumps)
            ? pumps.reduce((ps: number, p: any) => ps + (p.salesL || 0), 0)
            : 0),
        0,
      ) as number;
      const posLitresByType = Object.values(pos.byTypeLitres || {}).reduce(
        (s: number, v: any) => s + (Number(v) || 0),
        0,
      );
      const posLitres =
        Object.keys(pos.byTypeLitres || {}).length > 0
          ? posLitresByType
          : (pos.pmsLitres || 0) + (pos.agoLitres || 0);
      fuel += posLitres;

      expenses += (entry.expenses || []).reduce(
        (s: number, e: any) => s + (e.amount || 0),
        0,
      );
    });

    profit = revenue - expenses;
    const debt = state.deliveryData.totals.balanceDue;

    // Get today's sales
    const today = new Date().toISOString().split("T")[0];
    const todayEntry: any = Object.entries(state.salesHistory).find(([k]) =>
      k.startsWith(today),
    );
    const tSales = todayEntry
      ? (() => {
          const e = todayEntry[1] as any;
          const pms = (e.pmsPumps || []).reduce(
            (s: number, p: any) => s + (p.salesKsh || 0),
            0,
          );
          const ago = (e.agoPumps || []).reduce(
            (s: number, p: any) => s + (p.salesKsh || 0),
            0,
          );
          // Dynamic fuel type pump sales from Sales Tracking
          const byType = Object.values(e.fuelPumpsByType || {}).reduce(
            (s: number, pumps: any) =>
              s +
              (Array.isArray(pumps)
                ? pumps.reduce(
                    (ps: number, p: any) => ps + (p.salesKsh || 0),
                    0,
                  )
                : 0),
            0,
          );
          // Include POS sales for today too
          const pos = e.posSales || {};
          const posByType = Object.values(pos.byTypeAmount || {}).reduce(
            (s: number, v: any) => s + (Number(v) || 0),
            0,
          );
          const posTotal =
            Object.keys(pos.byTypeAmount || {}).length > 0
              ? posByType
              : (pos.pmsAmount || 0) + (pos.agoAmount || 0);
          return pms + ago + byType + posTotal;
        })()
      : 0;

    return {
      totalRevenue: revenue,
      netProfit: profit,
      totalFuelSold: fuel,
      totalDebt: debt,
      totalExpenses: expenses,
      todaySales: tSales,
    };
  }, [state.salesHistory, state.deliveryData.totals]);

  // Animate KPI values on mount - use backend data if available, then local
  useEffect(() => {
    // Prefer backend stats over local calculation
    let targets = {
      revenue: 0,
      profit: 0,
      fuelSold: 0,
      debt: 0,
    };

    if (hasBackendData && backendStats) {
      targets = {
        revenue: backendStats.totalRevenue,
        profit: backendStats.netProfit,
        fuelSold: backendStats.fuelSold,
        debt: backendStats.balanceDue,
      };
    } else if (totalRevenue > 0 || totalFuelSold > 0) {
      targets = {
        revenue: totalRevenue,
        profit: netProfit,
        fuelSold: totalFuelSold,
        debt: totalDebt,
      };
    } else {
      // Production mode
      targets = {
        revenue: 0,
        profit: 0,
        fuelSold: 0,
        debt: 0,
      };
    }

    const duration = 1000;
    const steps = 30;
    const intervalMs = duration / steps;
    let step = 0;

    const animTimer = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setAnimatedValues({
        revenue: targets.revenue * eased,
        profit: targets.profit * eased,
        fuelSold: targets.fuelSold * eased,
        debt: targets.debt * eased,
      });
      if (step >= steps) clearInterval(animTimer);
    }, intervalMs);

    return () => clearInterval(animTimer);
  }, [
    hasBackendData,
    backendStats,
    totalRevenue,
    netProfit,
    totalFuelSold,
    totalDebt,
  ]);

  // Chart data - Sales over last 7 days
  const salesChartData = useMemo(() => {
    const days: string[] = [];
    // Collect ALL fuel types that appear in the sales history (dynamic,
    // not hardcoded to PMS/AGO). A station with Kerosene/LPG/V-Power gets
    // a line for each.
    const allFuelTypes = new Set<string>();
    Object.values(state.salesHistory).forEach((entry: any) => {
      if (entry.fuelPumpsByType) {
        Object.keys(entry.fuelPumpsByType).forEach((t) => {
          if (t) allFuelTypes.add(t);
        });
      }
      // Legacy entries store pmsPumps/agoPumps separately
      if (entry.pmsPumps?.length) allFuelTypes.add("petrol");
      if (entry.agoPumps?.length) allFuelTypes.add("diesel");
    });
    // If no history yet, fall back to the station's configured fuel types
    // (canonical fuel_types_config — `state.fuelTypes` is never populated).
    if (allFuelTypes.size === 0) {
      for (const ft of fuelTypeApi.activeFuelTypes) {
        const c = fuelTypeApi.canonicalOf(ft.name) || ft.code || "";
        if (c) allFuelTypes.add(c);
      }
    }
    if (allFuelTypes.size === 0) {
      allFuelTypes.add("petrol");
      allFuelTypes.add("diesel");
    }

    const seriesData: Record<string, number[]> = {};
    allFuelTypes.forEach((t) => (seriesData[t] = []));

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      days.push(
        d.toLocaleDateString(getLocaleForCountry(), { weekday: "short" }),
      );

      const dayTotals: Record<string, number> = {};
      allFuelTypes.forEach((t) => (dayTotals[t] = 0));

      Object.entries(state.salesHistory).forEach(
        ([key, entry]: [string, any]) => {
          if (key.startsWith(dateStr)) {
            // New format: fuelPumpsByType
            if (entry.fuelPumpsByType) {
              Object.entries(entry.fuelPumpsByType).forEach(
                ([type, pumps]: [string, any]) => {
                  if (!dayTotals[type]) dayTotals[type] = 0;
                  dayTotals[type] += (pumps || []).reduce(
                    (s: number, p: any) => s + (p.salesKsh || 0),
                    0,
                  );
                },
              );
            }
            // Legacy: pmsPumps/agoPumps
            const pmsRev = (entry.pmsPumps || []).reduce(
              (s: number, p: any) => s + (p.salesKsh || 0),
              0,
            );
            const agoRev = (entry.agoPumps || []).reduce(
              (s: number, p: any) => s + (p.salesKsh || 0),
              0,
            );
            if (pmsRev > 0)
              dayTotals["petrol"] = (dayTotals["petrol"] || 0) + pmsRev;
            if (agoRev > 0)
              dayTotals["diesel"] = (dayTotals["diesel"] || 0) + agoRev;
          }
        },
      );
      allFuelTypes.forEach((t) => seriesData[t].push(dayTotals[t] || 0));
    }

    const colors = [
      "rgb(34, 197, 94)",
      "rgb(234, 179, 8)",
      "rgb(99, 102, 241)",
      "rgb(236, 72, 153)",
      "rgb(20, 184, 166)",
      "rgb(249, 115, 22)",
      "rgb(139, 92, 246)",
    ];

    return {
      labels: days,
      datasets: Array.from(allFuelTypes).map((type, idx) => {
        const label =
          (CANONICAL_FUEL_TYPES as any)[type]?.label ||
          type.charAt(0).toUpperCase() + type.slice(1);
        const color = colors[idx % colors.length];
        const flatBg = color.replace("rgb", "rgba").replace(")", ", 0.1)");
        // Royal theme: gold gradient area fill (matches dashboard.html spec).
        // Chart.js calls the backgroundColor function at render time with the
        // chart context, so the gradient is created from the live canvas.
        const isRoyal =
          typeof document !== "undefined" &&
          document.documentElement.dataset.colorTheme === "royal";
        return {
          label,
          data: seriesData[type],
          borderColor: color,
          backgroundColor: (ctx: any) => {
            const chart = ctx?.chart;
            if (!isRoyal || !chart?.ctx || !chart.chartArea) return flatBg;
            const { top, bottom } = chart.chartArea;
            const g = chart.ctx.createLinearGradient(0, top, 0, bottom);
            g.addColorStop(0, "rgba(197,160,89,0.28)");
            g.addColorStop(1, "rgba(197,160,89,0)");
            return g;
          },
          fill: true,
          tension: 0.4,
          pointRadius: isRoyal ? 0 : 4,
          pointHoverRadius: isRoyal ? 5 : 6,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: isRoyal ? "#0a0e17" : "#fff",
          pointHoverBorderWidth: 2,
          borderWidth: isRoyal ? 2.5 : 2,
        };
      }),
    };
  }, [state.salesHistory, fuelTypeApi.activeFuelTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fuel type distribution
  const fuelDistData = useMemo(() => {
    const history = Object.values(state.salesHistory);
    const totals: Record<string, number> = {};

    history.forEach((entry: any) => {
      // New format: fuelPumpsByType
      if (entry.fuelPumpsByType) {
        Object.entries(entry.fuelPumpsByType).forEach(
          ([type, pumps]: [string, any]) => {
            if (!totals[type]) totals[type] = 0;
            totals[type] += (pumps || []).reduce(
              (s: number, p: any) => s + (p.salesL || 0),
              0,
            );
          },
        );
      }
      // Legacy: pmsPumps/agoPumps
      const pmsL = (entry.pmsPumps || []).reduce(
        (s: number, p: any) => s + (p.salesL || 0),
        0,
      );
      const agoL = (entry.agoPumps || []).reduce(
        (s: number, p: any) => s + (p.salesL || 0),
        0,
      );
      if (pmsL > 0) totals["petrol"] = (totals["petrol"] || 0) + pmsL;
      if (agoL > 0) totals["diesel"] = (totals["diesel"] || 0) + agoL;
    });

    const types = Object.keys(totals).filter((t) => totals[t] > 0);
    // If no data, show a default empty state
    if (types.length === 0) {
      return {
        labels: ["No sales data"],
        datasets: [
          {
            data: [1],
            backgroundColor: ["rgba(100, 116, 139, 0.4)"],
            borderColor: ["rgb(100, 116, 139)"],
            borderWidth: 2,
          },
        ],
      };
    }

    // Royal Professional theme: lead with gold (#c5a059) as the primary chart
    // color so the signature royal accent shows in the data viz.
    const isRoyal =
      typeof document !== "undefined" &&
      document.documentElement.dataset.colorTheme === "royal";
    const royalLead = "rgba(197, 160, 89, 0.9)"; // gold
    const royalBorder = "rgb(197, 160, 89)";
    const colors = isRoyal
      ? [
          royalLead,
          "rgba(74, 222, 128, 0.8)", // green
          "rgba(99, 102, 241, 0.8)", // indigo
          "rgba(236, 72, 153, 0.8)", // pink
          "rgba(20, 184, 166, 0.8)", // teal
          "rgba(249, 115, 22, 0.8)", // orange
          "rgba(139, 92, 246, 0.8)", // violet
        ]
      : [
          "rgba(34, 197, 94, 0.8)",
          "rgba(234, 179, 8, 0.8)",
          "rgba(99, 102, 241, 0.8)",
          "rgba(236, 72, 153, 0.8)",
          "rgba(20, 184, 166, 0.8)",
          "rgba(249, 115, 22, 0.8)",
          "rgba(139, 92, 246, 0.8)",
        ];
    const borderColors = isRoyal
      ? [
          royalBorder,
          "rgb(74, 222, 128)",
          "rgb(99, 102, 241)",
          "rgb(236, 72, 153)",
          "rgb(20, 184, 166)",
          "rgb(249, 115, 22)",
          "rgb(139, 92, 246)",
        ]
      : [
          "rgb(34, 197, 94)",
          "rgb(234, 179, 8)",
          "rgb(99, 102, 241)",
          "rgb(236, 72, 153)",
          "rgb(20, 184, 166)",
          "rgb(249, 115, 22)",
          "rgb(139, 92, 246)",
        ];

    return {
      labels: types.map(
        (t) =>
          (CANONICAL_FUEL_TYPES as any)[t]?.label ||
          t.charAt(0).toUpperCase() + t.slice(1),
      ),
      datasets: [
        {
          data: types.map((t) => totals[t]),
          backgroundColor: types.map((_, i) => colors[i % colors.length]),
          borderColor: types.map(
            (_, i) => borderColors[i % borderColors.length],
          ),
          borderWidth: 2,
        },
      ],
    };
  }, [state.salesHistory]);

  // Expense breakdown
  const expenseData = useMemo(() => {
    const expenseMap: Record<string, number> = {};
    Object.values(state.salesHistory).forEach((entry: any) => {
      (entry.expenses || []).forEach((e: any) => {
        const key = e.desc || "Other";
        expenseMap[key] = (expenseMap[key] || 0) + (e.amount || 0);
      });
    });
    const labels = Object.keys(expenseMap).slice(0, 6);
    const data = labels.map((l) => expenseMap[l]);
    if (labels.length === 0) {
      labels.push("No Data");
      data.push(0);
    }
    return {
      labels,
      datasets: [
        {
          label: `Amount (${currencySymbol})`,
          data,
          backgroundColor: [
            "rgba(59, 130, 246, 0.8)",
            "rgba(239, 68, 68, 0.8)",
            "rgba(16, 185, 129, 0.8)",
            "rgba(245, 158, 11, 0.8)",
            "rgba(139, 92, 246, 0.8)",
            "rgba(236, 72, 153, 0.8)",
          ],
          borderRadius: 6,
        },
      ],
    };
  }, [state.salesHistory, currencySymbol]);

  const isRoyalTheme =
    typeof document !== "undefined" &&
    document.documentElement.dataset.colorTheme === "royal";
  const royalGrid = isRoyalTheme ? "#1f2635" : null;
  const royalTooltip = isRoyalTheme
    ? {
        backgroundColor: "#141a2b",
        borderColor: "#252c3f",
        borderWidth: 1,
        titleColor: "#ffffff",
        bodyColor: "#cbd5e1",
        padding: 10,
        displayColors: false,
        titleFont: { weight: 600 as const },
      }
    : {};

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: isRoyalTheme
      ? { intersect: false, mode: "index" as const }
      : undefined,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: state.theme === "dark" ? "#cbd5e1" : "#374151",
          usePointStyle: true,
          padding: 16,
        },
      },
      tooltip: royalTooltip,
    },
    scales: {
      x: {
        grid: {
          color: royalGrid
            ? (royalGrid as any)
            : state.theme === "dark"
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.05)",
          display: isRoyalTheme ? false : undefined,
        },
        border: isRoyalTheme ? { display: false } : undefined,
        ticks: {
          color: state.theme === "dark" ? "#cbd5e1" : "#6b7280",
          font: isRoyalTheme ? { size: 11 } : undefined,
        },
      },
      y: {
        grid: {
          color: royalGrid
            ? (royalGrid as any)
            : state.theme === "dark"
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.05)",
        },
        border: isRoyalTheme ? { display: false } : undefined,
        ticks: {
          color: state.theme === "dark" ? "#cbd5e1" : "#6b7280",
          font: isRoyalTheme ? { size: 11 } : undefined,
        },
      },
    },
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: state.theme === "dark" ? "#cbd5e1" : "#374151",
          usePointStyle: true,
          padding: 16,
        },
      },
      tooltip: royalTooltip,
    },
    cutout: "60%",
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: royalTooltip,
    },
    scales: {
      x: {
        grid: { display: false },
        border: isRoyalTheme ? { display: false } : undefined,
        ticks: {
          color: state.theme === "dark" ? "#cbd5e1" : "#6b7280",
          font: isRoyalTheme ? { size: 10.5 } : undefined,
        },
      },
      y: {
        grid: {
          color: royalGrid
            ? (royalGrid as any)
            : state.theme === "dark"
              ? "rgba(255,255,255,0.05)"
              : "rgba(0,0,0,0.05)",
        },
        border: isRoyalTheme ? { display: false } : undefined,
        ticks: {
          color: state.theme === "dark" ? "#cbd5e1" : "#6b7280",
          font: isRoyalTheme ? { size: 10.5 } : undefined,
        },
      },
    },
  };

  // Unified dark-surface quick-action tiles (reference: single accent system).
  // Each tile uses the standard card surface; only the ICON carries a semantic
  // color — no more competing full-bleed rainbow backgrounds.
  const quickActions = [
    {
      label: "Point of Sale",
      icon: ShoppingCart,
      tab: "pos",
      iconColor: "text-amber-400",
      desc: "Quick fuel sale",
    },
    {
      label: "Sales Tracking",
      icon: BarChart3,
      tab: "sales",
      iconColor: "text-emerald-400",
      desc: "Record pump readings",
    },
    {
      label: "Delivery",
      icon: Fuel,
      tab: "delivery",
      iconColor: "text-amber-400",
      desc: "Track deliveries",
    },
    {
      label: "Invoice",
      icon: Receipt,
      tab: "invoice",
      iconColor: "text-sky-400",
      desc: "Create invoice",
    },
    {
      label: "M-PESA",
      icon: CreditCard,
      tab: "mpesa",
      iconColor: "text-emerald-400",
      desc: "Analyze payments",
    },
    {
      label: "Reports",
      icon: Activity,
      tab: "reports",
      iconColor: "text-rose-400",
      desc: "View reports",
    },
    {
      label: "Credit",
      icon: Wallet,
      tab: "credit",
      iconColor: "text-amber-400",
      desc: "Customer credit & debt reminders",
    },
    {
      label: "STK Push",
      icon: Smartphone,
      tab: "livetransaction",
      iconColor: "text-emerald-400",
      desc: "Collect M-PESA payment",
      payload: { openStkPush: true } as Partial<StkPushPrefill>,
    },
    {
      label: "Expenses",
      icon: Receipt,
      tab: "expenses",
      iconColor: "text-rose-400",
      desc: "Record an expense",
    },
    {
      label: "Suppliers",
      icon: Truck,
      tab: "suppliers",
      iconColor: "text-sky-400",
      desc: "Purchases & suppliers",
    },
    {
      label: "Integration Hub",
      icon: Plug,
      tab: "integration",
      iconColor: "text-emerald-400",
      desc: "M-PESA / Kopo Kopo setup",
    },
    {
      label: "Payroll",
      icon: Users,
      tab: "payroll",
      iconColor: "text-amber-400",
      desc: "Employee payroll",
    },
  ];

  const switchToTab = (tabId: string) => {
    window.dispatchEvent(new CustomEvent("changeTab", { detail: tabId }));
  };

  const handlePrintSummary = () => {
    const fuelTypeApi2 = fuelTypeApi;
    const printWin = window.open("", "_blank", "width=800,height=600");
    if (!printWin) return;
    const companyName = state.companyData?.name || "Fuel Station";
    const dateStr = new Date().toLocaleDateString();
    const timeStr = new Date().toLocaleTimeString();
    const cur = currencySymbolFor(stationCountry);
    const fuels = fuelTypeApi2.activeFuelTypes
      .map(
        (ft: any) =>
          `<tr><td>${ft.localName || ft.canonicalType || "—"}</td><td style="text-align:right">${cur}${formatNumber(ft.price || 0)}</td><td style="text-align:right">${ft.pumpCount || 0}</td></tr>`,
      )
      .join("");
    printWin.document
      .write(`<!DOCTYPE html><html><head><title>${companyName} — Dashboard Summary</title>
    <style>
      body{font-family:Arial,sans-serif;margin:40px;color:#1a1a1a}
      h1{font-size:24px;border-bottom:2px solid #d4af37;padding-bottom:8px}
      h2{font-size:16px;margin-top:24px;color:#555}
      table{width:100%;border-collapse:collapse;margin-top:8px}
      th,td{padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:left;font-size:14px}
      th{background:#f8f8f8;font-weight:600}
      .stat{display:inline-block;margin-right:32px}
      .stat .label{font-size:12px;color:#888;text-transform:uppercase}
      .stat .value{font-size:22px;font-weight:700}
      .footer{margin-top:40px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:8px}
    </style></head><body>
    <h1>${companyName}</h1>
    <h2>Dashboard Summary — ${dateStr} ${timeStr}</h2>
    <div style="margin-top:16px">
      <div class="stat"><div class="label">Total Revenue</div><div class="value">${cur}${formatNumber(totalRevenue || 0)}</div></div>
      <div class="stat"><div class="label">Net Profit</div><div class="value">${cur}${formatNumber(netProfit || 0)}</div></div>
      <div class="stat"><div class="label">Total Fuel Sold</div><div class="value">${formatNumber(totalFuelSold || 0)} L</div></div>
      <div class="stat"><div class="label">Total Debt</div><div class="value">${cur}${formatNumber(totalDebt || 0)}</div></div>
    </div>
    <h2>Fuel Types & Prices</h2>
    <table><thead><tr><th>Fuel Type</th><th style="text-align:right">Price/L</th><th style="text-align:right">Pumps</th></tr></thead><tbody>${fuels}</tbody></table>
    <div class="footer">Generated by FuelPro — ${dateStr} ${timeStr}</div>
    </body></html>`);
    printWin.document.close();
    printWin.focus();
    setTimeout(() => printWin.print(), 300);
  };

  const launchAction = (action: (typeof quickActions)[number]) => {
    if (action.payload) {
      navigateToTab(action.tab, action.payload);
    } else {
      switchToTab(action.tab);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-white">
            {state.companyData.name || "Dashboard"}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400 mt-1">
            Welcome back! Here's your business overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SyncStatusIndicator countryCode={stationCountry} compact />
          {backendLoading && (
            <span className="text-xs text-blue-500 animate-pulse hidden sm:inline">
              syncing stats…
            </span>
          )}
          <button
            onClick={handlePrintSummary}
            className="fp-btn-secondary hidden sm:inline-flex"
            title="Print dashboard summary"
          >
            <Printer size={16} />
            <span className="hidden lg:inline">Print Summary</span>
          </button>
          <div className="hidden sm:flex items-center gap-3 bg-bg-card border border-edge-light rounded-md px-4 py-2.5">
            <Clock size={18} className="text-gold" />
            <span className="text-sm font-mono text-stat-primary">
              {currentTime.toLocaleString(stationLocale, {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards — calm financial-grade cards (reference rule 5):
          dark surface, white values, small colored icon chip + trend badge.
          Replaces the competing multi-color gradient cards.
          Fixed 2×2 grid on mobile (was grid-cols-1 → single stretched
          column inflating vertical space + breaking the 9:20 layout). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="fp-kpi">
          <div className="fp-kpi-top">
            <div className="fp-kpi-icon gold">
              <DollarSign size={16} />
            </div>
            {todaySales > 0 ? (
              <span className="fp-kpi-badge positive">▲ today</span>
            ) : null}
          </div>
          <div className="fp-kpi-value">
            {currencySymbol} {formatNumber(animatedValues.revenue, 0)}
          </div>
          <div className="fp-kpi-label">Total Revenue</div>
          <div className="fp-kpi-foot">
            {todaySales > 0
              ? `${currencySymbol} ${formatNumber(todaySales)} today`
              : "No sales today"}
          </div>
        </div>

        <div className="fp-kpi">
          <div className="fp-kpi-top">
            <div
              className={`fp-kpi-icon ${netProfit >= 0 ? "positive" : "warning"}`}
            >
              {netProfit >= 0 ? (
                <TrendingUp size={16} />
              ) : (
                <TrendingDown size={16} />
              )}
            </div>
            <span
              className={`fp-kpi-badge ${netProfit >= 0 ? "positive" : "warning"}`}
            >
              {netProfit >= 0 ? "▲ profit" : "▼ loss"}
            </span>
          </div>
          <div className="fp-kpi-value">
            {currencySymbol} {formatNumber(animatedValues.profit, 0)}
          </div>
          <div className="fp-kpi-label">Net Profit</div>
          <div className="fp-kpi-foot">
            {totalExpenses > 0
              ? `${currencySymbol} ${formatNumber(totalExpenses)} expenses`
              : "No expenses recorded"}
          </div>
        </div>

        <div className="fp-kpi">
          <div className="fp-kpi-top">
            <div className="fp-kpi-icon info">
              <Droplets size={16} />
            </div>
          </div>
          <div className="fp-kpi-value">
            {formatNumber(animatedValues.fuelSold, 0)}{" "}
            <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
              L
            </span>
          </div>
          <div className="fp-kpi-label">Fuel Sold</div>
          <div className="fp-kpi-foot">
            {priceCards.map((c) => c.label).join(" · ") || "—"}
          </div>
        </div>

        <div className="fp-kpi">
          <div className="fp-kpi-top">
            <div
              className={`fp-kpi-icon ${totalDebt > 0 ? "warning" : "positive"}`}
            >
              {totalDebt > 0 ? (
                <AlertTriangle size={16} />
              ) : (
                <Wallet size={16} />
              )}
            </div>
            {totalDebt > 0 ? (
              <span className="fp-kpi-badge warning">due</span>
            ) : null}
          </div>
          <div className="fp-kpi-value">
            {currencySymbol} {formatNumber(animatedValues.debt, 0)}
          </div>
          <div className="fp-kpi-label">Balance Due</div>
          <div className="fp-kpi-foot">
            {Object.keys(state.clients).length} client(s)
          </div>
        </div>
      </div>

      {/* Auto-Synced Fuel Prices + Tax Info + Regulatory Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Current Pump Prices */}
        <div
          className={`rounded-xl p-3 border shadow-sm ${effectiveFuelPrice ? "bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700" : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"}`}
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Globe
                size={14}
                className={
                  isSyncing ? "text-amber-500 animate-pulse" : "text-amber-500"
                }
              />
              Current Pump Prices
            </h3>
            <span className="text-[9px] bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full font-medium">
              {effectiveFuelPrice?.priceSettingBody ||
                stationCountryProfile.fuelRegulations.priceSettingBody}
            </span>
          </div>
          {/* Location-based price indicator */}
          <div className="mb-2 flex items-center gap-2">
            {currentLocation?.latitude != null &&
              currentLocation?.longitude != null && (
                <span className="text-[10px] text-gray-600 dark:text-gray-400">
                  📍 {currentLocation.latitude.toFixed(4)},{" "}
                  {currentLocation.longitude.toFixed(4)}
                </span>
              )}
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${isLocationBased ? "bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300" : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-500 dark:text-gray-400"}`}
            >
              {isLocationBased
                ? `📍 GPS: ${priceCityName} (${(Number(locationPrice?.transportSurcharge) || 0) >= 0 ? "+" : ""}${(Number(locationPrice?.transportSurcharge) || 0).toFixed(2)})`
                : regionalPrice.isRegional
                  ? `${stationCountryProfile.fuelRegulations.priceSettingBody} ${regionalPrice.cityName} Price`
                  : `${stationCity} - National Average`}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {priceCards.map((card) => {
              const swatch =
                card.key === "petrol" || card.key === "Super Petrol"
                  ? "#4ade80"
                  : card.key === "diesel" || card.key === "Diesel"
                    ? "#c5a059"
                    : card.key === "kerosene" || card.key === "Kerosene"
                      ? "#7dd3fc"
                      : "#94a3b8";
              return (
                <div key={card.key} className="fp-price-card">
                  <div className="fp-price-label">
                    <span
                      className="fp-price-swatch"
                      style={{ background: swatch }}
                    />
                    {card.label}
                  </div>
                  <div className="fp-price-value">
                    {currencySymbol} {(card.price ?? 0).toFixed(2)}
                  </div>
                  <div className="fp-price-unit">per litre</div>
                  {isLocationBased ? (
                    <div className="fp-price-unit">{priceCityName}</div>
                  ) : regionalPrice.isRegional ? (
                    <div className="fp-price-unit">
                      {regionalPrice.cityName}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {/* Fuel price interlinks — jump to the editor/finder/price-board so
              a price change here is reflected everywhere, and vice-versa. */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button
              onClick={() =>
                navigateToTab("fueltypes", {
                  fuelType: CANONICAL_FUEL_TYPES.petrol.label,
                  price: displayPmsPrice,
                } as FuelPricePrefill)
              }
              className="text-[9px] px-2 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800"
              title="Edit fuel types & prices in Fuel Type Manager"
            >
              Edit Prices
            </button>
            <button
              onClick={() =>
                navigateToTab("fueltypes", {
                  view: "priceboard",
                } as FuelPricePrefill)
              }
              className="text-[9px] px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200"
              title="Open Price Board"
            >
              Price Board
            </button>
            <button
              onClick={() => navigateToTab("price-finder")}
              className="text-[9px] px-2 py-1 rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 hover:bg-teal-200"
              title="Find nearby market fuel prices"
            >
              Find Prices
            </button>
          </div>
          {effectiveFuelPrice?.breakdown && (
            <div className="mt-3 pt-3 border-t border-blue-200/50 dark:border-blue-800/30">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] text-gray-500">Landed Cost</p>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {currencySymbol}{" "}
                    {effectiveFuelPrice.breakdown.landedCost.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-gray-500">Taxes</p>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {currencySymbol}{" "}
                    {effectiveFuelPrice.breakdown.taxes.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-gray-500">Margins</p>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {currencySymbol}{" "}
                    {effectiveFuelPrice.breakdown.margins.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mt-3">
            {effectiveFuelPrice ? (
              <p className="text-[9px] text-gray-500 dark:text-gray-500">
                Source:{" "}
                <a
                  href={effectiveFuelPrice.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {effectiveFuelPrice.sourceName}
                </a>
                {isSyncing && (
                  <span className="ml-1 text-blue-400 animate-pulse">
                    syncing...
                  </span>
                )}
              </p>
            ) : (
              <button
                onClick={syncNow}
                className="text-[9px] text-blue-500 hover:underline flex items-center gap-1"
              >
                <Zap size={8} /> Click to sync latest prices
              </button>
            )}
            <p className="text-[9px] text-gray-500 dark:text-gray-400">
              {effectiveFuelPrice
                ? new Date(effectiveFuelPrice.lastUpdated).toLocaleDateString()
                : "Not synced"}
            </p>
          </div>
        </div>

        {/* Tax Rates Summary */}
        <div className="bg-white dark:bg-gray-800/50 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <FileText size={14} className="text-amber-500" />
            Tax & Statutory Rates
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                VAT Rate
              </span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {(taxRates || location.revenueAuthority).vatRate}%
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                {(taxRates || location.payrollConfig).nssfLabel} (Employee)
              </span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {(
                  (taxRates || location.payrollConfig).nssfEmployeeRate * 100
                ).toFixed(0)}
                %
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                {(taxRates || location.payrollConfig).nssfLabel} (Employer)
              </span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {(
                  (taxRates || location.payrollConfig).nssfEmployerRate * 100
                ).toFixed(0)}
                %
              </span>
            </div>
            {(taxRates?.housingLevyApplicable ??
              location.payrollConfig.housingLevy) && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                  Housing Levy
                </span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {(
                    (taxRates?.housingLevyRate ??
                      location.payrollConfig.housingLevyRate) * 100
                  ).toFixed(1)}
                  %
                </span>
              </div>
            )}
            {(() => {
              const exciseDuty = taxRates
                ? taxRates.exciseDutyPerLiter
                : location.revenueAuthority.exciseDuty;
              return exciseDuty > 0 ? (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                    Excise Duty/L
                  </span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {currencySymbol} {exciseDuty.toFixed(2)}
                  </span>
                </div>
              ) : null;
            })()}
            <div className="flex justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-500 dark:text-gray-400">
                Min. Wage (monthly)
              </span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {currencySymbol}{" "}
                {(
                  taxRates || location.payrollConfig
                ).minimumWage.toLocaleString(stationLocale)}
              </span>
            </div>
          </div>
          <p className="text-[9px] text-gray-500 dark:text-gray-400 mt-3 text-right">
            {taxRates
              ? `Last updated: ${new Date(taxRates.lastUpdated).toLocaleDateString()}`
              : "Using default rates - click sync to update"}
          </p>
        </div>

        {/* Weather Widget */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
          <WeatherWidget />
        </div>

        {/* Regulatory Alerts */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
          <RegulatoryAlerts countryCode={stationCountry} />
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Sales Trend */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 dark:text-white flex items-center gap-2">
              <BarChart3 size={18} className="text-amber-500" />
              Sales Trend (Last 7 Days)
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
              {currencySymbol}
            </span>
          </div>
          <div className="h-64">
            <Line data={salesChartData} options={chartOptions} />
          </div>
        </div>

        {/* Fuel Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <Droplets size={18} className="text-green-500" />
            Fuel Distribution
          </h3>
          <div className="h-48">
            <Doughnut data={fuelDistData} options={doughnutOptions} />
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
            {priceCards.map((card) => (
              <div
                key={card.key}
                className="rounded-lg p-2 bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-700"
              >
                <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                  {card.label} Price
                </p>
                <p className={`font-semibold ${card.color}`}>
                  {currencySymbol} {card.price ?? 0}/L
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Second Charts Row + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Expense Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <Activity size={18} className="text-rose-500" />
            Expense Breakdown
          </h3>
          <div className="h-48">
            <Bar data={expenseData} options={barOptions} />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-2 flex items-center gap-2">
            <ShoppingCart size={18} className="text-amber-500" />
            Quick Actions
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => launchAction(action)}
                className="fp-quick-action group"
              >
                <action.icon
                  size={22}
                  className={`${action.iconColor} mb-2 transition-transform group-hover:scale-110`}
                />
                <p className="font-semibold text-sm text-gray-900 dark:text-white">
                  {action.label}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {action.desc}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tank Levels — dynamic per fuel type (was hardcoded to only
          Super Petrol Tank + Diesel Tank). */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <Fuel size={18} className="text-amber-500" />
          Tank Levels
        </h3>
        <div
          className={`grid gap-3 ${tankLevelCards.length > 2 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"}`}
        >
          {tankLevelCards.map((card) => {
            const dispensed = card.closing - card.opening;
            const fillPct = tankFillPercent(card.opening, card.closing);
            const fillColor =
              fillPct < 20
                ? "bg-red-500"
                : fillPct < 50
                  ? "bg-yellow-500"
                  : "bg-green-500";
            const statusLabel =
              fillPct < 20 ? "LOW" : fillPct < 50 ? "MEDIUM" : "OK";
            const statusColor =
              fillPct < 20
                ? "text-red-600 dark:text-red-400"
                : fillPct < 50
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-green-600 dark:text-green-400";
            return (
              <div key={card.key}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {card.label} Tank
                  </span>
                  <span className={`text-xs font-bold ${statusColor}`}>
                    {statusLabel} · {fillPct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${fillColor} rounded-full transition-all duration-500`}
                    style={{
                      width: `${fillPct}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                  <span>Opening: {formatNumber(card.opening)} L</span>
                  <span>{formatNumber(dispensed, 0)} L dispensed</span>
                  <span>Closing: {formatNumber(card.closing)} L</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Pumps Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-900 dark:text-white mb-2 flex items-center gap-2">
          <Activity size={18} className="text-purple-500" />
          Pump Status
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {pumpStatusCards.map((card) => (
            <div
              key={card.key}
              className={`text-center p-3 ${card.bg} rounded-lg`}
            >
              <p className={`text-2xl font-bold ${card.text}`}>{card.count}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
                {card.label} Pumps
              </p>
            </div>
          ))}
          <div className="text-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
              {Object.keys(state.invoices).length}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
              Invoices
            </p>
          </div>
          <div className="text-center p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
              {state.employees.length}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
              Employees
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
