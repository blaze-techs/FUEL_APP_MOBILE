/**
 * Currency Utilities
 * Handles safe floating-point arithmetic for financial transactions
 * Prevents errors like 0.1 + 0.2 = 0.30000000000000004
 */

/**
 * Safely round currency values to 2 decimal places
 * Uses Number.EPSILON to avoid floating-point precision issues
 *
 * @param value - The value to round
 * @returns Rounded value with 2 decimal places
 *
 * @example
 * roundCurrency(0.1 + 0.2) // Returns 0.30 (not 0.30000000000000004)
 * roundCurrency(1234.567) // Returns 1234.57
 */
export const roundCurrency = (value: number): number => {
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

/**
 * Format a number as currency in Kenyan Shillings
 * @param value - The numeric value
 * @param currency - Currency code (default: 'KES')
 * @returns Formatted string (e.g., "KES 1,234.50")
 */
export const formatCurrency = (
  value: number,
  currency: string = "KES",
): string => {
  const rounded = roundCurrency(value);
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rounded);
};

/**
 * Parse a currency string to a number
 * @param value - Currency string (e.g., "KES 1,234.50" or "1,234.50")
 * @returns Parsed number, safely rounded
 */
export const parseCurrency = (value: string): number => {
  // Remove currency symbols, spaces, and other non-numeric characters (except . and -)
  const cleaned = value.replace(/[^\d.-]/g, "");
  return roundCurrency(parseFloat(cleaned) || 0);
};

/**
 * Add two currency values without floating-point errors
 * @param a - First value
 * @param b - Second value
 * @returns Sum, safely rounded
 *
 * @example
 * addCurrency(0.1, 0.2) // Returns 0.30 (not 0.30000000000000004)
 */
export const addCurrency = (a: number, b: number): number => {
  return roundCurrency(a + b);
};

/**
 * Subtract two currency values without floating-point errors
 * @param a - Minuend
 * @param b - Subtrahend
 * @returns Difference, safely rounded
 */
export const subtractCurrency = (a: number, b: number): number => {
  return roundCurrency(a - b);
};

/**
 * Multiply a currency value without floating-point errors
 * @param value - The value to multiply
 * @param multiplier - The multiplier
 * @returns Product, safely rounded
 *
 * @example
 * multiplyCurrency(0.1, 3) // Returns 0.30 (not 0.30000000000000003)
 */
export const multiplyCurrency = (value: number, multiplier: number): number => {
  return roundCurrency(value * multiplier);
};

/**
 * Divide a currency value without floating-point errors
 * @param dividend - The value to divide
 * @param divisor - The divisor
 * @returns Quotient, safely rounded
 */
export const divideCurrency = (dividend: number, divisor: number): number => {
  if (divisor === 0) return 0;
  return roundCurrency(dividend / divisor);
};

/**
 * Calculate percentage of a value
 * @param value - The value
 * @param percent - The percentage (0-100)
 * @returns The percentage of the value
 */
export const percentOf = (value: number, percent: number): number => {
  return roundCurrency(multiplyCurrency(value, percent / 100));
};

/**
 * Sum an array of currency values
 * @param values - Array of values to sum
 * @returns Safely rounded sum
 */
export const sumCurrency = (values: number[]): number => {
  return values.reduce((acc, val) => addCurrency(acc, val), 0);
};

/**
 * Calculate average of currency values
 * @param values - Array of values
 * @returns Safely rounded average
 */
export const averageCurrency = (values: number[]): number => {
  if (values.length === 0) return 0;
  return divideCurrency(sumCurrency(values), values.length);
};

/**
 * Validate if a value is a valid currency amount (>=0, 2 decimals max)
 * @param value - The value to validate
 * @returns True if valid currency amount
 */
export const isValidCurrencyAmount = (value: number): boolean => {
  if (isNaN(value) || !isFinite(value)) return false;
  if (value < 0) return false;
  const rounded = roundCurrency(value);
  return value === rounded;
};
