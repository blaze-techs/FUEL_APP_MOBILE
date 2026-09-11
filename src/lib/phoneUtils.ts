/**
 * Kenyan Phone Number Utilities
 * Handles formatting and validation for M-PESA and general use
 */

/**
 * Format Kenyan phone numbers to +254 format
 * Handles: 07xxx, 01xxx, +254xx, 254xx, 0254xx
 *
 * @param phone - Phone number in any Kenyan format
 * @returns Formatted phone number in +254 format, or original if invalid
 */
export function formatPhone254(phone: string): string {
  if (!phone) return "";

  // Remove all non-digits
  let cleaned = phone.replace(/\D/g, "");

  // Handle various input formats
  if (cleaned.startsWith("00254")) {
    // 00254... -> 254...
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith("254")) {
    // Already in 254 format
  } else if (cleaned.startsWith("0")) {
    // 07xxx or 01xxx -> 254 7xxx or 254 1xxx
    cleaned = "254" + cleaned.substring(1);
  } else if (cleaned.match(/^[17]/)) {
    // 7xxx or 1xxx -> 254 7xxx or 254 1xxx
    cleaned = "254" + cleaned;
  }

  // Validate: 254 + 9 digits = 12 digits total
  if (cleaned.length === 12 && cleaned.startsWith("254")) {
    return "+" + cleaned;
  }

  return phone; // Return original if invalid format
}

/**
 * Check if a phone number is a valid Kenyan format
 * @param phone - Phone number to validate
 * @returns True if valid Kenyan phone number
 */
export function isValidKenyanPhone(phone: string): boolean {
  const formatted = formatPhone254(phone);
  return formatted.startsWith("+254") && formatted.length === 13;
}

/**
 * Extract just the digits from a formatted phone number
 * @param phone - Formatted or unformatted phone number
 * @returns Just the digits (e.g., "254712345678")
 */
export function getPhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Format phone number for display (e.g., "+254 712 345 678")
 * @param phone - Phone number in any format
 * @returns Formatted for display
 */
export function displayPhone(phone: string): string {
  const formatted = formatPhone254(phone);
  if (!formatted.startsWith("+")) return phone;

  // +254 712 345 678
  return `${formatted.slice(0, 4)} ${formatted.slice(4, 7)} ${formatted.slice(7, 10)} ${formatted.slice(10)}`;
}
