/**
 * CANONICAL FuelPro support contact configuration — the SINGLE source of truth
 * for the support email + phone used across the app: the app footer, the
 * Header mobile "Email support" / "Call support" actions, and the
 * Settings → FuelPro Support card.
 *
 * Every UI surface MUST import from this module rather than hardcoding an
 * address, so the whole app changes in one place. A regression test
 * (`src/test/support-contact.test.ts`) fails the build if a duplicate
 * hardcoded support address is reintroduced.
 *
 * Values may be overridden per-deployment via the PUBLIC build-time env vars
 * `VITE_SUPPORT_EMAIL` / `VITE_SUPPORT_PHONE` (public contact details, never
 * secrets).
 *
 * NOTE — the `support@fuelpro.com` mailbox is an EXTERNAL infrastructure
 * dependency: the domain owner must provision it at the mail provider
 * (MX + SPF + DKIM + DMARC) before delivery can be verified end-to-end.
 * The mailbox password belongs in that provider only — never in this repo
 * or the application.
 */

const envEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim();
const envPhone = import.meta.env.VITE_SUPPORT_PHONE?.trim();

/** Canonical customer-service address. */
export const FUELPRO_SUPPORT_EMAIL = envEmail || "support@fuelpro.com";

/** Canonical support phone number. */
export const FUELPRO_SUPPORT_PHONE = envPhone || "+254754458501";

// Short aliases — preferred in new code.
export const SUPPORT_EMAIL = FUELPRO_SUPPORT_EMAIL;
export const SUPPORT_PHONE = FUELPRO_SUPPORT_PHONE;

/**
 * Build a `tel:` URI from a phone number (digits only, leading `+` kept).
 * Returns "" when the number is blank so callers can hide the control
 * instead of rendering a dead link.
 */
export function telHref(phone: string = SUPPORT_PHONE): string {
  const cleaned = (phone || "").replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

/**
 * Build a `mailto:` URI for the canonical support address, optionally with a
 * pre-filled subject.
 */
export function mailtoHref(
  subject?: string,
  email: string = SUPPORT_EMAIL,
): string {
  const base = `mailto:${email}`;
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base;
}

export const FUELPRO_SUPPORT_MAILTO = mailtoHref();
export const FUELPRO_SUPPORT_TEL = telHref();

export const SUPPORT_CONTACT = {
  email: SUPPORT_EMAIL,
  phone: SUPPORT_PHONE,
  phoneHref: FUELPRO_SUPPORT_TEL,
  emailHref: FUELPRO_SUPPORT_MAILTO,
  mailto: FUELPRO_SUPPORT_MAILTO,
  tel: FUELPRO_SUPPORT_TEL,
} as const;
