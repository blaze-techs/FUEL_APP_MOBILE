import { getCurrencySymbol, getLocaleForCountry } from "../lib/currency";

export const formatNumber = (num: number, decimals: number = 2): string => {
  if (!Number.isFinite(num)) return (0).toFixed(decimals);
  return new Intl.NumberFormat(getLocaleForCountry(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

export const formatCurrency = (
  amount: number,
  currency: string = getCurrencySymbol(),
): string => {
  return `${currency} ${formatNumber(amount, 2)}`;
};

export const formatDate = (date: string | Date): string => {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(getLocaleForCountry(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export const formatAmountWithCommas = (amount: number | string): string => {
  const num =
    typeof amount === "string"
      ? parseFloat(amount.replace(/,/g, "")) || 0
      : Number.isFinite(amount)
        ? amount
        : 0;
  return formatNumber(num, 2);
};

export const parseNumberFromFormatted = (value: string): number => {
  const parsed = parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
