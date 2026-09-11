/**
 * SEO metadata manager — single source of truth for every page's title,
 * meta description, canonical URL, robots directive, Open Graph/Twitter
 * tags, and structured data (JSON-LD).
 *
 * The app is a HashRouter SPA, so all runtime SEO updates are applied
 * client-side via this module. Static crawlers receive the base tags from
 * index.html; JS-capable crawlers and social scrapers receive the
 * route/tab-specific tags applied here.
 */

export const SITE_NAME = "FuelPro";
export const SITE_URL = "https://fuelpropay.com";
export const SITE_TAGLINE = "Fuel Station Management System";
export const DEFAULT_DESCRIPTION =
  "FuelPro is the all-in-one fuel station management platform: point of sale, pump and tank inventory, M-PESA payments, invoicing, payroll, compliance, and real-time analytics.";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

export interface SeoMeta {
  title: string;
  description: string;
  /** Route path used to build the canonical URL (e.g. "/sign-in"). */
  canonicalPath: string;
  robots?: string;
  ogType?: "website" | "article";
}

/* ----------------------------- Public routes ---------------------------- */

export const ROUTE_SEO: Record<string, SeoMeta> = {
  "/": {
    title: `Fuel Station Management Software — ${SITE_NAME}`,
    description: DEFAULT_DESCRIPTION,
    canonicalPath: "/",
    ogType: "website",
  },
  "/sign-in": {
    title: `Sign In — ${SITE_NAME}`,
    description:
      "Sign in to FuelPro to manage your fuel station: sales, stock, pumps, invoices, payments, and analytics in one dashboard.",
    canonicalPath: "/sign-in",
  },
  "/sign-up": {
    title: `Create Your Station Account — ${SITE_NAME}`,
    description:
      "Create a free FuelPro account and set up your fuel station in minutes. Point of sale, inventory, M-PESA payments, and compliance built in.",
    canonicalPath: "/sign-up",
  },
  "/reset-password": {
    title: `Reset Password — ${SITE_NAME}`,
    description:
      "Reset your FuelPro account password securely via a verified email link.",
    canonicalPath: "/reset-password",
    robots: "noindex, nofollow",
  },
  "/station-access": {
    title: `Station Access — ${SITE_NAME}`,
    description:
      "Team members: access the station shared with you using your access code or username.",
    canonicalPath: "/station-access",
    robots: "noindex, nofollow",
  },
  "/join": {
    title: `Join a Station — ${SITE_NAME}`,
    description: "Accept your FuelPro station invite and join your team.",
    canonicalPath: "/join",
    robots: "noindex, nofollow",
  },
  "/founder": {
    title: `Founder Console — ${SITE_NAME}`,
    description: "FuelPro founder administration console.",
    canonicalPath: "/founder",
    robots: "noindex, nofollow",
  },
  "/404": {
    title: `Page Not Found — ${SITE_NAME}`,
    description:
      "The page you are looking for does not exist. Return to the FuelPro dashboard or sign in.",
    canonicalPath: "/404",
    robots: "noindex, nofollow",
  },
};

/* ------------------------------- App tabs ------------------------------- */

export interface TabSeo {
  title: string;
  description: string;
}

export const TAB_SEO: Record<string, TabSeo> = {
  dashboard: {
    title: "Dashboard",
    description:
      "Station overview: live revenue, fuel sold, pump status, tank levels, and current pump prices.",
  },
  pos: {
    title: "Point of Sale",
    description:
      "Fast fuel sales at the pump: quick fuel sale, cart, cash/M-PESA/card payments, and tax-compliant receipts.",
  },
  sales: {
    title: "Sales Tracking",
    description:
      "Track pump readings, shift sales, tank inventory, and daily fuel summaries.",
  },
  livetransaction: {
    title: "Live Transaction Monitor",
    description:
      "Real-time payment feed: STK push requests, payment sources, and shared transaction analytics.",
  },
  offloading: {
    title: "Fuel Offloading",
    description:
      "Record and reconcile fuel deliveries and offloading by truck, driver, supplier, and fuel type.",
  },
  delivery: {
    title: "Fuel Statement Report",
    description:
      "Delivery tracking and fuel statements with per-fuel-type pricing and exports.",
  },
  inventory: {
    title: "Stock Management",
    description:
      "Product catalog, stock adjustments, transfers, counts, wastage, auto-reorders, and history.",
  },
  fuelsalesreport: {
    title: "Fuel Sales Report",
    description:
      "Fuel sales reporting by period, fuel type, pump, and attendant.",
  },
  invoice: {
    title: "Invoice",
    description:
      "Create professional invoices with your company branding and share them by PDF, WhatsApp, or email.",
  },
  credit: {
    title: "Credit Management",
    description:
      "Customer credit accounts, balances, payment history, and debt payment reminders.",
  },
  customers: {
    title: "Customers",
    description:
      "Customer loyalty program: segments, rewards, points, and visit history.",
  },
  mpesa: {
    title: "M-PESA Analyzer",
    description:
      "Analyze M-PESA statements, reconcile inflows, and match payments to customers.",
  },
  payroll: {
    title: "Payroll System",
    description:
      "Employee payroll, statutory deductions, payslip PDFs, and WhatsApp/email delivery.",
  },
  suppliers: {
    title: "Supplier Management",
    description:
      "Suppliers, purchase orders, and purchase history for your station.",
  },
  expenses: {
    title: "Expenses",
    description:
      "Track station expenses by category with budgets, analytics, and exports.",
  },
  fueltypes: {
    title: "Fuel Type Manager",
    description:
      "Configure fuel types, pump counts, prices, price board, and fuel quality tests.",
  },
  team: {
    title: "Team Manager",
    description:
      "Team access: invite links, access codes, roles, permissions, and shift scheduling.",
  },
  maintenance: {
    title: "Maintenance",
    description:
      "Equipment maintenance schedules, service records, and cost analytics.",
  },
  reports: {
    title: "Reports Center",
    description:
      "Generate sales, VAT, day book, loss control, and statutory reports with PDF/Excel export.",
  },
  analytics: {
    title: "Analytics",
    description:
      "Advanced station analytics: revenue trends, volume, growth, and predictions.",
  },
  audit: {
    title: "Audit Trail",
    description: "Cloud-synced audit log of every action across your station.",
  },
  pumpmapping: {
    title: "Pump Mapping",
    description:
      "Map physical pumps to digital records with document extraction and export.",
  },
  communication: {
    title: "Communication",
    description: "Contacts, bulk SMS/email messaging, and message templates.",
  },
  documents: {
    title: "Document Center",
    description:
      "Cloud document storage with folders, previews, and conversion tools.",
  },
  data: {
    title: "Data Manager",
    description: "Backup, restore, and manage your station data and storage.",
  },
  integration: {
    title: "Integration Hub",
    description:
      "Connect M-PESA Daraja, Kopo Kopo, PayHero, webhooks, API keys, and hardware.",
  },
  regional: {
    title: "Compliance",
    description:
      "Country-aware regulatory compliance: permits, tax registration, and checklists.",
  },
  news: {
    title: "News & Live TV",
    description:
      "Fuel industry news, live TV channels, live radio, and movies.",
  },
  terminal: {
    title: "Terminal Sessions",
    description: "Open and close POS terminal sessions with variance tracking.",
  },
  automation: {
    title: "Automation Engine",
    description:
      "Automate reorders, stock recording, and workflows with the automation engine.",
  },
  "price-finder": {
    title: "Fuel Price Finder",
    description:
      "Hyper-local fuel price lookup by GPS with EPRA reference prices for Kenya.",
  },
  settings: {
    title: "General Settings",
    description:
      "Station settings: company profile, localization, taxes, security, and deployment.",
  },
};

/* --------------------------- DOM appliers ------------------------------- */

function upsertMeta(
  selector: string,
  attrs: Record<string, string>,
  createTag: "meta" | "link" = "meta",
): void {
  let el = document.head.querySelector(selector) as
    HTMLMetaElement | HTMLLinkElement | null;
  if (!el) {
    el = document.createElement(createTag);
    document.head.appendChild(el);
  }
  Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
}

/**
 * Applies the full head metadata for a page. `robots` defaults to
 * "index, follow".
 */
export function applySeoMeta(meta: SeoMeta): void {
  const canonicalUrl = `${SITE_URL}${meta.canonicalPath}`;
  const robots = meta.robots ?? "index, follow";
  const ogType = meta.ogType ?? "website";

  document.title = `${meta.title} — ${SITE_NAME}`.replace(
    `${SITE_NAME} — ${SITE_NAME}`,
    SITE_NAME,
  );

  upsertMeta('meta[name="description"]', {
    name: "description",
    content: meta.description,
  });
  upsertMeta('meta[name="robots"]', { name: "robots", content: robots });
  upsertMeta(
    'link[rel="canonical"]',
    { rel: "canonical", href: canonicalUrl },
    "link",
  );

  upsertMeta('meta[property="og:title"]', {
    property: "og:title",
    content: document.title,
  });
  upsertMeta('meta[property="og:description"]', {
    property: "og:description",
    content: meta.description,
  });
  upsertMeta('meta[property="og:url"]', {
    property: "og:url",
    content: canonicalUrl,
  });
  upsertMeta('meta[property="og:type"]', {
    property: "og:type",
    content: ogType,
  });
  upsertMeta('meta[property="og:site_name"]', {
    property: "og:site_name",
    content: SITE_NAME,
  });
  upsertMeta('meta[property="og:image"]', {
    property: "og:image",
    content: DEFAULT_OG_IMAGE,
  });

  upsertMeta('meta[name="twitter:card"]', {
    name: "twitter:card",
    content: "summary_large_image",
  });
  upsertMeta('meta[name="twitter:title"]', {
    name: "twitter:title",
    content: document.title,
  });
  upsertMeta('meta[name="twitter:description"]', {
    name: "twitter:description",
    content: meta.description,
  });
  upsertMeta('meta[name="twitter:image"]', {
    name: "twitter:image",
    content: DEFAULT_OG_IMAGE,
  });
}

/** Applies SEO for an app tab (the main authenticated views). */
export function applyTabSeo(tabId: string, tabLabel?: string): void {
  const tab = TAB_SEO[tabId];
  const title = tab?.title ?? tabLabel ?? "Dashboard";
  const description =
    tab?.description ??
    `${title} — manage your fuel station with ${SITE_NAME}.`;
  applySeoMeta({
    title,
    description,
    canonicalPath: "/",
    robots: "noindex, nofollow", // authenticated app views are not indexable
  });
}

/* --------------------------- Structured data ---------------------------- */

function upsertJsonLd(id: string, data: unknown): void {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export interface LocalBusinessInput {
  name: string;
  location?: string;
  phone?: string;
  email?: string;
  country?: string;
  currency?: string;
  logo?: string;
}

/** Injects/replaces the LocalBusiness (GasStation) schema for the station. */
export function applyLocalBusinessSchema(station: LocalBusinessInput): void {
  const addressText = [station.location, station.country]
    .filter(Boolean)
    .join(", ");
  upsertJsonLd("ld-local-business", {
    "@context": "https://schema.org",
    "@type": "GasStation",
    name: station.name,
    url: SITE_URL,
    image: station.logo || DEFAULT_OG_IMAGE,
    telephone: station.phone || undefined,
    email: station.email || undefined,
    address: addressText
      ? {
          "@type": "PostalAddress",
          streetAddress: station.location || undefined,
          addressCountry: station.country || undefined,
        }
      : undefined,
    currenciesAccepted: station.currency || undefined,
    paymentAccepted: "Cash, M-PESA, Credit Card, Debit Card",
  });
}

/** Injects BreadcrumbList schema (Home > current view). */
export function applyBreadcrumbSchema(currentLabel: string): void {
  upsertJsonLd("ld-breadcrumb", {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_URL}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: currentLabel,
        item: `${SITE_URL}/`,
      },
    ],
  });
}
