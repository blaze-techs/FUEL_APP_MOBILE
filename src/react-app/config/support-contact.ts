/** Canonical FuelPro support contact used across the app. */
export const FUELPRO_SUPPORT_EMAIL = "support@fuelpro.com";
export const FUELPRO_SUPPORT_MAILTO = `mailto:${FUELPRO_SUPPORT_EMAIL}`;
export const FUELPRO_SUPPORT_PHONE = "+254754458501";
export const FUELPRO_SUPPORT_TEL = `tel:${FUELPRO_SUPPORT_PHONE}`;

export const SUPPORT_CONTACT = {
  email: FUELPRO_SUPPORT_EMAIL,
  phone: FUELPRO_SUPPORT_PHONE,
  mailto: FUELPRO_SUPPORT_MAILTO,
  tel: FUELPRO_SUPPORT_TEL,
  emailHref: FUELPRO_SUPPORT_MAILTO,
  phoneHref: FUELPRO_SUPPORT_TEL,
} as const;
