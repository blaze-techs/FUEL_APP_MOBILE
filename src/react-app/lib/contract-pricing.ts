/* contract-pricing.ts — single canonical resolver for contract pricing
 * (Credit tab → Price Lists). Used by POS quick-sale AND Invoice so the rule
 * matches identically in both places (case-insensitive customer + fuel,
 * trimmed).
 */

export interface ContractPriceRule {
  id: string;
  customer: string;
  fuelType: string;
  price: number;
}

export function resolveContractPrice(
  customer: string | undefined,
  fuelLabel: string,
  standardPrice: number | undefined | null,
  rules: ContractPriceRule[] | undefined,
): number | undefined {
  const std = standardPrice ?? undefined;
  const cust = (customer || "").trim().toLowerCase();
  const fuel = (fuelLabel || "").trim().toLowerCase();
  if (!cust || !fuel) return std;
  const hit = (rules || []).find(
    (r) =>
      r.fuelType.trim().toLowerCase() === fuel &&
      r.customer.trim().toLowerCase() === cust &&
      r.price > 0,
  );
  return hit?.price ?? std;
}
