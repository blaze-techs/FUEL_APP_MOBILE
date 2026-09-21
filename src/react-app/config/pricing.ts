/**
 * Resolve a reference/baseline price. This helper is NOT an operational
 * station-price source. UI/business logic must use station-scoped configured
 * data for pump prices. A missing reference returns 0.
 */
export function getBasePrice(fuelType: string, countryCode?: string): number {
  if (countryCode && countryCode !== "KE") {
    const cp = getCountryPrice(countryCode, fuelType);
    if (cp && typeof cp.price === "number" && cp.price > 0) return cp.price;
    // A non-Kenya lookup that has no verified/reference price is unknown.
    // Never cross-fallback into Kenya's KSh baseline.
    return 0;
  }
  const canonical = normalizeFuelType(fuelType);
  switch (canonical) {
    case "petrol":
      return KENYA_BASE_PRICES.petrol;
    case "diesel":
      return KENYA_BASE_PRICES.diesel;
    case "kerosene":
      return KENYA_BASE_PRICES.kerosene;
    case "vpower":
      return KENYA_SPECIALTY_PRICES.vPower;
    case "premium_diesel":
      return KENYA_SPECIALTY_PRICES.premiumDiesel;
    case "lpg":
      return KENYA_SPECIALTY_PRICES.lpg;
    case "cng":
      return KENYA_SPECIALTY_PRICES.cng;
    default: {
      const type =
        FUEL_TYPES[fuelType as keyof typeof FUEL_TYPES] ||
        fuelType.toLowerCase();
      switch (type) {
        case "petrol":
        case "pms":
          return KENYA_BASE_PRICES.petrol;
        case "diesel":
        case "ago":
          return KENYA_BASE_PRICES.diesel;
        case "kerosene":
        case "ik":
          return KENYA_BASE_PRICES.kerosene;
        case "vpower":
          return KENYA_SPECIALTY_PRICES.vPower;
        case "premiumdiesel":
          return KENYA_SPECIALTY_PRICES.premiumDiesel;
        case "lpg":
          return KENYA_SPECIALTY_PRICES.lpg;
        case "cng":
          return KENYA_SPECIALTY_PRICES.cng;
        default:
          return 0;
      }
    }
  }
}

/**
 * Get price for a specific country
 */
export function getCountryPrice(
  countryCode: string,
  fuelType: string,
): { price: number; currency: string; symbol: string } {
  if (countryCode === "KE") {
    return {
      price: getBasePrice(fuelType),
      currency: "KES",
      symbol: "KSh",
    };
  }

  const regional = REGIONAL_PRICES[countryCode];
  if (regional) {
    const canonical = normalizeFuelType(fuelType);
    let price = regional.petrol;

    switch (canonical) {
      case "diesel":
        price = regional.diesel;
        break;
      case "kerosene":
        price = regional.kerosene;
        break;
    }

    return {
      price,
      currency: regional.currency,
      symbol: regional.currencySymbol,
    };
  }

  // WORLD-WIDE: any country not in REGIONAL_PRICES (US, DE, IN, BR, JP, …)
  // gets a price derived from the USD baseline × its own currency exchange
  // rate — NEVER Kenya's KSh fallback.
  const world = getWorldFuelPrices()[countryCode.toUpperCase()];
  if (world) {
    const canonical = normalizeFuelType(fuelType);
    let price = world.petrol;
    switch (canonical) {
      case "diesel":
        price = world.diesel;
        break;
      case "kerosene":
        price = world.kerosene;
        break;
    }
    return {
      price,
      currency: world.currency,
      symbol: world.currencySymbol,
    };
  }

  // Unknown country/fuel data is genuinely unavailable. Returning zero here
  // is a sentinel for "no reference price"; operational station prices must
  // never consume this value as a real pump price.
  return {
    price: 0,
    currency: "",
    symbol: "",
  };
}

/**
 * Get price for a specific Kenya city
 */
export function getKenyaCityPrice(
  cityName: string,
): KenyaCityPrice | undefined {
  return KENYA_CITIES.find(
    (city) => city.name.toLowerCase() === cityName.toLowerCase(),
  );
}

/**
 * Get the closest Kenya city price based on GPS coordinates
 */
export function getClosestKenyaCityPrice(
  lat: number,
  lng: number,
): KenyaCityPrice {
  let closest = KENYA_CITIES[0];
  let minDistance = Infinity;

  for (const city of KENYA_CITIES) {
    const distance = Math.sqrt(
      Math.pow(lat - city.lat, 2) + Math.pow(lng - city.lng, 2),
    );
    if (distance < minDistance) {
      minDistance = distance;
      closest = city;
    }
  }

  return closest;
}
