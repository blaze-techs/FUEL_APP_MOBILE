import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "@/react-app/context/LocationContext";
import { useAuth } from "@/react-app/context/AuthContext";
import {
  useSubTabDeepLink,
  type SubTabPayload,
} from "@/react-app/hooks/useSubTabDeepLink";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import SubTabBar from "@/react-app/components/SubTabBar";
import { Search } from "lucide-react";
import {
  Newspaper,
  ExternalLink,
  Clock,
  Globe,
  Share2,
  Bookmark,
  BookmarkCheck,
  RefreshCw,
  Wifi,
  DollarSign,
  AlertTriangle,
  Zap,
  Leaf,
  BarChart3,
  Receipt,
  Gavel,
  Building2,
  Radio,
  Tv,
} from "lucide-react";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import NewsService, {
  ExternalNewsItem,
} from "@/react-app/services/NewsService";
import { getCountryByCode } from "@/react-app/lib/world-country-utils";
import LiveFeedEmbed from "@/react-app/components/LiveFeedEmbed";
import MoviesEmbed from "@/react-app/components/MoviesEmbed";
import { Film } from "lucide-react";

interface DisplayNewsItem extends ExternalNewsItem {
  bookmarked: boolean;
  read: boolean;
}

const CATEGORY_ICONS: Record<string, any> = {
  price: DollarSign,
  regulation: Gavel,
  industry: Building2,
  technology: Zap,
  sustainability: Leaf,
  market: BarChart3,
  tax: Receipt,
};

const CATEGORY_COLORS: Record<string, string> = {
  price: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  regulation: "bg-red-500/20 text-red-300 border-red-500/30",
  industry: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  technology: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  sustainability: "bg-green-500/20 text-green-300 border-green-500/30",
  market: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  tax: "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

const CATEGORY_LABELS: Record<string, string> = {
  price: "Price",
  regulation: "Regulation",
  industry: "Industry",
  technology: "Tech",
  sustainability: "Green",
  market: "Market",
  tax: "Tax",
};

// Social media sources for fuel industry news (opens in new tab)
const SOCIAL_MEDIA_SOURCES = [
  {
    id: "s1",
    name: "X (Twitter) - Oil & Gas",
    platform: "X",
    url: "https://x.com/search?q=oil%20gas%20prices&f=live",
    desc: "Live tweets on oil & gas prices",
  },
  {
    id: "s2",
    name: "X (Twitter) - Energy News",
    platform: "X",
    url: "https://x.com/search?q=energy%20news%20fuel&f=live",
    desc: "Real-time energy news feed",
  },
  {
    id: "s3",
    name: "Reddit - r/oil",
    platform: "Reddit",
    url: "https://www.reddit.com/r/oil/",
    desc: "Oil industry discussions",
  },
  {
    id: "s4",
    name: "Reddit - r/energy",
    platform: "Reddit",
    url: "https://www.reddit.com/r/energy/",
    desc: "Energy sector news & analysis",
  },
  {
    id: "s5",
    name: "LinkedIn - Energy Industry",
    platform: "LinkedIn",
    url: "https://www.linkedin.com/news/topic/energy/",
    desc: "Professional energy industry posts",
  },
  {
    id: "s6",
    name: "Facebook - Oil & Gas Pages",
    platform: "Facebook",
    url: "https://www.facebook.com/search/top?q=oil%20gas%20industry",
    desc: "Facebook fuel industry pages",
  },
  {
    id: "s7",
    name: "Telegram - Oil Market Channel",
    platform: "Telegram",
    url: "https://t.me/s/oilmarketnews",
    desc: "Telegram oil market updates",
  },
  {
    id: "s8",
    name: "Reddit - r/gasprices",
    platform: "Reddit",
    url: "https://www.reddit.com/r/gasprices/",
    desc: "Consumer gas price reports",
  },
];

// Fallback curated news when external fetch fails
function getCuratedNews(countryCode: string): DisplayNewsItem[] {
  const now = new Date();
  const daysAgo = (d: number) =>
    new Date(now.getTime() - d * 86400000).toISOString();
  const items: DisplayNewsItem[] = [
    {
      id: "cur-001",
      title: "Global Crude Oil Prices Rise Amid Supply Concerns",
      summary:
        "International crude oil benchmarks Brent and WTI have increased by 3.2% this week following production cuts by major OPEC+ members. Fuel stations should prepare for wholesale price adjustments.",
      category: "price",
      source: "Energy Intelligence",
      sourceUrl: "https://www.energyintel.com",
      publishedAt: daysAgo(1),
      country: "ALL",
      priority: "high",
      bookmarked: false,
      read: false,
    },
    {
      id: "cur-002",
      title: "New Fuel Quality Standards Announced for 2026",
      summary:
        "Updated fuel quality specifications including lower sulfur content requirements will take effect from January 2026. All fuel stations must ensure their suppliers meet the new standards.",
      category: "regulation",
      source: "IFQC",
      sourceUrl: "https://www.ifqc.org",
      publishedAt: daysAgo(2),
      country: "ALL",
      priority: "high",
      bookmarked: false,
      read: false,
    },
    {
      id: "cur-003",
      title: "Digital Payment Integration Boosts Station Revenue by 28%",
      summary:
        "A new study shows fuel stations that adopted integrated digital payment systems saw a 28% increase in customer throughput and average transaction value.",
      category: "technology",
      source: "Petroleum Retailers Association",
      sourceUrl: "#",
      publishedAt: daysAgo(3),
      country: "ALL",
      priority: "medium",
      bookmarked: false,
      read: false,
    },
    {
      id: "cur-004",
      title: "EV Charging Infrastructure Grants Now Available",
      summary:
        "Government announces new grants for fuel stations adding EV charging points. Applications open next month for stations looking to diversify.",
      category: "sustainability",
      source: "Green Energy Weekly",
      sourceUrl: "#",
      publishedAt: daysAgo(4),
      country: "ALL",
      priority: "medium",
      bookmarked: false,
      read: false,
    },
    {
      id: "cur-005",
      title: "Fuel Theft Prevention: New IoT Monitoring Systems",
      summary:
        "Advanced IoT-based fuel monitoring systems are now available at reduced costs. These systems can detect leaks, theft, and tampering in real-time.",
      category: "technology",
      source: "Fuel Security Today",
      sourceUrl: "#",
      publishedAt: daysAgo(5),
      country: "ALL",
      priority: "medium",
      bookmarked: false,
      read: false,
    },
  ];

  // Generate country-specific news dynamically for ANY country (250+)
  const country = getCountryByCode(countryCode);
  if (country) {
    const name = country.name;
    const short = countryCode.toLowerCase();
    items.push(
      {
        id: `${short}-001`,
        title: `${name} Fuel Price Update: New Rates Announced`,
        summary: `The energy regulatory authority in ${name} has released updated fuel retail prices. Station owners should review their pricing structures.`,
        category: "price",
        source: `${name} Energy Authority`,
        sourceUrl: "#",
        publishedAt: daysAgo(1),
        country: countryCode,
        priority: "high",
        bookmarked: false,
        read: false,
      },
      {
        id: `${short}-002`,
        title: `${name} Tax Compliance Changes for Fuel Retailers`,
        summary: `New tax compliance requirements have been announced for fuel stations operating in ${name}. Ensure your invoicing systems are up to date.`,
        category: "regulation",
        source: `${name} Revenue Authority`,
        sourceUrl: "#",
        publishedAt: daysAgo(3),
        country: countryCode,
        priority: "high",
        bookmarked: false,
        read: false,
      },
      {
        id: `${short}-003`,
        title: `Mobile Payment Growth in ${name}: Fuel Sector Trends`,
        summary: `Digital and mobile payment adoption for fuel purchases continues to grow across ${name}. Stations should consider upgrading their payment systems.`,
        category: "market",
        source: "Fuel Industry Report",
        sourceUrl: "#",
        publishedAt: daysAgo(5),
        country: countryCode,
        priority: "medium",
        bookmarked: false,
        read: false,
      },
    );
  }

  return items.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export default function News() {
  const { currentCountry } = useLocation();
  const { user } = useAuth();
  const [news, setNews] = useState<DisplayNewsItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [fetchingExternal, setFetchingExternal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DisplayNewsItem | null>(
    null,
  );
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set<string>());
  const [readIds, setReadIds] = useState<Set<string>>(new Set<string>());
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [source, setSource] = useState<"curated" | "external">("curated");
  const [searchQuery, setSearchQuery] = useState("");

  // Sub-tab navigation: News Articles | Movies | Live TV | Live Radio
  const [activeSubTab, setActiveSubTab] = useState<
    "articles" | "movies" | "live-tv" | "live-radio"
  >("articles");

  // External movie search seed (QuickSearch / AI Chatbot deep links).
  const [movieSeed, setMovieSeed] = useState<{ q: string; ts: number }>({
    q: "",
    ts: 0,
  });

  // Live feed embed state — country filter for TV / Radio sub-tabs
  // Deep-link: applies payload.subTab; extras seed the Movies search.
  const handleNewsExtras = (p: SubTabPayload) => {
    const q = String(p.movieTitle || p.searchQuery || "").trim();
    if (q) {
      setActiveSubTab("movies");
      setMovieSeed({ q, ts: Date.now() });
    }
  };
  useSubTabDeepLink("news", setActiveSubTab, handleNewsExtras);
  const [tvCountry, setTvCountry] = useState<string>(currentCountry.id);
  const [radioCountry, setRadioCountry] = useState<string>(currentCountry.id);

  // Cross-device cloud-sync guards (prevent realtime echo from wiping local edits)
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const skipRemoteRef = useRef(false);

  const persistBookmarks = useCallback((next: Set<string>) => {
    const arr = Array.from(next);
    try {
      localStorage.setItem("fuelpro_news_bookmarks", JSON.stringify(arr));
    } catch {
      /* */
    }
    if (cloudLoadCompleteRef.current) {
      skipRemoteRef.current = true;
      cloudStorageService.set("news_bookmarks", arr).catch(() => {});
    }
  }, []);

  const persistReadIds = useCallback((next: Set<string>) => {
    const arr = Array.from(next);
    try {
      localStorage.setItem("fuelpro_news_read", JSON.stringify(arr));
    } catch {
      /* */
    }
    if (cloudLoadCompleteRef.current) {
      cloudStorageService.set("news_read", arr).catch(() => {});
    }
  }, []);

  // Load bookmarks + read state from local cache for instant first render
  useEffect(() => {
    const saved = localStorage.getItem("fuelpro_news_bookmarks");
    if (saved) {
      try {
        const parsed: string[] = JSON.parse(saved);
        setBookmarks(new Set<string>(parsed));
      } catch {
        /* */
      }
    }
    const savedRead = localStorage.getItem("fuelpro_news_read");
    if (savedRead) {
      try {
        const parsed: string[] = JSON.parse(savedRead);
        setReadIds(new Set<string>(parsed));
      } catch {
        /* */
      }
    }
    setLastFetch(NewsService.getLastFetchTime());
  }, []);

  // Load bookmarks + read state from cloud on mount (cross-device sync)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let unsubBookmarks: (() => void) | undefined;
    let unsubRead: (() => void) | undefined;
    (async () => {
      const [cloud, cloudRead] = await Promise.all([
        cloudStorageService.get<string[]>("news_bookmarks"),
        cloudStorageService.get<string[]>("news_read"),
      ]);
      if (cancelled) return;
      if (!localModifiedRef.current) {
        if (cloud && Array.isArray(cloud) && cloud.length > 0) {
          setBookmarks(new Set<string>(cloud));
        }
        if (cloudRead && Array.isArray(cloudRead)) {
          setReadIds(new Set<string>(cloudRead));
        }
      }
      cloudLoadCompleteRef.current = true;
      // Real-time: another device's bookmark change reflects instantly
      unsubBookmarks = cloudStorageService.subscribe<string[]>(
        "news_bookmarks",
        undefined,
        (cloudArr) => {
          if (skipRemoteRef.current) {
            skipRemoteRef.current = false;
            return;
          }
          if (Array.isArray(cloudArr)) {
            setBookmarks(new Set<string>(cloudArr));
            try {
              localStorage.setItem(
                "fuelpro_news_bookmarks",
                JSON.stringify(cloudArr),
              );
            } catch {
              /* */
            }
          }
        },
      );
      unsubRead = cloudStorageService.subscribe<string[]>(
        "news_read",
        undefined,
        (cloudArr) => {
          if (Array.isArray(cloudArr)) {
            setReadIds(new Set<string>(cloudArr));
            try {
              localStorage.setItem(
                "fuelpro_news_read",
                JSON.stringify(cloudArr),
              );
            } catch {
              /* */
            }
          }
        },
      );
    })();
    return () => {
      cancelled = true;
      unsubBookmarks?.();
      unsubRead?.();
    };
  }, [user]);

  // Sync TV/radio country when location changes
  useEffect(() => {
    setTvCountry(currentCountry.id);
    setRadioCountry(currentCountry.id);
  }, [currentCountry.id]);

  // Load news on mount
  useEffect(() => {
    loadNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCountry.id]);

  async function loadNews() {
    setLoading(true);

    // Try to get external news first
    const external = NewsService.loadExternalNews() as DisplayNewsItem[];

    if (external.length > 0) {
      // Apply bookmarks to external news
      external.forEach((item) => {
        item.bookmarked = bookmarks.has(item.id);
        item.read = false;
      });
      setNews(external);
      setSource("external");
    } else {
      // Fall back to curated news
      const curated = getCuratedNews(currentCountry.id);
      curated.forEach((item) => {
        item.bookmarked = bookmarks.has(item.id);
      });
      setNews(curated);
      setSource("curated");
    }

    setLoading(false);
  }

  // Fetch from external sources
  async function handleFetchExternal() {
    setFetchingExternal(true);
    try {
      const fetched = await NewsService.autoFetchNews(currentCountry.id);
      if (fetched.length > 0) {
        const withFlags = fetched.map((item) => ({
          ...item,
          bookmarked: bookmarks.has(item.id),
          read: false,
        }));
        setNews(withFlags);
        setSource("external");
        setLastFetch(new Date());
      }
    } catch (e) {
      console.warn("External fetch failed, using curated:", e);
    } finally {
      setFetchingExternal(false);
    }
  }

  const toggleBookmark = (id: string) => {
    localModifiedRef.current = true;
    setBookmarks((prev) => {
      const next = new Set<string>(Array.from(prev));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistBookmarks(next);
      return next;
    });
    setNews((prev) =>
      prev.map((n) => (n.id === id ? { ...n, bookmarked: !n.bookmarked } : n)),
    );
  };

  const markAsRead = (id: string) => {
    localModifiedRef.current = true;
    setReadIds((prev) => {
      const next = new Set<string>(Array.from(prev));
      next.add(id);
      persistReadIds(next);
      return next;
    });
    setNews((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  };

  const shareNews = (item: DisplayNewsItem) => {
    const text = `${item.title}\n${item.summary}\nSource: ${item.source}`;
    if (navigator.share) {
      navigator
        .share({ title: item.title, text, url: item.sourceUrl })
        .catch((err) => console.warn("[News] async fetch failed:", err));
    } else {
      navigator.clipboard
        .writeText(text)
        .then(() =>
          import("@/react-app/lib/toast").then(({ toastSuccess }) =>
            toastSuccess("News copied to clipboard"),
          ),
        );
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredNews =
    activeFilter === "all"
      ? news
      : activeFilter === "bookmarked"
        ? news.filter((n) => n.bookmarked)
        : activeFilter === "unread"
          ? news.filter((n) => !readIds.has(n.id))
          : news.filter((n) => n.category === activeFilter);
  const searchedNews =
    q.length === 0
      ? filteredNews
      : filteredNews.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.summary.toLowerCase().includes(q) ||
            n.source.toLowerCase().includes(q) ||
            (n.category || "").toLowerCase().includes(q),
        );

  const unreadCount = news.filter((n) => !readIds.has(n.id)).length;

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-xl">
            <Newspaper className="text-blue-600 dark:text-blue-400" size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-900 dark:text-white">
              Fuel Industry News
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-500 dark:text-gray-400">
              {currentCountry.flag} {currentCountry.name} &bull; {unreadCount}{" "}
              unread &bull;
              <span
                className={
                  source === "external" ? "text-green-500" : "text-amber-500"
                }
              >
                {source === "external" ? " Live feed" : " Curated"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFetchExternal}
            disabled={fetchingExternal}
            className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400 rounded-lg text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 fp-icon-only"
            title="Refresh"
            aria-label="Refresh"
          >
            {fetchingExternal ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <Wifi size={12} />
            )}
            {fetchingExternal ? "Fetching..." : "Fetch Live News"}
          </button>
          <button
            onClick={() => {
              localModifiedRef.current = true;
              const next = new Set<string>(news.map((n) => n.id));
              setReadIds(next);
              persistReadIds(next);
              setNews((prev) => prev.map((n) => ({ ...n, read: true })));
            }}
            className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-xs hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* Sub-tab navigation: Articles | Movies | Live TV | Live Radio */}
      <SubTabBar
        tabs={[
          { id: "articles", label: "News Articles", icon: Newspaper },
          { id: "movies", label: "Movies", icon: Film },
          { id: "live-tv", label: "Live TV", icon: Tv },
          { id: "live-radio", label: "Live Radio", icon: Radio },
        ]}
        active={activeSubTab}
        onChange={(id) => setActiveSubTab(id as typeof activeSubTab)}
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3 min-w-0">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
            <Newspaper size={16} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">
              Total Articles
            </p>
            <p className="text-lg font-bold text-gray-800 dark:text-white">
              {news.length}
            </p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3 min-w-0">
          <div className="p-2 shrink-0 bg-amber-50 dark:bg-amber-900/30 rounded-lg">
            <Clock size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">
              Unread
            </p>
            <p className="text-lg font-bold text-gray-800 dark:text-white">
              {unreadCount}
            </p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3">
          <div className="p-2 shrink-0 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg">
            <BookmarkCheck
              size={16}
              className="text-emerald-600 dark:text-emerald-400"
            />
          </div>
          <div>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase">
              Bookmarked
            </p>
            <p className="text-lg font-bold text-gray-800 dark:text-white">
              {news.filter((n) => n.bookmarked).length}
            </p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3 min-w-0">
          <div
            className={`p-2 rounded-lg shrink-0 ${source === "external" ? "bg-green-50 dark:bg-green-900/30" : "bg-gray-100 dark:bg-gray-700"}`}
          >
            <Wifi
              size={16}
              className={
                source === "external"
                  ? "text-green-600 dark:text-green-400"
                  : "text-gray-500"
              }
            />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase truncate">
              Source
            </p>
            <p className="text-lg font-bold text-gray-800 dark:text-white truncate">
              {source === "external" ? "Live" : "Curated"}
            </p>
          </div>
        </div>
      </div>

      {/* ===================== NEWS ARTICLES SUB-TAB ===================== */}
      {activeSubTab === "articles" && (
        <>
          {/* Search bar */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search news by title, summary, source, or category..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Last fetch time */}
          {lastFetch && (
            <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-4">
              Last updated: {lastFetch.toLocaleString()}
            </p>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveFilter("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeFilter === "all" ? "bg-blue-500 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
            >
              All ({news.length})
            </button>
            <button
              onClick={() => setActiveFilter("bookmarked")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${activeFilter === "bookmarked" ? "bg-amber-500 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
            >
              <Bookmark size={12} /> Saved ({bookmarks.size})
            </button>
            <button
              onClick={() => setActiveFilter("unread")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${activeFilter === "unread" ? "bg-blue-500 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
            >
              <Clock size={12} /> Unread ({unreadCount})
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
              const count = news.filter((n) => n.category === key).length;
              if (count === 0) return null;
              const Icon = CATEGORY_ICONS[key];
              return (
                <button
                  key={key}
                  onClick={() => setActiveFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${activeFilter === key ? "bg-blue-500 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                >
                  <Icon size={12} /> {label} ({count})
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ===================== MOVIES SUB-TAB (reverse-engineered streaming catalog) ===================== */}
      {activeSubTab === "movies" && (
        <div className="space-y-4">
          {/* Global movie catalog — full search + genre + favorites/watchlist
              + continue-watching + embedded player. Silently integrated. */}
          <MoviesEmbed
            accent="amber"
            searchSeed={movieSeed.q}
            searchSeedKey={movieSeed.ts}
          />
        </div>
      )}

      {/* ===================== LIVE TV SUB-TAB (merged Live Channels + Live TV) ===================== */}
      {activeSubTab === "live-tv" && (
        <div className="space-y-4">
          {/* Live global TV channels — full multi-category switcher so both
              the old "Live Channels" grid and the "Live TV" view are available
              in ONE place. Select a station from the picker to PREVIEW it. */}
          <LiveFeedEmbed
            defaultCategory="tv"
            defaultCountry={tvCountry}
            showCategorySwitcher={true}
            showSubCategorySwitcher={true}
            family="video"
            accent="blue"
          />
        </div>
      )}

      {/* ===================== LIVE RADIO SUB-TAB ===================== */}
      {activeSubTab === "live-radio" && (
        <div className="space-y-4">
          {/* Live global radio stations — silently integrated */}
          <LiveFeedEmbed
            defaultCategory="radio"
            defaultCountry={radioCountry}
            showCategorySwitcher={false}
            showSubCategorySwitcher={true}
            family="audio"
            accent="purple"
          />
        </div>
      )}

      {/* ===================== ARTICLES GRID (articles sub-tab only) ===================== */}
      {activeSubTab === "articles" && (
        <>
          {/* Social Media News Sources */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <h3 className="font-bold text-gray-900 dark:text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Globe size={18} className="text-blue-600" />
              Social Media Fuel News
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Live fuel industry news from social media platforms. Click to open
              in a new tab.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {SOCIAL_MEDIA_SOURCES.map((src) => (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 bg-gray-50 dark:bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-all group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-blue-600">
                      {src.platform}
                    </span>
                    <ExternalLink
                      size={12}
                      className="text-gray-500 dark:text-gray-400 group-hover:text-blue-600"
                    />
                  </div>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">
                    {src.name}
                  </p>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                    {src.desc}
                  </p>
                </a>
              ))}
            </div>
          </div>

          {/* News Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw
                size={32}
                className="text-gray-500 dark:text-gray-400 animate-spin mb-4"
              />
              <p className="text-gray-500">Loading news...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {searchedNews.map((item) => {
                const Icon = CATEGORY_ICONS[item.category] || Newspaper;
                const colorClass = CATEGORY_COLORS[item.category];
                const isPriority = item.priority === "high";
                const isRead = readIds.has(item.id) || item.read;

                return (
                  <div
                    key={item.id}
                    className={`group bg-white dark:bg-gray-800 rounded-xl border transition-all hover:shadow-lg cursor-pointer ${
                      isRead
                        ? "border-gray-200 dark:border-gray-700 opacity-70"
                        : isPriority
                          ? "border-red-300 dark:border-red-700"
                          : "border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700"
                    }`}
                    onClick={() => {
                      if (item.sourceUrl && item.sourceUrl !== "#") {
                        window.open(
                          item.sourceUrl,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }
                      markAsRead(item.id);
                    }}
                  >
                    <div className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1 ${colorClass}`}
                          >
                            <Icon size={10} /> {CATEGORY_LABELS[item.category]}
                          </span>
                          {isPriority && (
                            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] font-medium flex items-center gap-1">
                              <AlertTriangle size={10} /> High Priority
                            </span>
                          )}
                          {!isRead && (
                            <span className="w-2 h-2 bg-blue-500 rounded-full" />
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleBookmark(item.id);
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            {item.bookmarked ? (
                              <BookmarkCheck
                                size={14}
                                className="text-amber-400"
                              />
                            ) : (
                              <Bookmark
                                size={14}
                                className="text-gray-500 dark:text-gray-400"
                              />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              shareNews(item);
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            <Share2
                              size={14}
                              className="text-gray-500 dark:text-gray-400"
                            />
                          </button>
                        </div>
                      </div>

                      <h3
                        className={`font-semibold mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors ${isRead ? "text-gray-600 dark:text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-900 dark:text-white"}`}
                      >
                        {item.title}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-500 dark:text-gray-400 line-clamp-3 mb-3">
                        {item.summary}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Globe size={10} /> {item.source}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={10} />{" "}
                            {item.publishedAt
                              ? new Date(item.publishedAt).toLocaleDateString()
                              : "—"}
                          </span>
                        </div>
                        <ExternalLink
                          size={12}
                          className="text-gray-500 dark:text-gray-400 group-hover:text-blue-400 transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {searchedNews.length === 0 && !loading && (
            <div className="text-center py-16">
              <Newspaper size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">
                {searchQuery
                  ? `No news matching "${searchQuery}"`
                  : "No news items in this category"}
              </p>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between mb-4">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border ${CATEGORY_COLORS[selectedItem.category]}`}
                >
                  {CATEGORY_LABELS[selectedItem.category]}
                </span>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  Close
                </button>
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-900 dark:text-white mb-3">
                {selectedItem.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                {selectedItem.summary}
              </p>
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Source: {selectedItem.source}</span>
                <span>
                  {selectedItem.publishedAt
                    ? new Date(selectedItem.publishedAt).toLocaleDateString()
                    : "—"}
                </span>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {selectedItem.sourceUrl && selectedItem.sourceUrl !== "#" && (
                  <button
                    onClick={() =>
                      window.open(
                        selectedItem.sourceUrl,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <ExternalLink size={16} /> Read Full Article
                  </button>
                )}
                {selectedItem.category === "price" && (
                  <button
                    onClick={() => {
                      setSelectedItem(null);
                      switchToTab("price-finder");
                    }}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <DollarSign size={16} /> View Live Fuel Prices
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      toggleBookmark(selectedItem.id);
                      setSelectedItem((p) =>
                        p ? { ...p, bookmarked: !p.bookmarked } : null,
                      );
                    }}
                    className="flex-1 py-2 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-amber-500/30"
                  >
                    {selectedItem.bookmarked ? (
                      <BookmarkCheck size={14} />
                    ) : (
                      <Bookmark size={14} />
                    )}{" "}
                    {selectedItem.bookmarked ? "Saved" : "Save"}
                  </button>
                  <button
                    onClick={() => shareNews(selectedItem)}
                    className="flex-1 py-2 bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-blue-500/30"
                  >
                    <Share2 size={14} /> Share
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
