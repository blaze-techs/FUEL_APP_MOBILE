/**
 * MiniSite — the PUBLIC, no-login website for a station.
 *
 * Reverse-engineered from the motifiti.co.ke "mini site": a business gets an
 * auto-generated, branded, shareable website in minutes instead of building
 * one. Here the station owner flips a switch and this page becomes their
 * station's public site at
 *   https://fuel-app-mobile.pages.dev/#/site/<slug>
 *
 * It is read by ANONYMOUS visitors (customers, suppliers, search engines), so
 * it never touches the Supabase session or app_kv — it reads ONLY the compact
 * document the owner explicitly published to the public Storage object
 * `mini-site/<slug>/site.json` (see mini-site-service.ts).
 *
 * Render rules that keep it honest:
 *  • Only the sections the owner enabled are shown at all.
 *  • A section with no content is skipped silently (no empty shells).
 *  • Prices come from the published snapshot — the exact figures the owner
 *    published. Missing prices are simply not shown (never a substitute).
 *  • The open/closed badge is COMPUTED from the published hours, so it is
 *    correct in the visitor's timezone-agnostic station clock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router";
import {
  Fuel,
  Phone,
  Mail,
  MapPin,
  Clock,
  ShieldCheck,
  Star,
  Users,
  Images,
  Newspaper,
  Briefcase,
  Share2,
  QrCode,
  Navigation,
  ExternalLink,
  Loader2,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  HelpCircle,
  Copy,
  Check,
  X,
} from "lucide-react";
import {
  fetchPublishedMiniSite,
  recordMiniSiteView,
  computeOpenStatus,
  orderedHours,
  dayLabel,
  whatsappLink,
  telLink,
  miniSiteUrl,
  countMiniSiteShare,
  type PublishedMiniSite,
  type MiniSiteSectionKey,
} from "@/react-app/lib/mini-site-service";
import { SUPPORT_EMAIL } from "@/react-app/config/support-contact";
import { resolveCountryCode } from "@/react-app/lib/geo-utils";

type LoadState = "loading" | "missing" | "ready";

/** Per-preset page chrome (kept out of the DB so a preset change is instant). */
const PRESET_CLASSES: Record<
  string,
  { hero: string; card: string; chip: string }
> = {
  classic: {
    hero: "bg-gradient-to-br from-slate-900 via-slate-900 to-black",
    card: "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800",
    chip: "bg-black/5 dark:bg-white/10",
  },
  modern: {
    hero: "bg-gradient-to-br from-sky-900 via-slate-900 to-slate-950",
    card: "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800",
    chip: "bg-black/5 dark:bg-white/10",
  },
  bold: {
    hero: "bg-gradient-to-br from-emerald-950 via-slate-900 to-black",
    card: "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800",
    chip: "bg-black/5 dark:bg-white/10",
  },
};

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
  accent,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle?: string;
  accent: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          <Icon size={18} />
        </span>
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
          {title}
        </h2>
      </div>
      {subtitle && (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          {subtitle}
        </p>
      )}
    </div>
  );
}

function MiniSiteSection({
  children,
  id,
  className = "",
}: {
  children: React.ReactNode;
  id: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`mx-auto w-full max-w-5xl px-4 sm:px-6 py-10 sm:py-14 ${className}`}
    >
      {children}
    </section>
  );
}

function Stars({ rating }: { rating?: number }) {
  if (!rating) return null;
  return (
    <div
      className="flex items-center gap-0.5"
      aria-label={`${rating} out of 5`}
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={14}
          className={
            i < rating
              ? "fill-amber-400 text-amber-400"
              : "text-slate-300 dark:text-slate-600"
          }
        />
      ))}
    </div>
  );
}

export default function MiniSite() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>("loading");
  const [doc, setDoc] = useState<PublishedMiniSite | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const countedRef = useRef(false);

  // ── Load the published document ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setDoc(null);
    countedRef.current = false;

    (async () => {
      const published = await fetchPublishedMiniSite(slug);
      if (cancelled) return;
      if (!published) {
        setState("missing");
        return;
      }
      setDoc(published);
      setState("ready");

      // Best-effort, once per page load. Never blocks rendering.
      if (!countedRef.current) {
        countedRef.current = true;
        void recordMiniSiteView(slug, safeCountryCode());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // ── SEO: title, description, canonical, robots, JSON-LD ────────────────
  useEffect(() => {
    if (!doc) return;
    const title = `${doc.headline || doc.siteName}${doc.tagline ? ` — ${doc.tagline}` : ""}`;
    const description =
      doc.about ||
      `${doc.siteName}${doc.address ? `, ${doc.address}` : ""}. Fuel prices, services and contact details.`;
    const url = miniSiteUrl(slug);

    document.title = title;
    const setMeta = (
      attr: "name" | "property",
      key: string,
      content: string,
    ) => {
      let el = document.head.querySelector<HTMLMetaElement>(
        `meta[${attr}="${key}"]`,
      );
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    const robots = doc.allowIndexing ? "index, follow" : "noindex, nofollow";
    setMeta("name", "description", description);
    setMeta("name", "robots", robots);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", url);
    setMeta("property", "og:type", "website");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    if (doc.heroImageUrl) {
      setMeta("property", "og:image", doc.heroImageUrl);
      setMeta("name", "twitter:image", doc.heroImageUrl);
    }

    let canonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = url;

    // Schema.org — a rich result only when the owner permits indexing.
    const ldId = "ld-mini-site";
    document.getElementById(ldId)?.remove();
    if (doc.allowIndexing) {
      const sameAs = Object.values(doc.socials || {}).filter(Boolean);
      const node = document.createElement("script");
      node.type = "application/ld+json";
      node.id = ldId;
      node.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": doc.schemaType || "GasStation",
        name: doc.siteName,
        description,
        url,
        image: doc.heroImageUrl || undefined,
        telephone: doc.phone || undefined,
        email: doc.email || undefined,
        address: doc.address
          ? { "@type": "PostalAddress", streetAddress: doc.address }
          : undefined,
        sameAs: sameAs.length ? sameAs : undefined,
        openingHours: (doc.hours || [])
          .filter((h) => !h.closed)
          .map((h) => `${dayAbbrev(h.day)} ${h.open}-${h.close}`),
      });
      document.head.appendChild(node);
    }

    return () => {
      document.getElementById(ldId)?.remove();
    };
  }, [doc, slug]);

  // ── QR code (lazy: the `qrcode` package is only loaded when asked) ─────
  useEffect(() => {
    if (!showQr || !qrRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const QR = (await import("qrcode")).default;
        if (cancelled || !qrRef.current) return;
        await QR.toCanvas(qrRef.current, miniSiteUrl(slug), {
          width: 240,
          margin: 1,
          color: { dark: "#0f172a", light: "#ffffff" },
          errorCorrectionLevel: "M",
        });
      } catch (err) {
        console.warn("[mini-site] QR render failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showQr, slug]);

  const sections = useMemo(
    () => new Set<MiniSiteSectionKey>(doc?.sections || []),
    [doc],
  );
  const preset =
    PRESET_CLASSES[doc?.theme?.preset || "classic"] || PRESET_CLASSES.classic;

  const openStatus = useMemo(() => computeOpenStatus(doc?.hours || []), [doc]);

  const waLink = useMemo(
    () =>
      whatsappLink(
        doc?.whatsapp || doc?.phone || "",
        `Hello ${doc?.siteName || ""}, I found you online and have a question.`,
      ),
    [doc],
  );
  const mapUrl = useMemo(() => {
    if (doc?.mapUrl) return doc.mapUrl;
    if (!doc?.address) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      doc.address,
    )}`;
  }, [doc]);

  const handleShare = useCallback(async () => {
    const url = miniSiteUrl(slug);
    const data = {
      title: doc?.headline || doc?.siteName || "Fuel station",
      text: doc?.tagline || doc?.siteName || "",
      url,
    };
    countMiniSiteShare(slug);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      /* user cancelled — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the URL is visible in the address bar */
    }
  }, [doc, slug]);

  // ── SEO for the NOT-FOUND state ────────────────────────────────────────
  // The page still returns HTTP 200 (it is a client-rendered SPA), so
  // without this it is a soft 404 that inherits the app's default canonical
  // and `index, follow` — i.e. Google would index the withdrawn link under
  // FuelPro's own URL. Force noindex and drop the canonical so a removed
  // mini site genuinely disappears from search.
  useEffect(() => {
    if (state !== "missing") return;
    document.title = "Site not found — FuelPro";
    const setMeta = (
      attr: "name" | "property",
      key: string,
      content: string,
    ) => {
      let el = document.head.querySelector<HTMLMetaElement>(
        `meta[${attr}="${key}"]`,
      );
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("name", "robots", "noindex, nofollow");
    setMeta("name", "description", "This station site is not available.");
    document.head
      .querySelectorAll('link[rel="canonical"], #ld-mini-site')
      .forEach((n) => n.remove());
  }, [state]);

  // ── States ──────────────────────────────────────────────────────────────
  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="animate-spin" size={28} />
          <p className="text-sm">Loading site…</p>
        </div>
      </div>
    );
  }

  if (state === "missing" || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full text-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
            <AlertTriangle className="text-amber-500" size={26} />
          </div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            This site isn&apos;t available
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            The link may have been withdrawn by the station, or the address is
            mistyped.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-amber-600"
          >
            Go to FuelPro <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  const primary = doc.theme?.primary || "#c5a059";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className={`relative ${preset.hero} text-white`}>
        {doc.heroImageUrl && (
          <img
            src={doc.heroImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-25"
          />
        )}
        <div className="relative mx-auto w-full max-w-5xl px-4 sm:px-6 py-10 sm:py-16">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {doc.logoUrl ? (
                <img
                  src={doc.logoUrl}
                  alt={`${doc.siteName} logo`}
                  className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-white/20"
                />
              ) : (
                <span
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: primary }}
                >
                  <Fuel size={20} className="text-slate-900" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-lg font-bold">{doc.siteName}</p>
                {doc.address && (
                  <p className="truncate text-xs text-white/70">
                    {doc.address}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {openStatus.label && (
                <span
                  className={`hidden sm:inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                    openStatus.open
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-white/10 text-white/80"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${openStatus.open ? "bg-emerald-400" : "bg-white/50"}`}
                  />
                  {openStatus.open ? "Open now" : "Closed"}
                </span>
              )}
              <button
                type="button"
                onClick={handleShare}
                aria-label="Share this site"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              >
                {copied ? <Check size={16} /> : <Share2 size={16} />}
              </button>
              <button
                type="button"
                onClick={() => setShowQr(true)}
                aria-label="Show QR code"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              >
                <QrCode size={16} />
              </button>
            </div>
          </div>

          <h1 className="mt-8 text-3xl sm:text-5xl font-black leading-tight max-w-3xl">
            {doc.headline || doc.siteName}
          </h1>
          {doc.tagline && (
            <p className="mt-3 max-w-2xl text-sm sm:text-base text-white/80">
              {doc.tagline}
            </p>
          )}

          {/* Live prices in the hero — the most-asked question answered first */}
          {doc.showPricesInHero && doc.prices.length > 0 && (
            <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {doc.prices.slice(0, 4).map((p) => (
                <div
                  key={`${p.label}-${p.code || ""}`}
                  className="rounded-xl bg-white/10 backdrop-blur px-3 py-3 ring-1 ring-white/10"
                >
                  <p className="text-[11px] uppercase tracking-wide text-white/60">
                    {p.label}
                  </p>
                  <p className="mt-1 text-lg font-bold tabular-nums">
                    {doc.currencySymbol}
                    {Number(p.price).toFixed(2)}
                    <span className="text-xs font-normal text-white/60">
                      /{p.unit || "L"}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Primary calls to action */}
          <div className="mt-8 flex flex-wrap gap-3">
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:brightness-110"
                style={{ backgroundColor: primary }}
              >
                <Phone size={15} /> WhatsApp us
              </a>
            )}
            {mapUrl && (
              <a
                href={mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/20"
              >
                <Navigation size={15} /> Get directions
              </a>
            )}
            {doc.phone && (
              <a
                href={telLink(doc.phone)}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/20"
              >
                <Phone size={15} /> Call
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── About ────────────────────────────────────────────────────────── */}
      {sections.has("about") && doc.about && (
        <MiniSiteSection id="about">
          <SectionHeading
            icon={ShieldCheck}
            title="About us"
            accent={primary}
          />
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
            {doc.about}
          </p>
        </MiniSiteSection>
      )}

      {/* ── Services ─────────────────────────────────────────────────────── */}
      {sections.has("services") && doc.services.length > 0 && (
        <MiniSiteSection id="services">
          <SectionHeading
            icon={Star}
            title="What we offer"
            subtitle="Services available at this station."
            accent={primary}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {doc.services.map((s) => (
              <div
                key={s.id}
                className={`rounded-2xl border p-4 ${preset.card}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${primary}1a`, color: primary }}
                  >
                    <ShieldCheck size={17} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 dark:text-white">
                      {s.title}
                    </h3>
                    {s.description && (
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {s.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Full price list ──────────────────────────────────────────────── */}
      {sections.has("prices") && doc.prices.length > 0 && (
        <MiniSiteSection id="prices">
          <SectionHeading
            icon={Fuel}
            title="Today's fuel prices"
            subtitle="Prices published by the station."
            accent={primary}
          />
          <div className={`overflow-hidden rounded-2xl border ${preset.card}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Fuel</th>
                  <th className="px-4 py-3 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {doc.prices.map((p) => (
                  <tr
                    key={`${p.label}-${p.code || ""}`}
                    className="border-b border-slate-100 dark:border-slate-800/60 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                      {p.label}
                      {p.code && (
                        <span className="ml-2 text-xs text-slate-400">
                          {p.code}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">
                      {doc.currencySymbol}
                      {Number(p.price).toFixed(2)}
                      <span className="text-xs font-normal text-slate-400">
                        /{p.unit || "L"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MiniSiteSection>
      )}

      {/* ── Hours ────────────────────────────────────────────────────────── */}
      {sections.has("hours") && doc.hours.length > 0 && (
        <MiniSiteSection id="hours">
          <SectionHeading
            icon={Clock}
            title="Opening hours"
            accent={primary}
            subtitle={openStatus.label || undefined}
          />
          <div
            className={`rounded-2xl border divide-y divide-slate-100 dark:divide-slate-800 ${preset.card}`}
          >
            {orderedHours(doc.hours).map((h) => (
              <div
                key={h.day}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="text-slate-600 dark:text-slate-300">
                  {dayLabel(h.day)}
                </span>
                <span
                  className={`font-medium tabular-nums ${
                    h.closed
                      ? "text-slate-400"
                      : "text-slate-900 dark:text-white"
                  }`}
                >
                  {h.closed ? "Closed" : `${h.open} – ${h.close}`}
                </span>
              </div>
            ))}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Team ─────────────────────────────────────────────────────────── */}
      {sections.has("team") && doc.team.length > 0 && (
        <MiniSiteSection id="team">
          <SectionHeading icon={Users} title="Our team" accent={primary} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {doc.team.map((m) => (
              <div
                key={`${m.name}-${m.role}`}
                className={`rounded-2xl border p-4 text-center ${preset.card}`}
              >
                {m.photoUrl ? (
                  <img
                    src={m.photoUrl}
                    alt={m.name}
                    className="mx-auto h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold"
                    style={{ backgroundColor: `${primary}1a`, color: primary }}
                  >
                    {m.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <p className="mt-3 font-semibold text-slate-900 dark:text-white">
                  {m.name}
                </p>
                {m.role && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {m.role}
                  </p>
                )}
                {m.bio && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {m.bio}
                  </p>
                )}
              </div>
            ))}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      {sections.has("testimonials") && doc.testimonials.length > 0 && (
        <MiniSiteSection id="testimonials">
          <SectionHeading
            icon={Star}
            title="What customers say"
            accent={primary}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {doc.testimonials.map((t) => (
              <figure
                key={`${t.author}-${t.quote.slice(0, 12)}`}
                className={`rounded-2xl border p-5 ${preset.card}`}
              >
                <Stars rating={t.rating} />
                <blockquote className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  “{t.quote}”
                </blockquote>
                <figcaption className="mt-3 text-xs font-medium text-slate-500">
                  {t.author}
                  {t.company ? ` · ${t.company}` : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        </MiniSiteSection>
      )}

      {/* ── FAQs ─────────────────────────────────────────────────────────── */}
      {sections.has("faqs") && doc.faqs.length > 0 && (
        <MiniSiteSection id="faqs">
          <SectionHeading
            icon={HelpCircle}
            title="Frequently asked questions"
            accent={primary}
          />
          <div className="space-y-2">
            {doc.faqs.map((f, i) => (
              <details
                key={`${f.question}-${i}`}
                className={`group rounded-xl border p-4 ${preset.card}`}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-slate-900 dark:text-white">
                  {f.question}
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {f.answer}
                </p>
              </details>
            ))}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Gallery ──────────────────────────────────────────────────────── */}
      {sections.has("gallery") && doc.gallery.length > 0 && (
        <MiniSiteSection id="gallery">
          <SectionHeading icon={Images} title="Gallery" accent={primary} />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {doc.gallery.map((g, i) =>
              g.imageUrl ? (
                <figure
                  key={`${g.projectName}-${i}`}
                  className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
                >
                  <img
                    src={g.imageUrl}
                    alt={g.projectName || `Gallery image ${i + 1}`}
                    loading="lazy"
                    className="h-36 w-full object-cover"
                  />
                  {g.projectName && (
                    <figcaption className="px-2 py-1.5 text-xs text-slate-500 truncate">
                      {g.projectName}
                    </figcaption>
                  )}
                </figure>
              ) : null,
            )}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Blog / news ──────────────────────────────────────────────────── */}
      {sections.has("blog") && doc.blog.length > 0 && (
        <MiniSiteSection id="news">
          <SectionHeading
            icon={Newspaper}
            title="News & updates"
            accent={primary}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {doc.blog.map((b, i) => (
              <article
                key={`${b.title}-${i}`}
                className={`overflow-hidden rounded-2xl border ${preset.card}`}
              >
                {b.imageUrl && (
                  <img
                    src={b.imageUrl}
                    alt=""
                    loading="lazy"
                    className="h-36 w-full object-cover"
                  />
                )}
                <div className="p-4">
                  <h3 className="font-semibold text-slate-900 dark:text-white">
                    {b.title}
                  </h3>
                  {b.excerpt && (
                    <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400 line-clamp-3">
                      {b.excerpt}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-slate-400">
                    {b.author || ""}
                    {b.publishedAt
                      ? `${b.author ? " · " : ""}${formatDate(b.publishedAt)}`
                      : ""}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Careers ──────────────────────────────────────────────────────── */}
      {sections.has("careers") && doc.careers.length > 0 && (
        <MiniSiteSection id="careers">
          <SectionHeading
            icon={Briefcase}
            title="Careers"
            subtitle="We're hiring — reach out to apply."
            accent={primary}
          />
          <div className="space-y-3">
            {doc.careers.map((c, i) => (
              <div
                key={`${c.title}-${i}`}
                className={`rounded-2xl border p-4 ${preset.card}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-white">
                    {c.title}
                  </h3>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {c.department && (
                      <span
                        className={`rounded-full px-2 py-0.5 ${preset.chip}`}
                      >
                        {c.department}
                      </span>
                    )}
                    {c.location && (
                      <span
                        className={`rounded-full px-2 py-0.5 ${preset.chip}`}
                      >
                        {c.location}
                      </span>
                    )}
                    {c.type && (
                      <span
                        className={`rounded-full px-2 py-0.5 ${preset.chip}`}
                      >
                        {c.type}
                      </span>
                    )}
                  </div>
                </div>
                {c.description && (
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                    {c.description}
                  </p>
                )}
                {doc.email && (
                  <a
                    href={`mailto:${doc.email}?subject=${encodeURIComponent(
                      `Application: ${c.title}`,
                    )}`}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold"
                    style={{ color: primary }}
                  >
                    Apply by email <ExternalLink size={13} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Contact ──────────────────────────────────────────────────────── */}
      {(sections.has("contact") || sections.has("location")) && (
        <MiniSiteSection id="contact">
          <SectionHeading icon={Phone} title="Get in touch" accent={primary} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(doc.phone || doc.whatsapp || doc.email) && (
              <div className={`rounded-2xl border p-5 ${preset.card}`}>
                <h3 className="font-semibold text-slate-900 dark:text-white">
                  Contact
                </h3>
                <div className="mt-3 space-y-2 text-sm">
                  {doc.phone && (
                    <a
                      href={telLink(doc.phone)}
                      className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Phone size={15} /> {doc.phone}
                    </a>
                  )}
                  {doc.email && (
                    <a
                      href={`mailto:${doc.email}`}
                      className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white break-all"
                    >
                      <Mail size={15} /> {doc.email}
                    </a>
                  )}
                  {waLink && (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 font-medium"
                      style={{ color: primary }}
                    >
                      <Phone size={15} /> Chat on WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )}
            {doc.address && sections.has("location") && (
              <div className={`rounded-2xl border p-5 ${preset.card}`}>
                <h3 className="font-semibold text-slate-900 dark:text-white">
                  Location
                </h3>
                <p className="mt-3 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <MapPin size={15} className="mt-0.5 shrink-0" />
                  {doc.address}
                </p>
                {mapUrl && (
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold"
                    style={{ color: primary }}
                  >
                    Open in maps <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}
          </div>
        </MiniSiteSection>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">
                {doc.siteName}
              </p>
              {doc.footerNote && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {doc.footerNote}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {Object.entries(doc.socials || {}).map(([k, v]) =>
                v ? (
                  <a
                    key={k}
                    href={v}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="capitalize hover:text-slate-900 dark:hover:text-white"
                  >
                    {k}
                  </a>
                ) : null,
              )}
              <button
                type="button"
                onClick={handleShare}
                className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-white"
              >
                <Share2 size={12} /> Share
              </button>
            </div>
          </div>
          <p className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-4 text-[11px] text-slate-400">
            This site was published by {doc.siteName} using FuelPro. Questions
            about this station?{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline hover:text-slate-600"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </footer>

      {/* ── QR modal ─────────────────────────────────────────────────────── */}
      {showQr && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="QR code for this site"
          onClick={() => setShowQr(false)}
        >
          <div
            className="rounded-2xl bg-white dark:bg-slate-900 p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-slate-900 dark:text-white">
                Scan to open
              </p>
              <button
                type="button"
                onClick={() => setShowQr(false)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>
            <canvas ref={qrRef} className="mx-auto rounded-lg" />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(miniSiteUrl(slug));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2200);
                } catch {
                  /* ignore */
                }
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function dayAbbrev(day: number): string {
  return ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][((day % 7) + 7) % 7];
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function safeCountryCode(): string {
  try {
    return resolveCountryCode("");
  } catch {
    return "";
  }
}
