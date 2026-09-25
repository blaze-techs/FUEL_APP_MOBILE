/**
 * MiniSiteLink — the public mini-site link, embedded in the places where the
 * owner is already talking to a customer.
 *
 * A published mini site is the natural thing to hand someone: it is public, it
 * needs no login, and it already carries the live prices and opening hours. The
 * manager in Web Studio is where the site is *edited*; this is where its link
 * gets *used* — attached to a credit statement, an invoice, a broadcast.
 *
 * It reads the same `mini_site_config` the manager writes, so it can never
 * disagree with what was published, and it never publishes anything itself.
 * When nothing is published it says so and points at Web Studio rather than
 * offering a link that would 404.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Globe, MessageCircle } from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import {
  getCachedMiniSiteConfig,
  loadMiniSiteConfig,
  miniSitePath,
  miniSiteUrl,
  type MiniSiteConfig,
} from "@/react-app/lib/mini-site-service";
import { navigateToTab } from "@/react-app/lib/mpesa-integration-service";
import { toastSuccess } from "@/react-app/lib/toast";

interface MiniSiteLinkProps {
  /** Defaults to the current station. */
  stationId?: string;
  /**
   * Text that precedes the link when shared. Callers pass their own context
   * ("Your statement is ready") so one message goes out, not two.
   */
  shareIntro?: string;
  /** `panel` is the bordered card; `inline` is a single compact row. */
  variant?: "panel" | "inline";
  className?: string;
}

/** Open Web Studio straight on the Mini Site section. */
function openMiniSiteManager(): void {
  navigateToTab("webstudio", { subTab: "mini" });
}

export default function MiniSiteLink({
  stationId: stationIdProp,
  shareIntro,
  variant = "panel",
  className = "",
}: MiniSiteLinkProps) {
  const { currentStation } = useStations();
  const stationId = stationIdProp ?? currentStation?.id;

  const [config, setConfig] = useState<MiniSiteConfig | null>(() =>
    getCachedMiniSiteConfig(stationId),
  );

  useEffect(() => {
    let cancelled = false;
    // Instant paint from cache, then the authoritative cloud copy.
    setConfig(getCachedMiniSiteConfig(stationId));
    void loadMiniSiteConfig(stationId).then((loaded) => {
      if (!cancelled && loaded) setConfig(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const published = Boolean(config?.published && config?.slug);
  const url = published && config ? miniSiteUrl(config.slug) : "";
  const path = published && config ? miniSitePath(config.slug) : "";

  const copy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess("Public site link copied.");
    } catch {
      toastSuccess(`Copy manually: ${url}`);
    }
  }, [url]);

  const share = useCallback(() => {
    if (!url) return;
    const text = shareIntro ? `${shareIntro}\n${url}` : url;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener",
    );
  }, [url, shareIntro]);

  // Nothing published: say so, and send the owner somewhere useful instead of
  // offering a link that would not resolve.
  if (!published) {
    if (variant === "inline") return null;
    return (
      <div
        className={`rounded border border-dashed border-gray-300 dark:border-gray-600 p-3 ${className}`}
      >
        <p className="text-xs text-gray-600 dark:text-gray-400">
          No public mini site is published for this station yet, so there is no
          link to share.
        </p>
        <button
          onClick={openMiniSiteManager}
          className="btn btn-secondary !p-2 !text-xs mt-2"
        >
          <Globe className="w-3 h-3" /> Publish in Web Studio
        </button>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-600 dark:text-sky-400 underline text-xs"
        >
          {path}
        </a>
        <button
          onClick={copy}
          title="Copy the public site link"
          aria-label="Copy the public site link"
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/10"
        >
          <Copy className="w-3 h-3" />
        </button>
      </span>
    );
  }

  return (
    <div
      className={`rounded border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/20 p-3 space-y-2 ${className}`}
    >
      <div className="flex items-center gap-2">
        <Globe className="w-4 h-4 text-sky-500 shrink-0" />
        <p className="text-xs font-semibold text-gray-900 dark:text-white">
          Public station site
        </p>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400">
        Share your public page — live prices and opening hours, no login needed.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-sky-700 dark:text-sky-300 underline break-all"
        >
          {url}
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={copy} className="btn btn-secondary !p-2 !text-xs">
          <Copy className="w-3 h-3" /> Copy Link
        </button>
        <button onClick={share} className="btn btn-primary !p-2 !text-xs">
          <MessageCircle className="w-3 h-3" /> WhatsApp
        </button>
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary !p-2 !text-xs"
        >
          <ExternalLink className="w-3 h-3" /> Open
        </a>
      </div>
    </div>
  );
}

/**
 * Note: the share-line helper lives in the service (`miniSiteShareLine`) so
 * non-React callers use the same one. This module stays presentational.
 */
