/**
 * Mini Site Service — the "mini site" feature.
 *
 * Reverse-engineered from motifiti.co.ke, where a seller signs up and gets an
 * auto-generated, branded public website for their business in minutes (stock,
 * contact, own URL, optionally linked to their own domain) without building a
 * website from scratch.
 *
 * This is FuelPro's station equivalent: the station owner flips a switch and
 * gets a real, shareable, indexable public website at
 *   https://fuel-app-mobile.pages.dev/#/site/<slug>
 * built automatically from data the station has ALREADY entered (station
 * record, configured fuel types + live prices, Web Studio content, team,
 * services) — no double entry, no separate host.
 *
 * ── ARCHITECTURE ─────────────────────────────────────────────────────────
 * The public page is served to ANONYMOUS visitors who have no Supabase
 * session, so RLS on `app_kv` blocks them. Exactly like the station-snapshot
 * / company-grant design, the owner publishes a compact, curated, read-only
 * JSON document to the PUBLIC `fuelpro-files` Storage bucket:
 *
 *   fuelpro-files/mini-site/<slug>/site.json
 *
 * The public page fetches that object over a plain GET (no Authorization
 * header) and renders it. The published document is DELIBERATELY narrow: it
 * carries marketing content + published prices + contact details and NEVER
 * payroll, credit, expenses, customers, staff records or credentials.
 *
 * The owner's editable configuration (slug, theme, toggles, services, hours,
 * socials, analytics counters) lives in the station-scoped cloud key
 * `mini_site_config`, so it is cross-device and RLS-guarded like every other
 * component store.
 *
 * ── WHY A SNAPSHOT AND NOT A LIVE READ ───────────────────────────────────
 * The published copy is what anonymous visitors and search engines read, and
 * it is what the owner explicitly chose to make public. Publishing is a
 * deliberate action, so "unpublish" genuinely removes the site rather than
 * just hiding it behind a flag an anonymous client could ignore.
 */

import { getSupabaseClient } from "@/supabase/client";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { grantApiBase } from "@/react-app/lib/company-grant-service";

const BUCKET = "fuelpro-files";
const CONFIG_KEY = "mini_site_config";
const STORAGE_KEY = "fuelpro_mini_site_v1";

export const MINI_SITE_PATH = (slug: string) => `mini-site/${slug}/site.json`;

/** Maximum public payload size — keeps the published object small and cheap. */
export const MINI_SITE_SECTION_KEYS = [
  "prices",
  "about",
  "services",
  "team",
  "testimonials",
  "faqs",
  "gallery",
  "blog",
  "careers",
  "contact",
  "hours",
  "location",
] as const;

export type MiniSiteSectionKey = (typeof MINI_SITE_SECTION_KEYS)[number];

export interface MiniSiteSectionToggle {
  key: MiniSiteSectionKey;
  label: string;
  description: string;
}

/** Sections the owner can show/hide, in the order they render publicly. */
export const MINI_SITE_SECTIONS: MiniSiteSectionToggle[] = [
  {
    key: "prices",
    label: "Today's fuel prices",
    description: "Your published pump prices, pulled from Fuel Type Manager",
  },
  {
    key: "about",
    label: "About us",
    description: "Short introduction shown under the hero",
  },
  {
    key: "services",
    label: "Services",
    description: "What your station offers (car wash, LPG, tyre service…)",
  },
  {
    key: "team",
    label: "Team",
    description: "From Web Studio → Team",
  },
  {
    key: "testimonials",
    label: "Testimonials",
    description: "From Web Studio → Testimonials",
  },
  {
    key: "faqs",
    label: "FAQs",
    description: "From Web Studio → FAQs",
  },
  {
    key: "gallery",
    label: "Gallery",
    description: "From Web Studio → Portfolio",
  },
  {
    key: "blog",
    label: "News / blog",
    description: "Published posts from Web Studio → Blog",
  },
  {
    key: "careers",
    label: "Careers",
    description: "Open roles from Web Studio → Careers",
  },
  {
    key: "contact",
    label: "Contact & WhatsApp",
    description: "Phone, email, WhatsApp chat and directions",
  },
  {
    key: "hours",
    label: "Opening hours",
    description: "Trading hours shown with an open/closed badge",
  },
  {
    key: "location",
    label: "Map & directions",
    description: "Address with a one-tap directions link",
  },
];

export const DEFAULT_MINI_SITE_SECTIONS: MiniSiteSectionKey[] = [
  "prices",
  "about",
  "services",
  "hours",
  "contact",
  "location",
  "team",
  "faqs",
];

export interface MiniSiteTheme {
  /** Primary brand colour (hex). */
  primary: string;
  /** Secondary/accent colour (hex). */
  accent: string;
  /** Card surface preference. */
  surface: "light" | "dark" | "auto";
  /** Pre-built layout preset. */
  preset: MiniSitePreset;
}

export type MiniSitePreset = "classic" | "modern" | "bold";

export interface MiniSiteHours {
  /** 0 = Sunday … 6 = Saturday. */
  day: number;
  open: string;
  close: string;
  closed: boolean;
}

export interface MiniSiteService {
  id: string;
  title: string;
  description: string;
  icon?: string;
}

export interface MiniSiteSocials {
  facebook?: string;
  instagram?: string;
  x?: string;
  tiktok?: string;
  youtube?: string;
  linkedin?: string;
}

export interface MiniSiteAnalytics {
  views: number;
  /** ISO country codes seen, most recent first, de-duplicated. */
  countries: string[];
  shares: number;
  contactClicks: number;
  lastViewedAt: number;
}

export interface MiniSiteConfig {
  /** URL slug, e.g. "publican-energy". Resolved uniquely per publish. */
  slug: string;
  /** Whether the public site is currently reachable. */
  published: boolean;
  /** Marketing headline (defaults to the station name). */
  headline: string;
  /** Hero sub-headline. */
  tagline: string;
  /** Long-form intro. */
  about: string;
  heroImageUrl: string;
  /** Station logo shown in the public hero (seeded from the station). */
  logoUrl: string;
  /** Optional video/YouTube embed on the hero. */
  heroVideoUrl: string;
  /** "Get directions" target. */
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  /** Optional live map link (Google Maps or OSM). */
  mapUrl: string;
  theme: MiniSiteTheme;
  sections: MiniSiteSectionKey[];
  services: MiniSiteService[];
  hours: MiniSiteHours[];
  socials: MiniSiteSocials;
  /** Show prices in the public hero/banner. */
  showPricesInHero: boolean;
  /** Indexable by search engines. */
  allowIndexing: boolean;
  /** Free-text footer note. */
  footerNote: string;
  analytics: MiniSiteAnalytics;
  updatedAt: number;
  createdAt: number;
}

export const DEFAULT_HOURS: MiniSiteHours[] = [
  { day: 1, open: "06:00", close: "21:00", closed: false },
  { day: 2, open: "06:00", close: "21:00", closed: false },
  { day: 3, open: "06:00", close: "21:00", closed: false },
  { day: 4, open: "06:00", close: "21:00", closed: false },
  { day: 5, open: "06:00", close: "21:00", closed: false },
  { day: 6, open: "06:00", close: "21:00", closed: false },
  { day: 0, open: "08:00", close: "18:00", closed: false },
];

export const MINI_SITE_PRESETS: Array<{
  id: MiniSitePreset;
  label: string;
  description: string;
  primary: string;
  accent: string;
}> = [
  {
    id: "classic",
    label: "Classic",
    description: "Warm gold and deep navy — the FuelPro default",
    primary: "#c5a059",
    accent: "#0a0e17",
  },
  {
    id: "modern",
    label: "Modern",
    description: "Fresh blue with clean white cards",
    primary: "#2563eb",
    accent: "#0f172a",
  },
  {
    id: "bold",
    label: "Bold",
    description: "High-energy green for high-traffic forecourts",
    primary: "#059669",
    accent: "#06281f",
  },
];

export const DEFAULT_MINI_SITE_CONFIG: MiniSiteConfig = {
  slug: "",
  published: false,
  headline: "",
  tagline: "",
  about: "",
  heroImageUrl: "",
  logoUrl: "",
  heroVideoUrl: "",
  address: "",
  phone: "",
  whatsapp: "",
  email: "",
  mapUrl: "",
  theme: {
    primary: "#c5a059",
    accent: "#0a0e17",
    surface: "auto",
    preset: "classic",
  },
  sections: [...DEFAULT_MINI_SITE_SECTIONS],
  services: [],
  hours: [...DEFAULT_HOURS],
  socials: {},
  showPricesInHero: true,
  allowIndexing: true,
  footerNote: "",
  analytics: {
    views: 0,
    countries: [],
    shares: 0,
    contactClicks: 0,
    lastViewedAt: 0,
  },
  updatedAt: 0,
  createdAt: 0,
};

// ── slug helpers ──────────────────────────────────────────────────────────

/** Turn any label into a URL-safe slug (lowercase a-z0-9 with single dashes). */
export function slugify(input: string, maxLen = 60): string {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
}

/**
 * A slug must be usable as a single Storage path segment AND as a URL path
 * segment. This rejects reserved words, dots and anything that could escape
 * the `mini-site/<slug>/` prefix.
 */
const RESERVED_SLUGS = new Set([
  "api",
  "assets",
  "admin",
  "founder",
  "site",
  "station-access",
  "join",
  "login",
  "signup",
  "static",
  "null",
  "undefined",
]);

export function isValidMiniSiteSlug(slug: string): boolean {
  if (!slug || slug.length < 3 || slug.length > 60) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
  if (!/[a-z0-9]/.test(slug)) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return true;
}

/**
 * Derive a candidate slug from a station name, avoiding reserved words.
 * Returns a valid slug; the caller resolves collisions on publish.
 */
export function slugFromStationName(name: string, code?: string): string {
  let base = slugify(name);
  if (!base || base.length < 3) base = slugify(code || "") || "station";
  if (RESERVED_SLUGS.has(base)) base = `${base}-station`;
  if (!isValidMiniSiteSlug(base))
    base = `station-${base || "site"}`.slice(0, 60);
  if (!isValidMiniSiteSlug(base)) base = "station-site";
  return base;
}

/** Append a short suffix to disambiguate a taken slug. */
export function withSlugSuffix(slug: string, suffix: string | number): string {
  const tail = String(suffix)
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
  const room = Math.max(3, 60 - tail.length - 1);
  const head = slug.slice(0, room).replace(/-+$/g, "");
  const out = `${head || "station"}-${tail}`;
  return isValidMiniSiteSlug(out) ? out : `station-${tail || "1"}`;
}

/**
 * The public path for a slug. This is the CLEAN path (not the hash route) —
 * it is the address that gets shared and indexed. A boot-time shim in
 * index.html rewrites it into the app's hash route, and `_redirects` on
 * Cloudflare Pages / the catch-all rewrite on Vercel both serve index.html
 * for it, so the URL genuinely works and is indexable as its own page.
 */
export function miniSitePath(slug: string): string {
  return `/site/${slug}`;
}

/** Absolute shareable URL for a slug on the current host. */
export function miniSiteUrl(slug: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${miniSitePath(slug)}`;
}

/** The in-app hash route (used for internal navigation + testing). */
export function miniSiteHashRoute(slug: string): string {
  return `#${miniSitePath(slug)}`;
}

/** Human-friendly short share link (same page, easier to read aloud). */
export function miniSiteShortLabel(slug: string): string {
  return miniSitePath(slug);
}

/**
 * The public Storage URL for a published mini-site. Cache-busted so a fresh
 * publish is visible immediately (the CDN otherwise serves the old copy).
 */
export function miniSiteObjectUrl(slug: string, bust = true): string {
  const url =
    (import.meta as unknown as { env?: Record<string, string> })?.env
      ?.VITE_SUPABASE_URL || "https://ojjscjwatikixlpshmub.supabase.co";
  const base = `${url}/storage/v1/object/public/${BUCKET}/${MINI_SITE_PATH(slug)}`;
  return bust ? `${base}?t=${Date.now()}` : base;
}

// ── published document shape ──────────────────────────────────────────────

export interface PublishedMiniSitePrice {
  label: string;
  code?: string;
  price: number;
  unit?: string;
}

export interface PublishedMiniSite {
  slug: string;
  siteName: string;
  headline: string;
  tagline: string;
  about: string;
  heroImageUrl?: string;
  heroVideoUrl?: string;
  logoUrl?: string;
  currencySymbol: string;
  country?: string;
  address?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  mapUrl?: string;
  theme: MiniSiteTheme;
  sections: MiniSiteSectionKey[];
  services: MiniSiteService[];
  hours: MiniSiteHours[];
  socials: MiniSiteSocials;
  showPricesInHero: boolean;
  allowIndexing: boolean;
  footerNote?: string;
  prices: PublishedMiniSitePrice[];
  team: Array<{ name: string; role: string; bio?: string; photoUrl?: string }>;
  testimonials: Array<{
    author: string;
    company?: string;
    quote: string;
    rating?: number;
  }>;
  faqs: Array<{ question: string; answer: string }>;
  gallery: Array<{ projectName: string; category?: string; imageUrl?: string }>;
  blog: Array<{
    title: string;
    slug?: string;
    excerpt?: string;
    author?: string;
    publishedAt?: string;
    imageUrl?: string;
  }>;
  careers: Array<{
    title: string;
    department?: string;
    location?: string;
    type?: string;
    description?: string;
  }>;
  /** Schema.org type used for the JSON-LD block. */
  schemaType: string;
  publishedAt: number;
  updatedAt: number;
}

// ── normalisation ─────────────────────────────────────────────────────────

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampSections(raw: unknown): MiniSiteSectionKey[] {
  const valid = new Set<string>(MINI_SITE_SECTION_KEYS);
  if (!Array.isArray(raw)) return [...DEFAULT_MINI_SITE_SECTIONS];
  const out = raw
    .map((s) => String(s))
    .filter((s): s is MiniSiteSectionKey => valid.has(s));
  return out.length ? out : [...DEFAULT_MINI_SITE_SECTIONS];
}

export function normalizeMiniSiteConfig(
  raw: Partial<MiniSiteConfig> | null | undefined,
): MiniSiteConfig {
  const d = raw && typeof raw === "object" ? raw : {};
  const themeRaw = (d.theme || {}) as Partial<MiniSiteTheme>;
  const anaRaw = (d.analytics || {}) as Partial<MiniSiteAnalytics>;
  const services = Array.isArray(d.services)
    ? d.services
        .filter((s) => s && typeof s === "object")
        .map((s, i) => ({
          id: str((s as MiniSiteService).id) || `svc_${i}`,
          title: str((s as MiniSiteService).title),
          description: str((s as MiniSiteService).description),
          icon: str((s as MiniSiteService).icon) || undefined,
        }))
        .filter((s) => s.title)
    : [];
  const hours =
    Array.isArray(d.hours) && d.hours.length
      ? // Merge the saved entries onto a full week. A partial array (e.g. only
        // Monday configured) would otherwise render a one-row table and make
        // "open now" report Closed for every other day.
        DEFAULT_HOURS.map((def) => {
          const saved = d.hours!.find(
            (h) => h && typeof h === "object" && num(h.day, -1) === def.day,
          );
          if (!saved) return def;
          return {
            day: def.day,
            open: str(saved.open, def.open),
            close: str(saved.close, def.close),
            closed: !!saved.closed,
          };
        })
      : [...DEFAULT_HOURS];
  return {
    slug: slugify(str(d.slug)),
    published: !!d.published,
    headline: str(d.headline),
    tagline: str(d.tagline),
    about: str(d.about),
    heroImageUrl: str(d.heroImageUrl),
    logoUrl: str(d.logoUrl),
    heroVideoUrl: str(d.heroVideoUrl),
    address: str(d.address),
    phone: str(d.phone),
    whatsapp: str(d.whatsapp),
    email: str(d.email),
    mapUrl: str(d.mapUrl),
    theme: {
      primary: str(themeRaw.primary, DEFAULT_MINI_SITE_CONFIG.theme.primary),
      accent: str(themeRaw.accent, DEFAULT_MINI_SITE_CONFIG.theme.accent),
      surface:
        themeRaw.surface === "light" || themeRaw.surface === "dark"
          ? themeRaw.surface
          : "auto",
      preset:
        themeRaw.preset === "modern" || themeRaw.preset === "bold"
          ? themeRaw.preset
          : "classic",
    },
    sections: clampSections(d.sections),
    services,
    hours,
    socials: (d.socials && typeof d.socials === "object"
      ? d.socials
      : {}) as MiniSiteSocials,
    showPricesInHero: d.showPricesInHero !== false,
    allowIndexing: d.allowIndexing !== false,
    footerNote: str(d.footerNote),
    analytics: {
      views: Math.max(0, Math.round(num(anaRaw.views))),
      countries: Array.isArray(anaRaw.countries)
        ? anaRaw.countries.map((c) => String(c)).slice(0, 30)
        : [],
      shares: Math.max(0, Math.round(num(anaRaw.shares))),
      contactClicks: Math.max(0, Math.round(num(anaRaw.contactClicks))),
      lastViewedAt: Math.max(0, Math.round(num(anaRaw.lastViewedAt))),
    },
    updatedAt: num(d.updatedAt),
    createdAt: num(d.createdAt),
  };
}

// ── owner-side persistence (station-scoped cloud key) ─────────────────────

/** Synchronous cached read for an instant first render. */
export function getCachedMiniSiteConfig(
  stationId?: string,
): MiniSiteConfig | null {
  const cached = cloudStorageService.getCached<Partial<MiniSiteConfig>>(
    CONFIG_KEY,
    stationId,
  );
  if (cached) return normalizeMiniSiteConfig(cached);
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(
            stationId ? `${STORAGE_KEY}_${stationId}` : STORAGE_KEY,
          )
        : null;
    if (raw) return normalizeMiniSiteConfig(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return null;
}

export async function loadMiniSiteConfig(
  stationId?: string,
): Promise<MiniSiteConfig | null> {
  try {
    const raw = await cloudStorageService.get<Partial<MiniSiteConfig>>(
      CONFIG_KEY,
      stationId,
    );
    if (raw) return normalizeMiniSiteConfig(raw);
  } catch (err) {
    console.warn("[mini-site] cloud load failed:", err);
  }
  return getCachedMiniSiteConfig(stationId);
}

export async function saveMiniSiteConfig(
  config: MiniSiteConfig,
  stationId?: string,
): Promise<boolean> {
  const normalized = normalizeMiniSiteConfig({
    ...config,
    updatedAt: Date.now(),
    createdAt: config.createdAt || Date.now(),
  });
  try {
    localStorage.setItem(
      stationId ? `${STORAGE_KEY}_${stationId}` : STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    /* cache only */
  }
  try {
    await cloudStorageService.set(CONFIG_KEY, normalized, stationId);
    return true;
  } catch (err) {
    console.error("[mini-site] cloud save failed:", err);
    return false;
  }
}

// ── new-station defaults from data the station already has ────────────────

export interface MiniSiteSeed {
  name: string;
  code?: string;
  location?: string;
  phone?: string;
  email?: string;
  logo?: string;
  description?: string;
  country?: string;
}

/**
 * Pre-fill the config from the station record so the owner does not retype
 * anything (the motifiti "under 5 minutes" promise). Only EMPTY fields are
 * seeded on first creation.
 */
export function seedMiniSiteConfig(
  seed: MiniSiteSeed,
  existing?: MiniSiteConfig | null,
): MiniSiteConfig {
  const base = existing
    ? normalizeMiniSiteConfig(existing)
    : { ...DEFAULT_MINI_SITE_CONFIG };
  const firstRun = !base.slug;
  return normalizeMiniSiteConfig({
    ...base,
    slug: base.slug || slugFromStationName(seed.name || "", seed.code),
    headline: base.headline || seed.name || "",
    tagline: base.tagline || seed.description || "",
    about: base.about || seed.description || "",
    address: base.address || seed.location || "",
    phone: base.phone || seed.phone || "",
    email: base.email || seed.email || "",
    heroImageUrl: base.heroImageUrl || seed.logo || "",
    logoUrl: base.logoUrl || seed.logo || "",
    createdAt: base.createdAt || Date.now(),
    analytics: base.analytics,
    // A first-ever config starts UNPUBLISHED — publishing is a deliberate act.
    published: firstRun ? false : base.published,
  });
}

// ── public document build + publish ──────────────────────────────────────

export interface MiniSiteContentSource {
  /** Web Studio content (blog/team/testimonials/faqs/portfolio/jobs). */
  webStudio?: {
    blog?: Array<Record<string, unknown>>;
    team?: Array<Record<string, unknown>>;
    testimonials?: Array<Record<string, unknown>>;
    faqs?: Array<Record<string, unknown>>;
    portfolio?: Array<Record<string, unknown>>;
    jobs?: Array<Record<string, unknown>>;
  };
  /** Configured fuel types with their live prices. */
  fuelPrices?: PublishedMiniSitePrice[];
  currencySymbol?: string;
  logoUrl?: string;
  country?: string;
  siteName?: string;
  stationId?: string;
}

/**
 * Build the PUBLIC document from the owner config + station content.
 *
 * Only sections the owner enabled are included, and the marketing arrays are
 * trimmed to a sane size so the published object stays small and cheap to
 * serve. Nothing sensitive is ever copied in.
 */
export function buildPublishedMiniSite(
  config: MiniSiteConfig,
  source: MiniSiteContentSource,
): PublishedMiniSite {
  const cfg = normalizeMiniSiteConfig(config);
  const on = new Set<MiniSiteSectionKey>(cfg.sections);
  const ws = source.webStudio || {};

  const team = on.has("team")
    ? (ws.team || [])
        .map((m) => ({
          name: str(m.name),
          role: str(m.role),
          bio: str(m.bio) || undefined,
          photoUrl: str(m.photoUrl) || undefined,
        }))
        .filter((m) => m.name)
        .slice(0, 24)
    : [];

  const testimonials = on.has("testimonials")
    ? (ws.testimonials || [])
        .map((t) => ({
          author: str(t.author),
          company: str(t.company) || undefined,
          quote: str(t.quote),
          rating: Number.isFinite(Number(t.rating))
            ? Math.max(1, Math.min(5, Math.round(Number(t.rating))))
            : undefined,
        }))
        .filter((t) => t.author && t.quote)
        .slice(0, 24)
    : [];

  const faqs = on.has("faqs")
    ? (ws.faqs || [])
        .map((f) => ({ question: str(f.question), answer: str(f.answer) }))
        .filter((f) => f.question && f.answer)
        .slice(0, 30)
    : [];

  const gallery = on.has("gallery")
    ? (ws.portfolio || [])
        .map((p) => ({
          projectName: str(p.projectName),
          category: str(p.category) || undefined,
          imageUrl: str(p.imageUrl) || undefined,
        }))
        .filter((p) => p.projectName || p.imageUrl)
        .slice(0, 24)
    : [];

  const blog = on.has("blog")
    ? (ws.blog || [])
        // Only PUBLISHED posts ever leave the workspace.
        .filter((b) => String(b.status) === "published")
        .map((b) => ({
          title: str(b.title),
          slug: str(b.slug) || undefined,
          excerpt: str(b.excerpt) || undefined,
          author: str(b.author) || undefined,
          publishedAt: str(b.publishedAt) || undefined,
          imageUrl: str(b.imageUrl) || undefined,
        }))
        .filter((b) => b.title)
        .slice(0, 20)
    : [];

  const careers = on.has("careers")
    ? (ws.jobs || [])
        .filter((j) => String(j.status) !== "closed")
        .map((j) => ({
          title: str(j.title),
          department: str(j.department) || undefined,
          location: str(j.location) || undefined,
          type: str(j.type) || undefined,
          description: str(j.description) || undefined,
        }))
        .filter((j) => j.title)
        .slice(0, 20)
    : [];

  const prices = on.has("prices")
    ? (source.fuelPrices || [])
        .filter((p) => p && p.label && Number.isFinite(p.price) && p.price > 0)
        .map((p) => ({
          label: p.label,
          code: p.code,
          price: p.price,
          unit: p.unit || "L",
        }))
        .slice(0, 12)
    : [];

  return {
    slug: cfg.slug,
    // NOTE: the published document deliberately carries NO station or owner
    // identifier. Readers are anonymous and the object is public, so an id
    // here would hand out an internal reference for no product benefit — the
    // slug is the public identity.
    siteName: source.siteName || cfg.headline || "",
    headline: cfg.headline || source.siteName || "",
    tagline: cfg.tagline,
    about: on.has("about") ? cfg.about : "",
    heroImageUrl: cfg.heroImageUrl || undefined,
    heroVideoUrl: cfg.heroVideoUrl || undefined,
    logoUrl: source.logoUrl || undefined,
    currencySymbol: source.currencySymbol || "$",
    country: source.country,
    address: on.has("location") || on.has("contact") ? cfg.address : undefined,
    phone: on.has("contact") ? cfg.phone : undefined,
    whatsapp: on.has("contact") ? cfg.whatsapp : undefined,
    email: on.has("contact") ? cfg.email : undefined,
    mapUrl: on.has("location") ? cfg.mapUrl : undefined,
    theme: cfg.theme,
    sections: cfg.sections,
    services: on.has("services") ? cfg.services : [],
    hours: on.has("hours") ? cfg.hours : [],
    socials: cfg.socials,
    showPricesInHero: cfg.showPricesInHero,
    allowIndexing: cfg.allowIndexing,
    footerNote: cfg.footerNote || undefined,
    prices,
    team,
    testimonials,
    faqs,
    gallery,
    blog,
    careers,
    schemaType: "GasStation",
    publishedAt: Date.now(),
    // Stamped from the config, not from the clock, so the manager can tell
    // whether the live copy is behind the saved one. Using Date.now() here
    // made every publish look "newer than the config" and pinned the
    // "Unpublished changes" badge on permanently.
    updatedAt: cfg.updatedAt || Date.now(),
  };
}

/**
 * Claim the slug for the signed-in station. The storage policies only permit a
 * write to `mini-site/<slug>/` by the user who claimed that slug, so this must
 * run before `publishMiniSite`. Returns false when another user already holds
 * the slug (the caller then resolves a different one).
 */
export async function claimMiniSiteSlug(slug: string): Promise<boolean> {
  if (!isValidMiniSiteSlug(slug)) return false;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("minisite_claim_slug", {
      p_slug: slug,
    });
    if (error) {
      // The RPC is absent until the migration is applied. Fall back to the
      // client check so publishing still works on an unmigrated project; the
      // storage policy is the real guard once the migration has landed.
      if (/does not exist|Could not find the function/i.test(error.message)) {
        return !(await isSlugTaken(slug));
      }
      console.warn("[mini-site] claim failed:", error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.warn("[mini-site] claim threw:", err);
    return false;
  }
}

export async function publishMiniSite(
  slug: string,
  doc: PublishedMiniSite,
): Promise<boolean> {
  if (!isValidMiniSiteSlug(slug)) return false;
  try {
    const supabase = getSupabaseClient();
    // Establish ownership first — the storage policy requires it.
    if (!(await claimMiniSiteSlug(slug))) {
      console.error("[mini-site] slug is claimed by another station:", slug);
      return false;
    }
    const blob = new Blob([JSON.stringify({ ...doc, slug })], {
      type: "application/json",
    });
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(MINI_SITE_PATH(slug), blob, {
        cacheControl: "60",
        upsert: true,
        contentType: "application/json",
      });
    if (error) {
      console.error("[mini-site] publish failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[mini-site] publish threw:", err);
    return false;
  }
}

/**
 * Remove the published document. Used by "Unpublish" so the public URL
 * genuinely 404s instead of serving a stale copy.
 */
export async function unpublishMiniSite(slug: string): Promise<boolean> {
  if (!isValidMiniSiteSlug(slug)) return false;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([MINI_SITE_PATH(slug)]);
    if (error) {
      // A missing object is not an error for our purposes.
      if (!/not found/i.test(error.message)) {
        console.warn("[mini-site] unpublish:", error.message);
      }
    }
    return true;
  } catch (err) {
    console.warn("[mini-site] unpublish threw:", err);
    return false;
  }
}

/** Fetch the published document (public, anonymous — no Authorization). */
export async function fetchPublishedMiniSite(
  slug: string,
): Promise<PublishedMiniSite | null> {
  if (!isValidMiniSiteSlug(slug)) return null;
  try {
    const res = await fetch(miniSiteObjectUrl(slug, false));
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PublishedMiniSite>;
    if (!data || typeof data !== "object" || !data.slug) return null;
    return data as PublishedMiniSite;
  } catch (err) {
    console.warn("[mini-site] fetch failed:", err);
    return null;
  }
}

/**
 * Check whether a slug is already taken by a DIFFERENT station's published
 * document. The slug IS the address, so two stations cannot share one.
 *
 * The published document deliberately carries no station id, so ownership is
 * established from the owner's OWN saved configuration: if this station's
 * config claims the slug, the document is ours and is not "taken".
 */
export async function isSlugTaken(
  slug: string,
  ownStationId?: string,
): Promise<boolean> {
  const doc = await fetchPublishedMiniSite(slug);
  if (!doc) return false;
  if (ownStationId) {
    const own = await loadMiniSiteConfig(ownStationId);
    if (own && slugify(own.slug) === slugify(slug)) return false;
  }
  return true;
}

/** Resolve a unique slug, suffixing until free. */
export async function resolveUniqueSlug(
  desired: string,
  ownStationId?: string,
): Promise<string> {
  let candidate = slugify(desired);
  if (!isValidMiniSiteSlug(candidate)) {
    candidate = slugFromStationName(desired || "");
  }
  if (!(await isSlugTaken(candidate, ownStationId))) return candidate;
  for (let i = 2; i <= 40; i++) {
    const next = withSlugSuffix(candidate, i);
    if (!(await isSlugTaken(next, ownStationId))) return next;
  }
  return withSlugSuffix(candidate, Date.now().toString(36).slice(-4));
}

// ── analytics (anonymous, best-effort) ───────────────────────────────────

/** Record a public page view through the serverless dispatcher. */
export async function recordMiniSiteView(
  slug: string,
  country?: string,
): Promise<void> {
  if (!isValidMiniSiteSlug(slug)) return;
  const base = grantApiBase();
  if (!base) return;
  try {
    await fetch(`${base}/api/integrations?action=mini-site-view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, country: country || "" }),
      keepalive: true,
    });
  } catch {
    /* analytics must never break the page */
  }
}

/**
 * Read the authoritative view counter for a slug.
 *
 * The counter is non-authoritative by design (it is a convenience tile, and a
 * public page must render correctly even when it is unavailable), so a failure
 * returns null rather than throwing.
 */
export async function fetchMiniSiteViewStats(slug: string): Promise<{
  views: number;
  countries: string[];
  lastViewedAt: number;
} | null> {
  if (!isValidMiniSiteSlug(slug)) return null;
  const base = grantApiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/integrations?action=mini-site-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      success?: boolean;
      views?: number;
      countries?: string[];
      lastViewedAt?: string | null;
    };
    if (!data || data.success === false) return null;
    return {
      views: Math.max(0, Number(data.views) || 0),
      countries: Array.isArray(data.countries) ? data.countries : [],
      lastViewedAt: data.lastViewedAt ? Date.parse(data.lastViewedAt) || 0 : 0,
    };
  } catch {
    return null;
  }
}

/** Record a share/contact interaction (local-only counter is enough). */
export function countMiniSiteShare(slug: string): void {
  try {
    const key = `fuelpro_mini_site_share_${slug}`;
    const n = Number(localStorage.getItem(key) || "0") + 1;
    localStorage.setItem(key, String(n));
  } catch {
    /* ignore */
  }
}

// ── hours helpers ─────────────────────────────────────────────────────────

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function dayLabel(day: number): string {
  return DAY_LABELS[((day % 7) + 7) % 7];
}

/** "06:00" → minutes since midnight (NaN when malformed). */
function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return NaN;
  return h * 60 + min;
}

export interface OpenStatus {
  open: boolean;
  /** "Open until 21:00" / "Closed · opens Monday 06:00" / null when unknown. */
  label: string | null;
}

/**
 * Whether the station is open right now, from the configured hours.
 * Uses the supplied clock so it is deterministic in tests.
 */
export function computeOpenStatus(
  hours: MiniSiteHours[],
  now: Date = new Date(),
): OpenStatus {
  if (!Array.isArray(hours) || !hours.length)
    return { open: false, label: null };
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = hours.find((h) => h.day === day);
  if (today && !today.closed) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (Number.isFinite(open) && Number.isFinite(close)) {
      // Handle overnight trading (close < open, e.g. 22:00 → 05:00).
      const spansMidnight = close <= open;
      const isOpen = spansMidnight
        ? mins >= open || mins < close
        : mins >= open && mins < close;
      if (isOpen) {
        return { open: true, label: `Open until ${today.close}` };
      }
    }
  }
  // Find the next opening (today if still to come, else the next 7 days).
  for (let step = 0; step < 8; step++) {
    const d = (day + step) % 7;
    const h = hours.find((x) => x.day === d);
    if (!h || h.closed) continue;
    const open = toMinutes(h.open);
    if (!Number.isFinite(open)) continue;
    if (step === 0 && mins < open) {
      return { open: false, label: `Closed · opens today ${h.open}` };
    }
    if (step > 0) {
      return { open: false, label: `Closed · opens ${dayLabel(d)} ${h.open}` };
    }
  }
  return { open: false, label: "Closed" };
}

/** Sorted hours for display, starting Monday. */
export function orderedHours(hours: MiniSiteHours[]): MiniSiteHours[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order
    .map((d) => hours.find((h) => h.day === d))
    .filter((h): h is MiniSiteHours => !!h);
}

/** A wa.me link with an optional pre-filled message. */
export function whatsappLink(number: string, message?: string): string {
  const digits = String(number || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${text}`;
}

/** A tel: link. */
export function telLink(number: string): string {
  const cleaned = String(number || "").replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}
