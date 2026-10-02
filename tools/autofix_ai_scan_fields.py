from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
if '[ai-scan-fields-autofix]' in subprocess.check_output(['git','log','-1','--pretty=%B'], cwd=ROOT, text=True):
    raise SystemExit(0)

parser = ROOT / 'src/react-app/lib/sales-scan-parser.ts'
s = parser.read_text()
old = '''  otherDetails: Array<{ label: string; value: number }>;
  confidence: "high" | "medium" | "low";
'''
new = '''  otherDetails: Array<{ label: string; value: number }>;
  tankReadings: Array<{ fuelType: string; opening: number; closing: number }>;
  pricesByFuelType: Record<string, number>;
  confidence: "high" | "medium" | "low";
'''
if old not in s: raise SystemExit('parser interface block not found')
s = s.replace(old, new, 1)
old = '''  const otherDetails: Array<{ label: string; value: number }> = [];
  const lines = text
'''
new = '''  const otherDetails: Array<{ label: string; value: number }> = [];
  const tankByFuel: Record<string, { opening?: number; closing?: number }> = {};
  const pricesByFuelType: Record<string, number> = {};
  const lines = text
'''
if old not in s: raise SystemExit('parser state block not found')
s = s.replace(old, new, 1)
old = '''  // First handle explicit pump IDs. Support either:
'''
new = '''  // Extract explicitly labelled tank opening/closing readings and fuel prices.
  // These values are only accepted when the sheet itself labels the fuel and
  // the semantic field (tank/opening/closing/price/rate). No row-order guesses.
  for (const line of lines) {
    const fuelWord = line.match(
      /\\b(petrol|pms|diesel|ago|kerosene|ik|lpg|v[- ]?power|premium\\s+diesel|cng)\\b/i,
    )?.[1];
    if (!fuelWord) continue;
    const fuelType = normalizeFuelType(fuelWord) || fuelWord.toLowerCase();
    const nums = numericValues(line);
    if (/\\b(tank|inventory)\\b/i.test(line) && nums.length) {
      const bucket = (tankByFuel[fuelType] ||= {});
      if (/\\bopening\\b/i.test(line)) bucket.opening = nums[0];
      if (/\\bclosing\\b/i.test(line)) bucket.closing = nums[nums.length - 1];
      if (!/\\b(opening|closing)\\b/i.test(line) && nums.length >= 2) {
        bucket.opening = nums[0];
        bucket.closing = nums[1];
      }
    }
    if (/\\b(price|rate|per\\s*l|per\\s*litre|\\/l)\\b/i.test(line) && nums.length) {
      pricesByFuelType[fuelType] = nums[nums.length - 1];
    }
  }
  const tankReadings = Object.entries(tankByFuel)
    .filter(([, v]) => Number.isFinite(v.opening) && Number.isFinite(v.closing))
    .map(([fuelType, v]) => ({ fuelType, opening: Number(v.opening), closing: Number(v.closing) }));

  // First handle explicit pump IDs. Support either:
'''
if old not in s: raise SystemExit('parser insertion point not found')
s = s.replace(old, new, 1)
old = '''    otherDetails,
    confidence,
    notes,
'''
new = '''    otherDetails,
    tankReadings,
    pricesByFuelType,
    confidence,
    notes,
'''
if old not in s: raise SystemExit('parser return block not found')
s = s.replace(old, new, 1)
parser.write_text(s)

sales = ROOT / 'src/react-app/components/SalesTracking.tsx'
t = sales.read_text()
old = '''  otherDetails?: Array<{ label: string; value: number }>;
  confidence?: string;
  additionalNotes?: string;
'''
new = '''  otherDetails?: Array<{ label: string; value: number }>;
  tankReadings?: Array<{ fuelType: string; opening: number; closing: number }>;
  pricesByFuelType?: Record<string, number>;
  confidence?: string;
  additionalNotes?: string;
'''
if old not in t: raise SystemExit('sales interface block not found')
t = t.replace(old, new, 1)
old = '''      otherDetails: fields.otherDetails,
      confidence: fields.confidence,
'''
new = '''      otherDetails: fields.otherDetails,
      tankReadings: fields.tankReadings,
      pricesByFuelType: fields.pricesByFuelType,
      confidence: fields.confidence,
'''
if old not in t: raise SystemExit('sales extraction return block not found')
t = t.replace(old, new, 1)
old = '''    if (data.date) dispatch({ type: "SET_SALES_DATE", payload: data.date });
    if (data.shift) dispatch({ type: "SET_SHIFT", payload: data.shift });

    // A scan is a partial observation:
'''
new = '''    if (data.date) dispatch({ type: "SET_SALES_DATE", payload: data.date });
    if (data.shift) dispatch({ type: "SET_SHIFT", payload: data.shift });

    // Apply explicitly labelled tank readings and prices from the scanned sheet.
    // They are semantic fields from the document, not inferred from row order.
    for (const tank of data.tankReadings || []) {
      const ft = normalizeFuelType(tank.fuelType || "");
      if (!ft) continue;
      if (ft === "petrol") {
        dispatch({ type: "SET_TANK_VALUES", payload: { pmsTankOpening: tank.opening, pmsTankClosing: tank.closing } });
      } else if (ft === "diesel") {
        dispatch({ type: "SET_TANK_VALUES", payload: { agoTankOpening: tank.opening, agoTankClosing: tank.closing } });
      } else {
        dispatch({ type: "SET_TANK_VALUES", payload: { fuelTankValuesByType: { [ft]: { opening: tank.opening, closing: tank.closing } } } });
      }
    }
    for (const [rawType, rawPrice] of Object.entries(data.pricesByFuelType || {})) {
      const ft = normalizeFuelType(rawType);
      const price = Number(rawPrice);
      if (ft && Number.isFinite(price) && price > 0 && isPlausibleStationPrice(price, detectedCountry, getFuelLabel(ft))) {
        setPriceForType(ft, price);
      }
    }

    // A scan is a partial observation:
'''
if old not in t: raise SystemExit('sales apply insertion point not found')
t = t.replace(old, new, 1)
old = '''        if (!match) {
          unmatched.push(p.name || "Unlabelled pump");
          continue;
        }
'''
new = '''        if (!match) {
          // If the sheet explicitly names the fuel type and contains complete
          // meter readings, create the pump row instead of dropping valid data.
          // For unlabeled rows we still refuse to guess the fuel/pump identity.
          if (explicitType && working[explicitType] && ksh > 0 && Number(p.closingReading || 0) > 0) {
            const code = getFuelCode(explicitType) || explicitType.toUpperCase();
            const requestedId = String(p.name || "").trim();
            const id = requestedId && !/^SCAN-\\d+$/i.test(requestedId)
              ? requestedId
              : `${code}-${working[explicitType].length + 1}`;
            const closingKsh = Number(p.closingReading);
            const closingL = Number(p.closingLitres || litres);
            working[explicitType].push({
              id,
              openingKsh: ksh,
              closingKsh,
              openingL: litres,
              closingL,
              salesL: Number.isFinite(Number(p.salesLitres)) ? Number(p.salesLitres) : Math.abs(closingL - litres),
              salesKsh: Number.isFinite(Number(p.salesAmount)) ? Number(p.salesAmount) : Math.abs(closingKsh - ksh),
            });
            continue;
          }
          unmatched.push(p.name || "Unlabelled pump");
          continue;
        }
'''
if old not in t: raise SystemExit('sales unmatched block not found')
t = t.replace(old, new, 1)
sales.write_text(t)
print('AI scan field autofix applied')
