/**
 * Pump price integrity checks.
 *
 * Important: this module never silently "fixes" a price. It identifies an
 * incorrect/suspicious price only when there is deterministic evidence:
 *  1) the station has an explicitly configured price for the same fuel type,
 *  2) the same fuel type has conflicting pump prices in one extracted shift,
 *  3) the recorded sales value does not mathematically agree with litres ×
 *     recorded unit price, or
 *  4) the unit price is missing/non-finite/non-positive.
 *
 * The regulator/static baseline is deliberately NOT used as an operational
 * truth. A station can legitimately sell at a different price.
 */

export interface PumpPriceCheckInput {
  pump_id: string;
  fuel_type?: string;
  fuel_name?: string;
  total_sales_litres?: number;
  total_sales_value?: number;
  unit_price?: number;
}

export interface PumpPriceIssue {
  code:
    | "missing_or_invalid_price"
    | "configured_price_mismatch"
    | "same_fuel_price_conflict"
    | "sales_value_price_mismatch";
  severity: "error" | "warning";
  pumpId: string;
  fuelType: string;
  observedPrice: number | null;
  expectedPrice?: number;
  difference?: number;
  message: string;
}

export interface PumpPriceIntegrityResult {
  valid: boolean;
  checkedPumps: number;
  incorrectPumps: number;
  issues: PumpPriceIssue[];
  anomalies: string[];
  warnings: string[];
}

function canonicalFuel(raw: string | undefined): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/premium motor spirit|super petrol|gasoline|unleaded petrol|\bpms\b/g, "petrol")
    .replace(/automotive gas oil|gas oil|\bago\b/g, "diesel")
    .replace(/illuminating kerosene|paraffin|\biko\b/g, "kerosene")
    .replace(/\s+/g, " ");
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function moneyDiff(a: number, b: number): number {
  return Math.round((a - b) * 100) / 100;
}

/**
 * Compare extracted pump prices against station-configured prices and the
 * arithmetic implied by the extracted sales value.
 */
export function analyzePumpPriceIntegrity(
  pumps: PumpPriceCheckInput[],
  configuredPrices: Map<string, number> = new Map(),
  tolerance = 0.01,
): PumpPriceIntegrityResult {
  const issues: PumpPriceIssue[] = [];
  const byFuel = new Map<string, PumpPriceCheckInput[]>();

  for (const pump of pumps || []) {
    const pumpId = String(pump.pump_id || "UNKNOWN");
    const fuelType = String(pump.fuel_name || pump.fuel_type || "Unknown");
    const key = canonicalFuel(pump.fuel_name || pump.fuel_type);

    if (!byFuel.has(key)) byFuel.set(key, []);
    byFuel.get(key)!.push(pump);

    if (!finitePositive(pump.unit_price)) {
      issues.push({
        code: "missing_or_invalid_price",
        severity: "error",
        pumpId,
        fuelType,
        observedPrice:
          typeof pump.unit_price === "number" && Number.isFinite(pump.unit_price)
            ? pump.unit_price
            : null,
        message: `Pump ${pumpId} (${fuelType}) has no valid positive unit price.`,
      });
      continue;
    }

    const configured = configuredPrices.get(key);
    if (finitePositive(configured) && Math.abs(pump.unit_price - configured) > tolerance) {
      const difference = moneyDiff(pump.unit_price - configured, 0);
      issues.push({
        code: "configured_price_mismatch",
        severity: "error",
        pumpId,
        fuelType,
        observedPrice: pump.unit_price,
        expectedPrice: configured,
        difference,
        message:
          `Pump ${pumpId} (${fuelType}) is priced at ${pump.unit_price.toFixed(2)}, ` +
          `but the station-configured price is ${configured.toFixed(2)} ` +
          `(difference ${difference >= 0 ? "+" : ""}${difference.toFixed(2)}).`,
      });
    }

    const litres = pump.total_sales_litres;
    const value = pump.total_sales_value;
    if (finitePositive(litres) && typeof value === "number" && Number.isFinite(value)) {
      const impliedValue = litres * pump.unit_price;
      const arithmeticTolerance = Math.max(0.05, Math.abs(impliedValue) * 0.0005);
      if (Math.abs(impliedValue - value) > arithmeticTolerance) {
        const impliedPrice = value / litres;
        issues.push({
          code: "sales_value_price_mismatch",
          severity: "error",
          pumpId,
          fuelType,
          observedPrice: pump.unit_price,
          expectedPrice: impliedPrice,
          difference: moneyDiff(pump.unit_price - impliedPrice, 0),
          message:
            `Pump ${pumpId} (${fuelType}) has ${litres.toFixed(2)} L × ` +
            `${pump.unit_price.toFixed(2)} = ${impliedValue.toFixed(2)}, ` +
            `but the recorded sales value is ${value.toFixed(2)}. ` +
            `The value implies a unit price of ${impliedPrice.toFixed(2)}.`,
        });
      }
    }
  }

  // When no station price is configured, two or more pumps of the same fuel
  // provide a strong internal consistency check. This catches OCR/extraction
  // mistakes without imposing a regulator price on the station.
  for (const [key, group] of byFuel) {
    const priced = group.filter((p) => finitePositive(p.unit_price));
    if (priced.length < 2) continue;
    const baseline = priced[0].unit_price!;
    for (const pump of priced.slice(1)) {
      const observed = pump.unit_price!;
      if (Math.abs(observed - baseline) > tolerance) {
        const fuelType = String(pump.fuel_name || pump.fuel_type || key || "Unknown");
        issues.push({
          code: "same_fuel_price_conflict",
          severity: "warning",
          pumpId: String(pump.pump_id || "UNKNOWN"),
          fuelType,
          observedPrice: observed,
          expectedPrice: baseline,
          difference: moneyDiff(observed - baseline, 0),
          message:
            `Pump ${pump.pump_id || "UNKNOWN"} (${fuelType}) is ${observed.toFixed(2)}, ` +
            `while another extracted ${fuelType} pump is ${baseline.toFixed(2)}. ` +
            `Verify whether the difference is intentional or an extraction error.`,
        });
      }
    }
  }

  const incorrectPumps = new Set(
    issues.filter((i) => i.severity === "error").map((i) => i.pumpId),
  ).size;

  return {
    valid: issues.every((i) => i.severity !== "error"),
    checkedPumps: pumps.length,
    incorrectPumps,
    issues,
    anomalies: issues
      .filter((i) => i.severity === "error")
      .map((i) => i.message),
    warnings: issues
      .filter((i) => i.severity === "warning")
      .map((i) => i.message),
  };
}
