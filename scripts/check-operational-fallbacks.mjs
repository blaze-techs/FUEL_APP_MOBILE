import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const rules = [
  {
    file: "src/react-app/context/FuelContext.tsx",
    forbidden: [
      /KENYA_BASE_PRICES/,
      /getCountryPrice/,
      /DEFAULT_PMS_PRICE/,
      /DEFAULTAGO_PRICE/,
    ],
    reason: "FuelContext must not initialize operational prices from reference/default tables.",
  },
  {
    file: "src/react-app/hooks/useStationFuelTypes.ts",
    forbidden: [
      /getBasePrice/,
      /getCountryPrice/,
      /REGIONAL_PRICES/,
      /getWorldFuelPrices/,
      /fallbackToStatic/,
    ],
    reason: "Station fuel prices must be station-scoped only.",
  },
  {
    file: "src/react-app/hooks/useFuelPrices.ts",
    forbidden: [
      /KENYA_BASE_PRICES/,
      /KENYA_SPECIALTY_PRICES/,
      /REGIONAL_PRICES/,
      /getClosestKenyaCityPrice/,
      /getWorldFuelPrices/,
      /getBasePrice/,
    ],
    reason: "Unified operational prices must not synthesize reference/market fallbacks.",
  },
  {
    file: "src/react-app/components/PriceBoard.tsx",
    forbidden: [
      /function loadPrices/,
      /function loadHistory/,
      /fuelType:\s*CANONICAL_FUEL_TYPES\.petrol\.label/,
      /return Object\.keys\(FUEL_GRADES\)/,
    ],
    reason: "PriceBoard must not fabricate local/default price records or fuel options.",
  },
  {
    file: "src/react-app/components/PriceScheduler.tsx",
    forbidden: [
      /return uniq\.length > 0 \? uniq : \["Super Petrol", "Diesel"\]/,
      /useStationFuelTypes\(\)/,
    ],
    reason: "Schedules must target real station-configured fuels.",
  },
  {
    file: "src/react-app/components/FuelPriceLocator.tsx",
    forbidden: [
      /Fallback: use the unified pricing system/,
      /getClosestKenyaCityPrice/,
      /getWorldFuelPrices/,
    ],
    reason: "Nearby-price lookup must not replace missing live data with static estimates.",
  },
  {
    file: "src/react-app/components/FuelTracker.tsx",
    forbidden: [
      /Showing regional fallback prices/,
      /useFuelPrices/,
    ],
    reason: "GPS price lookup must show unknown when verified data is unavailable.",
  },
  {
    file: "src/react-app/services/FuelPriceService.ts",
    forbidden: [
      /REGIONAL_PRICES/,
      /getWorldFuelPrices/,
      /KENYA_BASE_PRICES/,
      /Fallback Prices/,
      /static baseline/,
    ],
    reason: "Live price service must reject missing data instead of synthesizing a price.",
  },
];

const failures = [];
for (const rule of rules) {
  const path = resolve(root, rule.file);
  const text = readFileSync(path, "utf8");
  for (const pattern of rule.forbidden) {
    if (pattern.test(text)) {
      failures.push(`${rule.file}: ${pattern} — ${rule.reason}`);
    }
  }
}

if (failures.length) {
  console.error("Operational fallback integrity check FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Operational fallback integrity check passed.");
