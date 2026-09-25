/**
 * MiniSiteManager — the owner-side control panel for the public station
 * mini site (see mini-site-service.ts and pages/MiniSite.tsx).
 *
 * Reverse-engineered from motive of the motifiti.co.ke "mini site": a dealer
 * signs up and gets a branded public website in minutes. Here the station
 * owner gets the same in one panel:
 *
 *   • Publish / unpublish the public site (the address is the switch)
 *   • A memorable slug (address) with collision resolution
 *   • Branding: preset theme, custom colours, hero image/video, logo
 *   • Content: headline, tagline, about, services, opening hours, socials
 *   • Section-by-section toggles (each one show/hide)
 *   • Share tools: open, copy link, WhatsApp, email, QR + download
 *   • Analytics: views / shares / contact clicks + custom-domain guidance
 *
 * It reads the SAME data the workspace already holds — the station record,
 * the configured fuel types (+ their live prices) and the Web Studio content
 * — so the owner never retypes anything.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Copy,
  Check,
  Share2,
  QrCode,
  Download,
  Palette,
  LayoutGrid,
  Clock,
  Plus,
  Trash2,
  Sparkles,
  BarChart3,
  RefreshCw,
  AlertTriangle,
  Link2,
  Mail,
  Info,
  X,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useAuth } from "@/react-app/context/AuthContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { toastSuccess, toastError, toastWarning } from "@/react-app/lib/toast";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import ExternalMiniSiteManager from "@/react-app/components/ExternalMiniSiteManager";
import {
  MINI_SITE_SECTIONS,
  MINI_SITE_PRESETS,
  DEFAULT_MINI_SITE_CONFIG,
  DEFAULT_HOURS,
  buildPublishedMiniSite,
  fetchPublishedMiniSite,
  getCachedMiniSiteConfig,
  isValidMiniSiteSlug,
  dayLabel,
  loadMiniSiteConfig,
  miniSitePath,
  miniSiteUrl,
  normalizeMiniSiteConfig,
  publishMiniSite,
  fetchMiniSiteViewStats,
  resolveUniqueSlug,
  saveMiniSiteConfig,
  seedMiniSiteConfig,
  slugify,
  unpublishMiniSite,
  whatsappLink,
  type MiniSiteConfig,
  type MiniSiteHours,
  type MiniSiteSectionKey,
  type MiniSiteService,
  type PublishedMiniSite,
  type PublishedMiniSitePrice,
} from "@/react-app/lib/mini-site-service";

const WEB_STUDIO_KEY = "web_studio_content";

type Tab = "publish" | "brand" | "content" | "sections" | "share" | "insights";

export default function MiniSiteManager({
  stationIdOverride,
}: {
  stationIdOverride?: string;
}) {
  const { currentStation } = useStations();
  const { user } = useAuth();
  const state = useFuel().state;
  const stationId = stationIdOverride || currentStation?.id;
  const fuelTypeApi = useStationFuelTypes();

  const [config, setConfig] = useState<MiniSiteConfig>(() => {
    const cached = getCachedMiniSiteConfig(stationId);
    if (cached?.slug) return cached;
    return seedMiniSiteConfig({
      name: currentStation?.name || state.companyData?.name || "",
      code: currentStation?.code,
      location: currentStation?.location || state.companyData?.physicalAddress,
      phone: currentStation?.phone || state.companyData?.contacts,
      email: currentStation?.email || state.companyData?.email,
      logo: currentStation?.logo || state.companyData?.logo,
      country: currentStation?.country,
    });
  });
  const [tab, setTab] = useState<Tab>("publish");
  const [busy, setBusy] = useState(false);
  // Authoritative (server-side) view counter. Kept separate from the locally
  // saved `config.analytics` so a stale local copy can never masquerade as
  // server truth, and so the owner can see whether the service is reachable.
  const [liveStats, setLiveStats] = useState<{
    views: number;
    countries: string[];
    lastViewedAt: number;
  } | null>(null);
  const [refreshingInsights, setRefreshingInsights] = useState(false);
  const [publishedDoc, setPublishedDoc] = useState<PublishedMiniSite | null>(
    null,
  );
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const localModifiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const flagLocalModified = useCallback(() => {
    localModifiedRef.current = true;
    if (localModifiedTimer.current) clearTimeout(localModifiedTimer.current);
    localModifiedTimer.current = setTimeout(() => {
      localModifiedRef.current = false;
    }, 2500);
  }, []);

  const patch = useCallback(
    (delta: Partial<MiniSiteConfig>) => {
      flagLocalModified();
      setConfig((prev) =>
        normalizeMiniSiteConfig({ ...prev, ...delta, updatedAt: Date.now() }),
      );
    },
    [flagLocalModified],
  );

  // ── Load the owner config (cloud) + seed from the station on first run ──
  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;

    (async () => {
      const loaded = await loadMiniSiteConfig(stationId);
      if (cancelled) return;
      const seeded = seedMiniSiteConfig(
        {
          name: currentStation?.name || state.companyData?.name || "",
          code: currentStation?.code,
          location:
            currentStation?.location || state.companyData?.physicalAddress,
          phone: currentStation?.phone || state.companyData?.contacts,
          email: currentStation?.email || state.companyData?.email,
          logo: currentStation?.logo || state.companyData?.logo,
          description: currentStation?.description,
          country: currentStation?.country,
        },
        loaded,
      );
      if (!localModifiedRef.current) setConfig(seeded);
      cloudLoadCompleteRef.current = true;
      // A first-ever config is persisted so the seeded slug is stable.
      if (!loaded) {
        await saveMiniSiteConfig(seeded, stationId);
      }
    })();

    const unsub = cloudStorageService.subscribe<Partial<MiniSiteConfig>>(
      "mini_site_config",
      stationId,
      (val) => {
        if (!localModifiedRef.current && val)
          setConfig(normalizeMiniSiteConfig(val));
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, stationId]);

  // ── Persist the config whenever it changes (after the cloud load) ───────
  useEffect(() => {
    if (!cloudLoadCompleteRef.current) return;
    let cancelled = false;
    saveMiniSiteConfig(config, stationId).then((ok) => {
      if (!cancelled && ok) localModifiedRef.current = false;
    });
    return () => {
      cancelled = true;
    };
  }, [config, stationId]);

  // ── Load the authoritative view counter for the Insights tab ───────────
  // Read-only: opening your own insights must never record a view.
  useEffect(() => {
    if (tab !== "insights" || !config.slug) return;
    let cancelled = false;
    fetchMiniSiteViewStats(config.slug).then((stats) => {
      if (!cancelled && stats) setLiveStats(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [tab, config.slug]);

  // ── Probe whether the published site is currently live ─────────────────
  const checkPublished = useCallback(async () => {
    if (!config.slug) {
      setPublishedDoc(null);
      setChecking(false);
      return;
    }
    setChecking(true);
    const doc = await fetchPublishedMiniSite(config.slug);
    setPublishedDoc(doc);
    setChecking(false);
  }, [config.slug]);

  useEffect(() => {
    void checkPublished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.slug, config.published]);

  // ── QR render (lazy load of the qrcode package) ────────────────────────
  useEffect(() => {
    if (!showQr || !qrRef.current || !config.slug) return;
    let cancelled = false;
    (async () => {
      try {
        const QR = (await import("qrcode")).default;
        if (cancelled || !qrRef.current) return;
        await QR.toCanvas(qrRef.current, miniSiteUrl(config.slug), {
          width: 220,
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
  }, [showQr, config.slug]);

  // ── The public payload inputs ──────────────────────────────────────────
  const webStudio = cloudStorageService.getCached<Record<string, unknown>>(
    WEB_STUDIO_KEY,
    stationId,
  ) as {
    blog?: Array<Record<string, unknown>>;
    team?: Array<Record<string, unknown>>;
    testimonials?: Array<Record<string, unknown>>;
    faqs?: Array<Record<string, unknown>>;
    portfolio?: Array<Record<string, unknown>>;
    jobs?: Array<Record<string, unknown>>;
  } | null;

  const fuelPrices: PublishedMiniSitePrice[] = useMemo(() => {
    const out: PublishedMiniSitePrice[] = [];
    for (const ft of fuelTypeApi.activeFuelTypes || []) {
      const label = ft.localName || ft.name || "";
      if (!label) continue;
      const price = fuelTypeApi.getPriceFor(label);
      if (!Number.isFinite(price) || !price || price <= 0) continue;
      out.push({ label, code: ft.code, price, unit: "L" });
    }
    return out;
  }, [fuelTypeApi]);

  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );

  // Single source for the published document. Callers that have just computed
  // a *newer* config (publish / refresh) pass it in, so the published copy and
  // the saved config can never be built from divergent inputs.
  const buildDoc = useCallback(
    (override?: MiniSiteConfig) =>
      buildPublishedMiniSite(override || config, {
        webStudio: webStudio || undefined,
        fuelPrices,
        currencySymbol,
        logoUrl: currentStation?.logo || state.companyData?.logo,
        country: currentStation?.country,
        siteName: currentStation?.name || state.companyData?.name,
      }),
    [
      config,
      webStudio,
      fuelPrices,
      currencySymbol,
      currentStation,
      state.companyData,
    ],
  );

  // ── Actions ────────────────────────────────────────────────────────────
  const handleSlugChange = (raw: string) => {
    patch({ slug: slugify(raw) });
  };

  const handlePublish = async () => {
    if (!isValidMiniSiteSlug(config.slug)) {
      toastError(
        "Pick a valid web address first — lowercase letters, numbers and dashes.",
      );
      setTab("publish");
      return;
    }
    setBusy(true);
    try {
      // The slug IS the address, so it must be globally unique.
      const unique = await resolveUniqueSlug(config.slug, stationId);
      if (unique !== config.slug) {
        patch({ slug: unique });
        toastWarning(`That address was taken — using "${unique}" instead.`);
      }
      const nextConfig = normalizeMiniSiteConfig({
        ...configRef.current,
        slug: unique,
        published: true,
        updatedAt: Date.now(),
      });
      setConfig(nextConfig);
      await saveMiniSiteConfig(nextConfig, stationId);

      const doc = buildDoc(nextConfig);
      const ok = await publishMiniSite(unique, doc);
      if (!ok) {
        toastError(
          "Publishing failed — check your connection and try again. The site was NOT made public.",
        );
        return;
      }
      // Reflect the exact published copy so the manager and the live page
      // cannot disagree.
      setPublishedDoc(doc);
      toastSuccess(`Live at ${miniSiteUrl(unique)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRepublish = async () => {
    if (!publishedDoc) return handlePublish();
    setBusy(true);
    try {
      const nextConfig = normalizeMiniSiteConfig({
        ...configRef.current,
        updatedAt: Date.now(),
      });
      await saveMiniSiteConfig(nextConfig, stationId);
      const doc = buildDoc(nextConfig);
      const ok = await publishMiniSite(nextConfig.slug, doc);
      if (!ok) {
        toastError("Could not update the live site. Please retry.");
        return;
      }
      setPublishedDoc(doc);
      toastSuccess("Live site updated with your latest changes.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    if (!config.slug) return;
    setBusy(true);
    try {
      const ok = await unpublishMiniSite(config.slug);
      if (!ok) {
        toastError("Could not unpublish. Please retry.");
        return;
      }
      patch({ published: false });
      await saveMiniSiteConfig(
        normalizeMiniSiteConfig({
          ...configRef.current,
          published: false,
        }),
        stationId,
      );
      setPublishedDoc(null);
      toastSuccess("Your site is no longer public.");
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!config.slug) return;
    try {
      await navigator.clipboard.writeText(miniSiteUrl(config.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastWarning("Could not copy — select the address and copy manually.");
    }
  };

  const handleDownloadQr = async () => {
    if (!qrRef.current) return;
    try {
      const url = qrRef.current.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${config.slug}-qr.png`;
      a.click();
    } catch {
      toastWarning("Could not export the QR image.");
    }
  };

  const toggleSection = (key: MiniSiteSectionKey) => {
    const set = new Set(config.sections);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    // Keep the canonical render order rather than click order.
    patch({
      sections: MINI_SITE_SECTIONS.map((s) => s.key).filter((k) => set.has(k)),
    });
  };

  const addService = () => {
    const svc: MiniSiteService = {
      id: `svc_${Date.now().toString(36)}`,
      title: "",
      description: "",
    };
    patch({ services: [...config.services, svc] });
  };
  const updateService = (id: string, delta: Partial<MiniSiteService>) => {
    patch({
      services: config.services.map((s) =>
        s.id === id ? { ...s, ...delta } : s,
      ),
    });
  };
  const removeService = (id: string) => {
    patch({ services: config.services.filter((s) => s.id !== id) });
  };

  const updateHours = (day: number, delta: Partial<MiniSiteHours>) => {
    patch({
      hours: config.hours.map((h) => (h.day === day ? { ...h, ...delta } : h)),
    });
  };

  const applyPreset = (presetId: string) => {
    const preset = MINI_SITE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    patch({
      theme: {
        ...config.theme,
        preset: preset.id,
        primary: preset.primary,
        accent: preset.accent,
      },
    });
  };

  // ── Derived state ──────────────────────────────────────────────────────
  const isLive = !!publishedDoc;
  const slugValid = isValidMiniSiteSlug(config.slug);
  const hasUnpublishedChanges =
    isLive && !!publishedDoc && publishedDoc.updatedAt !== config.updatedAt;

  const tabs: Array<{ id: Tab; label: string; icon: typeof Globe }> = [
    { id: "publish", label: "Publish", icon: Globe },
    { id: "brand", label: "Brand", icon: Palette },
    { id: "content", label: "Content", icon: LayoutGrid },
    { id: "sections", label: "Sections", icon: LayoutGrid },
    { id: "share", label: "Share", icon: Share2 },
    { id: "insights", label: "Insights", icon: BarChart3 },
  ];

  return (
    <div className="space-y-4">
      {/* ── Status banner ───────────────────────────────────────────────── */}
      <div
        className={`rounded-2xl border p-4 ${
          isLive
            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
            : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isLive
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              }`}
            >
              {checking ? (
                <Loader2 className="animate-spin" size={18} />
              ) : isLive ? (
                <Eye size={18} />
              ) : (
                <EyeOff size={18} />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 dark:text-white">
                {checking
                  ? "Checking your site…"
                  : isLive
                    ? "Your mini site is live"
                    : "Your mini site is not published"}
              </p>
              <p className="truncate text-xs text-gray-600 dark:text-gray-400">
                {isLive && config.slug
                  ? miniSiteUrl(config.slug)
                  : "Publish to get a branded website customers can find, share and scan."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasUnpublishedChanges && (
              <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                Unpublished changes
              </span>
            )}
            {isLive && config.slug && (
              <a
                href={miniSitePath(config.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white/10 dark:hover:bg-white/20"
              >
                <ExternalLink size={14} /> Open site
              </a>
            )}
            {isLive ? (
              <>
                <button
                  onClick={handleRepublish}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  Publish changes
                </button>
                <button
                  onClick={handleUnpublish}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-900/20"
                >
                  <EyeOff size={14} /> Unpublish
                </button>
              </>
            ) : (
              <button
                onClick={handlePublish}
                disabled={busy || !slugValid}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <Sparkles size={14} />
                )}
                Publish site
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Sub-tabs ────────────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-all ${
                active
                  ? "bg-white text-amber-600 shadow-sm dark:bg-gray-700 dark:text-amber-400"
                  : "text-gray-600 hover:bg-white/60 dark:text-gray-300 dark:hover:bg-white/5"
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Publish ─────────────────────────────────────────────────────── */}
      {tab === "publish" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
              <Link2 size={16} className="text-amber-500" /> Your web address
            </h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This is the link you share with customers. Lowercase letters,
              numbers and dashes only.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                #/site/
              </span>
              <input
                value={config.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="your-station-name"
                aria-label="Mini site web address"
                className={`min-w-40 flex-1 rounded-lg border px-3 py-2 text-sm bg-white text-gray-900 dark:bg-gray-700 dark:text-white ${
                  config.slug && !slugValid
                    ? "border-red-400"
                    : "border-gray-200 dark:border-gray-600"
                }`}
              />
              <button
                onClick={() =>
                  patch({ slug: slugify(currentStation?.name || "") })
                }
                className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/5"
              >
                Use station name
              </button>
            </div>
            {config.slug && !slugValid && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                <AlertTriangle size={12} /> That address isn&apos;t valid — use
                at least 3 characters (a–z, 0–9, dashes).
              </p>
            )}
            {isLive && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20">
                <Globe size={14} className="text-emerald-600" />
                <code className="min-w-0 flex-1 truncate text-xs text-emerald-800 dark:text-emerald-300">
                  {miniSiteUrl(config.slug)}
                </code>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={
                    whatsappLink(
                      "",
                      `Have a look at our site: ${miniSiteUrl(config.slug)}`,
                    ) ||
                    `https://wa.me/?text=${encodeURIComponent(miniSiteUrl(config.slug))}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  <Share2 size={12} /> Share
                </a>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
              <Sparkles size={16} className="text-amber-500" /> What gets
              published
            </h3>
            <ul className="mt-3 space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
              <li>
                • Branding, headline, about, services and opening hours you set
                below
              </li>
              <li>
                •{" "}
                <strong>
                  {config.sections.includes("prices")
                    ? `${fuelPrices.length} fuel price${fuelPrices.length === 1 ? "" : "s"}`
                    : "Fuel prices (currently hidden)"}
                </strong>{" "}
                from Fuel Type Manager
              </li>
              <li>
                • Published Web Studio content: {(webStudio?.team || []).length}{" "}
                team · {(webStudio?.faqs || []).length} FAQs ·{" "}
                {(webStudio?.testimonials || []).length} testimonials ·{" "}
                {
                  (webStudio?.blog || []).filter(
                    (b) => b.status === "published",
                  ).length
                }{" "}
                published posts
              </li>
              <li className="pt-1 text-xs text-gray-500 dark:text-gray-400">
                Never published: payroll, credit accounts, expenses, customer
                records, staff files or any login credential.
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Brand ───────────────────────────────────────────────────────── */}
      {tab === "brand" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Theme preset
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {MINI_SITE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`rounded-xl border p-3 text-left transition ${
                    config.theme.preset === p.id
                      ? "border-amber-500 ring-1 ring-amber-400"
                      : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-5 w-5 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: p.primary }}
                    />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {p.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {p.description}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                  Primary colour
                </label>
                <input
                  type="color"
                  value={config.theme.primary}
                  onChange={(e) =>
                    patch({
                      theme: {
                        ...config.theme,
                        primary: e.target.value,
                        preset: "classic",
                      },
                    })
                  }
                  aria-label="Primary colour"
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                  Accent colour
                </label>
                <input
                  type="color"
                  value={config.theme.accent}
                  onChange={(e) =>
                    patch({
                      theme: { ...config.theme, accent: e.target.value },
                    })
                  }
                  aria-label="Accent colour"
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-600 dark:bg-gray-700"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Images &amp; video
            </h3>
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                  Hero image URL (used as the banner background)
                </label>
                <input
                  value={config.heroImageUrl}
                  onChange={(e) => patch({ heroImageUrl: e.target.value })}
                  placeholder="https://…/forecourt.jpg"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              {currentStation?.logo && (
                <button
                  onClick={() =>
                    patch({
                      heroImageUrl: currentStation.logo || "",
                    })
                  }
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  Use station logo as hero image
                </button>
              )}
              <div className="flex flex-wrap gap-6 pt-1">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={config.showPricesInHero}
                    onChange={(e) =>
                      patch({ showPricesInHero: e.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  Show prices in the hero
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={config.allowIndexing}
                    onChange={(e) => patch({ allowIndexing: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Let search engines list this site
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {tab === "content" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Basics
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["headline", "Headline", "Publican Energy — Fuel you trust"],
                  ["tagline", "Tagline", "Serving the community since 2015"],
                  ["phone", "Phone", "+254…"],
                  ["whatsapp", "WhatsApp number", "+254…"],
                  ["email", "Email", "hello@station.com"],
                  ["address", "Address", "Moi Avenue, Nairobi"],
                  [
                    "mapUrl",
                    "Map link (optional)",
                    "https://maps.google.com/…",
                  ],
                ] as Array<[keyof MiniSiteConfig, string, string]>
              ).map(([field, label, placeholder]) => (
                <div key={String(field)}>
                  <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                    {label}
                  </label>
                  <input
                    value={String(config[field] ?? "")}
                    onChange={(e) =>
                      patch({ [field]: e.target.value } as never)
                    }
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                About
              </label>
              <textarea
                value={config.about}
                onChange={(e) => patch({ about: e.target.value })}
                rows={4}
                placeholder="Tell customers who you are, what you sell and why they should visit."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
                Footer note (optional)
              </label>
              <input
                value={config.footerNote}
                onChange={(e) => patch({ footerNote: e.target.value })}
                placeholder="Licensed fuel retailer · ETR compliant"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          {/* Services */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Services
              </h3>
              <button
                onClick={addService}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-amber-600"
              >
                <Plus size={13} /> Add service
              </button>
            </div>
            {config.services.length === 0 && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Add what you offer — e.g. Car wash, LPG refill, Tyre service,
                Truck stop.
              </p>
            )}
            <div className="mt-3 space-y-2">
              {config.services.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-2 rounded-xl border border-gray-200 p-3 sm:flex-row dark:border-gray-700"
                >
                  <input
                    value={s.title}
                    onChange={(e) =>
                      updateService(s.id, { title: e.target.value })
                    }
                    placeholder="Service name"
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <input
                    value={s.description}
                    onChange={(e) =>
                      updateService(s.id, { description: e.target.value })
                    }
                    placeholder="Short description"
                    className="flex-[2] rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    onClick={() => removeService(s.id)}
                    aria-label="Remove service"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Hours */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                <Clock size={16} className="text-amber-500" /> Opening hours
              </h3>
              <button
                onClick={() => patch({ hours: [...DEFAULT_HOURS] })}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                Reset to 06:00–21:00
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                const h =
                  config.hours.find((x) => x.day === day) ||
                  ({
                    day,
                    open: "06:00",
                    close: "21:00",
                    closed: false,
                  } as MiniSiteHours);
                return (
                  <div
                    key={day}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="w-24 shrink-0 text-gray-600 dark:text-gray-300">
                      {dayLabel(day)}
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <input
                        type="checkbox"
                        checked={h.closed}
                        onChange={(e) =>
                          updateHours(day, { closed: e.target.checked })
                        }
                        className="h-3.5 w-3.5"
                      />
                      Closed
                    </label>
                    {!h.closed && (
                      <>
                        <input
                          type="time"
                          value={h.open}
                          onChange={(e) =>
                            updateHours(day, { open: e.target.value })
                          }
                          aria-label={`${dayLabel(day)} opening time`}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                        <span className="text-gray-400">–</span>
                        <input
                          type="time"
                          value={h.close}
                          onChange={(e) =>
                            updateHours(day, { close: e.target.value })
                          }
                          aria-label={`${dayLabel(day)} closing time`}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Socials */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Social links
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  "facebook",
                  "instagram",
                  "x",
                  "tiktok",
                  "youtube",
                  "linkedin",
                ] as const
              ).map((k) => (
                <div key={k}>
                  <label className="mb-1 block text-xs capitalize text-gray-500 dark:text-gray-400">
                    {k}
                  </label>
                  <input
                    value={config.socials?.[k] || ""}
                    onChange={(e) =>
                      patch({
                        socials: { ...config.socials, [k]: e.target.value },
                      })
                    }
                    placeholder="https://…"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Sections ────────────────────────────────────────────────────── */}
      {tab === "sections" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-white">
            Sections on your site
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Turn sections on or off. A section with no content is skipped
            automatically, so the page never shows an empty block.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MINI_SITE_SECTIONS.map((s) => {
              const on = config.sections.includes(s.key);
              return (
                <label
                  key={s.key}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                    on
                      ? "border-amber-400 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-900/10"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleSection(s.key)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">
                      {s.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {s.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Share ───────────────────────────────────────────────────────── */}
      {tab === "share" && (
        <div className="space-y-4">
          <ExternalMiniSiteManager stationIdOverride={stationId} stationConfig={config} />
          {!isLive ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Publish your site first, then come back to share it.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  Share your site
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                    {miniSiteUrl(config.slug)}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white dark:bg-white/10"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `${config.headline || currentStation?.name || ""} — ${miniSiteUrl(config.slug)}`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <Share2 size={13} /> WhatsApp
                  </a>
                  <a
                    href={`mailto:?subject=${encodeURIComponent(
                      config.headline || currentStation?.name || "Our site",
                    )}&body=${encodeURIComponent(miniSiteUrl(config.slug))}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
                  >
                    <Mail size={13} /> Email
                  </a>
                  <a
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(miniSiteUrl(config.slug))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
                  >
                    <Share2 size={13} /> Facebook
                  </a>
                  <button
                    onClick={() => setShowQr(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
                  >
                    <QrCode size={13} /> QR code
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
                <h3 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                  <Info size={15} className="text-amber-500" /> Use your own
                  domain
                </h3>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  A mini site like Motifiti&apos;s works on its own address. To
                  serve it from your own domain (e.g.{" "}
                  <em>publicanenergy.co.ke</em>), point a DNS record at your
                  hosting and forward the path <code>#/site/{config.slug}</code>{" "}
                  — the site itself is already generated, so nothing has to be
                  rebuilt on the new domain.
                </p>
                <ul className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <li>1. Keep the published address as-is.</li>
                  <li>
                    2. On your domain, add a 302 redirect to this page (or a
                    CNAME if your host supports proxying).
                  </li>
                  <li>
                    3. Turn off &quot;Let search engines list this site&quot;
                    only if you want the FuelPro address hidden.
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Insights ────────────────────────────────────────────────────── */}
      {tab === "insights" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: "Views",
                value: liveStats ? liveStats.views : config.analytics.views,
                icon: Eye,
              },
              {
                label: "Shares",
                value: config.analytics.shares,
                icon: Share2,
              },
              {
                label: "Contact clicks",
                value: config.analytics.contactClicks,
                icon: Mail,
              },
              {
                label: "Last viewed",
                value: (() => {
                  const ts =
                    liveStats?.lastViewedAt || config.analytics.lastViewedAt;
                  return ts ? new Date(ts).toLocaleDateString() : "—";
                })(),
                icon: Clock,
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                    <Icon size={14} />
                    <span className="text-xs">{card.label}</span>
                  </div>
                  <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                    {card.value}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Page views
              </h3>
              <button
                onClick={async () => {
                  // READ the authoritative counter. This must never record a
                  // view — the owner browsing their own insights would
                  // otherwise inflate their own numbers.
                  if (!config.slug) return;
                  setRefreshingInsights(true);
                  try {
                    const stats = await fetchMiniSiteViewStats(config.slug);
                    if (stats) {
                      setLiveStats(stats);
                      toastSuccess("Insights refreshed");
                    } else {
                      toastError("Could not reach the analytics service");
                    }
                  } finally {
                    setRefreshingInsights(false);
                  }
                }}
                disabled={refreshingInsights}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-60 dark:border-gray-600 dark:text-gray-300"
              >
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {liveStats
                ? `Live counter: ${liveStats.views} view${
                    liveStats.views === 1 ? "" : "s"
                  }${
                    liveStats.countries.length
                      ? ` · ${liveStats.countries.length} countr${
                          liveStats.countries.length === 1 ? "y" : "ies"
                        }`
                      : ""
                  }. Counts anonymous visitors to your public page.`
                : "Views count anonymous visitors to your public page. Press Refresh to load the live counter."}
            </p>
            {config.analytics.countries.length > 0 && (
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                Recent visitor countries:{" "}
                {config.analytics.countries.slice(0, 12).join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── QR modal ────────────────────────────────────────────────────── */}
      {showQr && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Mini site QR code"
          onClick={() => setShowQr(false)}
        >
          <div
            className="rounded-2xl bg-white p-6 text-center dark:bg-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-semibold text-gray-900 dark:text-white">
                Scan to open
              </p>
              <button
                onClick={() => setShowQr(false)}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <canvas ref={qrRef} className="mx-auto rounded-lg" />
            <div className="mt-4 flex justify-center gap-2">
              <button
                onClick={handleDownloadQr}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white dark:bg-white/10"
              >
                <Download size={13} /> Download PNG
              </button>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />} Copy link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Re-exported so consumers can render a preview without importing the lib. */
export { DEFAULT_MINI_SITE_CONFIG };
