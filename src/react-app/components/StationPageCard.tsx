/**
 * StationPageCard — the customer-facing view of the station's public mini site.
 *
 * `MiniSiteLink` is the small embed for places already mid-conversation with a
 * customer. This is the place the owner goes when the question is "how do I get
 * customers onto our page?" — so it shows the page itself (live prices, opening
 * hours) and the QR a customer actually scans at the pump, rather than a bare
 * URL.
 *
 * It reads the published document straight from the bucket's public URL, which
 * is the same document a visitor gets. Rendering it here means the owner is
 * previewing the real thing, not a local draft that might differ from what is
 * live.
 */
import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Globe,
  Loader2,
  MessageCircle,
  QrCode,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import {
  computeOpenStatus,
  fetchPublishedMiniSite,
  getCachedMiniSiteConfig,
  loadMiniSiteConfig,
  miniSitePath,
  miniSiteUrl,
  dayLabel,
  type MiniSiteConfig,
  type PublishedMiniSite,
} from "@/react-app/lib/mini-site-service";
import { navigateToTab } from "@/react-app/lib/mpesa-integration-service";
import { toastSuccess } from "@/react-app/lib/toast";

export default function StationPageCard() {
  const { currentStation } = useStations();
  const stationId = currentStation?.id;

  const [config, setConfig] = useState<MiniSiteConfig | null>(() =>
    getCachedMiniSiteConfig(stationId),
  );
  const [doc, setDoc] = useState<PublishedMiniSite | null>(null);
  const [loading, setLoading] = useState(false);
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConfig(getCachedMiniSiteConfig(stationId));
    void loadMiniSiteConfig(stationId).then((c) => {
      if (!cancelled && c) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  const slug = config?.published && config.slug ? config.slug : "";

  // Load the PUBLISHED document, not the local draft — preview the real thing.
  useEffect(() => {
    if (!slug) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchPublishedMiniSite(slug)
      .then((published) => {
        if (!cancelled) setDoc(published);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // QR into the canvas, lazy-loading the package like the rest of the feature.
  useEffect(() => {
    if (!slug || !qrRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const QR = (await import("qrcode")).default as {
          toCanvas: (
            el: HTMLCanvasElement,
            text: string,
            opts?: Record<string, unknown>,
          ) => Promise<void>;
        };
        if (cancelled || !qrRef.current) return;
        await QR.toCanvas(qrRef.current, miniSiteUrl(slug), {
          width: 168,
          margin: 1,
          color: { dark: "#0a0e17", light: "#ffffff" },
        });
      } catch {
        /* QR is a convenience; the link is always shown */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!slug) {
    return (
      <div className="card rounded border border-dashed p-6 text-center">
        <Globe className="w-8 h-8 mx-auto text-gray-400 mb-2" />
        <p className="font-semibold text-gray-900 dark:text-white">
          No public station page yet
        </p>
        <p className="text-sm text-gray-500 mt-1 mb-3">
          Publish one to give customers your live prices and opening hours
          without an account.
        </p>
        <button
          onClick={() => navigateToTab("webstudio", { subTab: "mini" })}
          className="btn btn-primary"
        >
          <Globe className="w-4 h-4" /> Publish in Web Studio
        </button>
      </div>
    );
  }

  const url = miniSiteUrl(slug);
  const path = miniSitePath(slug);
  const openStatus = doc ? computeOpenStatus(doc.hours) : null;
  const today = new Date().getDay();
  const todayHours = doc?.hours?.find((h) => h.day === today);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toastSuccess("Station page link copied.");
    } catch {
      toastSuccess(`Copy manually: ${url}`);
    }
  };

  const share = () => {
    const msg = `${doc?.siteName || currentStation?.name || "Our station"}\nLive prices & opening hours:\n${url}`;
    // Share to any recipient: wa.me without a number opens the contact picker.
    // (whatsappLink() requires a number and would return "" here.)
    window.open(
      `https://wa.me/?text=${encodeURIComponent(msg)}`,
      "_blank",
      "noopener",
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Globe className="w-5 h-5 text-sky-500" /> Public Station Page
          </h4>
          <p className="text-xs text-gray-500">
            What customers see when you share your link or they scan the QR.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={copy} className="btn btn-secondary !text-xs">
            Copy link
          </button>
          <button onClick={share} className="btn btn-primary !text-xs">
            <MessageCircle className="w-3 h-3" /> Share
          </button>
          <a
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary !text-xs"
          >
            <ExternalLink className="w-3 h-3" /> Open
          </a>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Live preview of the published document */}
        <div className="md:col-span-2 rounded border overflow-hidden">
          <div className="flex items-center gap-2 border-b bg-gray-50 dark:bg-white/5 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="h-2 w-2 rounded-full bg-green-400" />
            <span className="ml-2 text-[11px] text-gray-500 truncate">
              {url}
            </span>
          </div>
          {loading && !doc ? (
            <div className="p-6 text-center text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Loading the published page…
            </div>
          ) : doc ? (
            <div className="p-4 space-y-3">
              <div>
                <p className="font-bold text-gray-900 dark:text-white">
                  {doc.siteName}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {doc.headline}
                </p>
                {openStatus?.label && (
                  <p
                    className={`text-xs mt-1 font-medium ${openStatus.open ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {openStatus.label}
                  </p>
                )}
              </div>

              {doc.prices?.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {doc.prices.slice(0, 6).map((p) => (
                    <div
                      key={p.label}
                      className="rounded border p-2 text-center"
                    >
                      <p className="text-[11px] text-gray-500 truncate">
                        {p.label}
                      </p>
                      <p className="font-bold text-sm text-gray-900 dark:text-white">
                        {doc.currencySymbol}
                        {p.price}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {todayHours && (
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  Today ({dayLabel(todayHours.day)}):{" "}
                  {todayHours.closed
                    ? "Closed"
                    : `${todayHours.open} – ${todayHours.close}`}
                </p>
              )}
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-gray-500">
              The published page could not be loaded. It is still linked
              publicly — open it to check.
            </div>
          )}
        </div>

        {/* The QR a customer scans at the pump */}
        <div className="rounded border p-4 text-center space-y-2">
          <QrCode className="w-5 h-5 mx-auto text-gray-500" />
          <p className="text-xs font-semibold text-gray-900 dark:text-white">
            Scan at the pump
          </p>
          <canvas ref={qrRef} className="mx-auto" />
          <p className="text-[11px] text-gray-500 break-all">{path}</p>
        </div>
      </div>
    </div>
  );
}
