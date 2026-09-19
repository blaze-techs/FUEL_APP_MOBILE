export const FUELPRO_SUPPORT_EMAIL = "support@fuelpro.com";
export const FUELPRO_SUPPORT_MAILTO = `mailto:${FUELPRO_SUPPORT_EMAIL}`;
export const FUELPRO_SUPPORT_PHONE =
  (import.meta.env.VITE_SUPPORT_PHONE as string | undefined)?.trim() || "";
