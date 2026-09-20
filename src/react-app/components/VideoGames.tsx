/**
 * VideoGames — the "Video Games" top-level tab.
 *
 * A single, massive "All games" collection that merges EVERY verified,
 * ad-free browser-playable source into one unified experience:
 *
 *   - quenq   1,316-strong arcade (Ruffle SWF via our same-origin
 *             /api/quenq-embed mirror)
 *   - crazy   no-ads CrazyGames catalog (via /api/game-embed mirror proxy)
 *   - classic archive.org in-browser DOS/Windows classics (iframe embed)
 *   - popular Minecraft Classic / GTA 1997 / Angry Birds… (verified embeds)
 *   - apps    quenq /apps/ (Minecraft Eaglercraft, Angry Birds Chrome…)
 *   - cloud   AAA cloud-gaming launch cards (open in new tab — the official
 *             portals block iframing with X-Frame-Options: DENY)
 *
 * Everything is searchable + filterable from ONE place:
 *   - big search box, source chips, genre chips, sort (A–Z / Most played)
 *   - source badges on every card, per-source counts in the header
 *   - cloud-synced favorites + recently-played history across ALL sources
 *   - Surprise plays a random game from the WHOLE collection
 *   - unified player modal: iframes playable sources; URLs open external
 *
 * NO ADS anywhere (hard requirement). All embed paths route through our
 * same-origin mirrors (quenq-embed / game-embed) and archive.org which ship
 * no third-party ad SDKs.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Search,
  Heart,
  Shuffle,
  Play,
  X,
  Maximize2,
  Minimize2,
  Clock,
  Loader2,
  Gamepad2,
  Trophy,
  Info,
  ExternalLink,
  Cloud,
  Star,
  Globe,
  AppWindow,
  ListFilter,
  ArrowUpAZ,
  Keyboard,
  MousePointer2,
  Cable,
  Check,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { enterFullscreen, exitFullscreen } from "@/react-app/lib/fullscreen";
import {
  isFullscreen,
  toggleFullscreen as toggleAppFullscreen,
} from "@/react-app/lib/fullscreen";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  fetchGameCatalog,
  fetchCrazyGamesCatalog,
  mergeCrazyGamesCatalogs,
  buildUnifiedGames,
  searchUnifiedGames,
  filterUnifiedBySource,
  filterUnifiedByGenre,
  sortUnifiedGames,
  countUnifiedBySource,
  SOURCE_FILTERS,
  SOURCE_TINT,
  type GameCatalog,
  type CrazyGamesCatalog,
  type UnifiedGame,
  type GameSource,
} from "@/react-app/services/GameCatalogService";
import {
  CONTROL_MODES,
  detectControls,
  statusLabel,
  isSameOriginFrame,
  focusGameFrame,
  forwardKeysToFrame,
  startGamepadBridge,
  type ControlMode,
  type GameControlStatus,
  type GamepadBridgeHandle,
} from "@/react-app/lib/game-controls";

// ─── Cloud keys (station-agnostic, owner-scoped) ─────────────────────────
const FAVORITES_KEY = "vg_favorites";
const HISTORY_KEY = "vg_history";
const HISTORY_MAX = 24;
const FAVORITES_MAX = 200;

interface HistoryEntry {
  slug: string;
  name: string;
  playedAt: number;
}

interface Props {
  accent?: "blue" | "purple" | "amber" | "emerald";
}

const ACCENTS: Record<
  NonNullable<Props["accent"]>,
  { active: string; icon: string; chip: string }
> = {
  blue: {
    active: "bg-blue-500 text-white",
    icon: "text-blue-600 dark:text-blue-400",
    chip: "bg-blue-50 dark:bg-blue-900/30",
  },
  purple: {
    active: "bg-purple-500 text-white",
    icon: "text-purple-600 dark:text-purple-400",
    chip: "bg-purple-50 dark:bg-purple-900/30",
  },
  amber: {
    active: "bg-amber-500 text-gray-900 dark:text-white",
    icon: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-50 dark:bg-amber-900/30",
  },
  emerald: {
    active: "bg-emerald-500 text-white",
    icon: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-50 dark:bg-emerald-900/30",
  },
};

export default function VideoGames({ accent = "emerald" }: Props) {
  const a = ACCENTS[accent];
  const { user } = useAuth();

  // Catalog state
  const [catalog, setCatalog] = useState<GameCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Unified "All games" filter state
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("All");
  const [source, setSource] = useState<GameSource | "all">("all");
  const [sort, setSort] = useState<"name" | "plays">("name");

  // CrazyGames catalog state (feeds the unified collection)
  const [crazyCat, setCrazyCat] = useState<CrazyGamesCatalog>({
    source: "crazygames",
    category: "action",
    games: [],
    total: 0,
    page: 1,
    size: 0,
    fetchedAt: 0,
  });
  // The unified view feeds the collection from one default category feed;
  // "load more" pages through it. (No dropdown — search/sort cover browsing.)
  const [crazyCategory] = useState("action");
  const [crazyLoading, setCrazyLoading] = useState(false);

  // Player state (unified)
  const [activeGame, setActiveGame] = useState<UnifiedGame | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);

  // Pagination - bounded DOM (1,300+ quenq + paginated CrazyGames)
  const PAGE_SIZE = 48;
  const [visibleCount, setCount] = useState(PAGE_SIZE);

  // Cloud state (3-ref guard, unchanged)
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const favoritesRef = useRef<Set<string>>(new Set());
  const historyRef = useRef<HistoryEntry[]>([]);
  favoritesRef.current = favorites;
  historyRef.current = history;

  // Cloud load / persist
  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    const load = async () => {
      try {
        const [fav, hist] = await Promise.all([
          cloudStorageService
            .get<string[]>(FAVORITES_KEY)
            .then((d) => (Array.isArray(d) ? d : [])),
          cloudStorageService
            .get<HistoryEntry[]>(HISTORY_KEY)
            .then((d) => (Array.isArray(d) ? d : [])),
        ]);
        if (cancelled) return;
        if (!localModifiedRef.current) {
          setFavorites(new Set(fav));
          setHistory(hist.slice(0, HISTORY_MAX));
        }
      } finally {
        if (!cancelled) {
          cloudLoadCompleteRef.current = true;
          if (localModifiedRef.current) {
            cloudStorageService
              .set(FAVORITES_KEY, Array.from(favoritesRef.current))
              .catch(() => {});
            cloudStorageService
              .set(HISTORY_KEY, historyRef.current.slice(0, HISTORY_MAX))
              .catch(() => {});
            localModifiedRef.current = false;
          }
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const persistFavorites = useCallback((next: Set<string>) => {
    localModifiedRef.current = true;
    const merged = new Set(next);
    setFavorites(merged);
    if (cloudLoadCompleteRef.current) {
      cloudStorageService
        .set(FAVORITES_KEY, Array.from(merged))
        .catch(() => {});
      localModifiedRef.current = false;
    }
  }, []);

  const persistHistory = useCallback((entry: HistoryEntry) => {
    localModifiedRef.current = true;
    setHistory((prev) => {
      const next = [entry, ...prev.filter((h) => h.slug !== entry.slug)].slice(
        0,
        HISTORY_MAX,
      );
      if (cloudLoadCompleteRef.current) {
        cloudStorageService.set(HISTORY_KEY, next).catch(() => {});
        localModifiedRef.current = false;
      }
      return next;
    });
  }, []);

  const toggleFavorite = useCallback(
    (g: UnifiedGame) => {
      const next = new Set(favoritesRef.current);
      if (next.has(g.id)) next.delete(g.id);
      else next.add(g.id);
      if (next.size > FAVORITES_MAX) {
        const first = next.values().next().value;
        if (first !== undefined) next.delete(first);
      }
      persistFavorites(next);
    },
    [persistFavorites],
  );

  // Catalog load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGameCatalog()
      .then((cat) => {
        if (cancelled) return;
        setCatalog(cat);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the game catalog.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // CrazyGames catalog load (per-category, pageable - feeds collection)
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setCrazyLoading(true);
    fetchCrazyGamesCatalog(crazyCategory, 1, controller.signal)
      .then((cat) => {
        if (cancelled) return;
        if (cat.games.length) setCrazyCat(cat);
      })
      .catch(() => {
        // Non-fatal: the unified collection still shows quenq/classics/etc.
      })
      .finally(() => {
        if (!cancelled) setCrazyLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [crazyCategory]);

  const loadMoreCrazy = useCallback(() => {
    const nextPage = (crazyCat.page || 1) + 1;
    fetchCrazyGamesCatalog(crazyCategory, nextPage).then((cat) => {
      if (cat.games.length) {
        setCrazyCat((prev) => mergeCrazyGamesCatalogs(prev, cat));
      }
    });
  }, [crazyCat.page, crazyCategory]);

  // The UNIFIED collection: quenq + loaded CrazyGames + classics + popular +
  // apps + cloud AAA, all in one searchable/filterable mega-list.
  const unified = useMemo(
    () =>
      buildUnifiedGames({
        quenq: catalog ? catalog.games : [],
        crazy: crazyCat.games,
      }),
    [catalog, crazyCat.games],
  );

  const counts = useMemo(() => countUnifiedBySource(unified), [unified]);

  const sourcesPresent = useMemo(
    () =>
      SOURCE_FILTERS.filter((f) =>
        f.value === "all" ? true : counts[f.value] > 0,
      ),
    [counts],
  );

  // Genre list from the unified collection (plus quenq's canonical genres).
  const genreOptions = useMemo(() => {
    const set = new Set<string>(["All"]);
    if (catalog) for (const g of catalog.genres) set.add(g);
    for (const g of unified) {
      for (const t of g.genre.split(",")) {
        const tag = t.trim();
        if (tag && tag.length < 32)
          set.add(tag.charAt(0).toUpperCase() + tag.slice(1));
      }
    }
    return Array.from(set).slice(0, 80);
  }, [unified, catalog]);

  const filteredUnified = useMemo(() => {
    let list = filterUnifiedBySource(unified, source);
    list = filterUnifiedByGenre(list, genre);
    list = searchUnifiedGames(list, search);
    return sortUnifiedGames(list, sort);
  }, [unified, source, genre, search, sort]);

  // Reset pagination window when filter/search changes.
  useEffect(() => {
    setCount(PAGE_SIZE);
  }, [search, genre, source, sort]);

  const visibleUnified = useMemo(
    () => filteredUnified.slice(0, visibleCount),
    [filteredUnified, visibleCount],
  );

  const recordPlay = useCallback(
    (g: UnifiedGame) => {
      persistHistory({ slug: g.id, name: g.name, playedAt: Date.now() });
    },
    [persistHistory],
  );

  const pickSurprise = useCallback(() => {
    if (!unified.length) return;
    const g = unified[Math.floor(Math.random() * unified.length)];
    setActiveGame(g);
    recordPlay(g);
  }, [unified, recordPlay]);

  const playGame = useCallback(
    (g: UnifiedGame) => {
      setActiveGame(g);
      recordPlay(g);
    },
    [recordPlay],
  );

  // Track the browser's actual fullscreen state. Entry is performed directly
  // from a user gesture so the browser permits the Fullscreen API request.
  useEffect(() => {
    const onFsChange = () => setFullscreen(isFullscreen());
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener(
      "webkitfullscreenchange",
      onFsChange as EventListener,
    );
    window.addEventListener("fuelpro:fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        onFsChange as EventListener,
      );
      window.removeEventListener("fuelpro:fullscreenchange", onFsChange);
    };
  }, []);

  /** Must run inside a user gesture; requests hidden browser navigation UI. */
  const toggleFullscreen = useCallback((target?: HTMLElement | null) => {
    const el = target ?? playerWrapRef.current;
    if (!el) return;
    void toggleAppFullscreen(el).then((active) => setFullscreen(active));
  }, []);

  const exitPlayer = useCallback(() => {
    if (isFullscreen()) {
      void exitFullscreen();
    }
    setActiveGame(null);
    setFullscreen(false);
  }, []);

  const totalPlayed = history.length;
  const totalGames = unified.length;

  return (
    <div className="space-y-4">
      {/* Header + stats */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={`p-2 rounded-lg ${a.chip}`}>
          <Gamepad2 size={16} className={a.icon} />
        </div>
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Video Games
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {totalGames > 0
              ? `${totalGames.toLocaleString()} games`
              : loading
                ? "Loading…"
                : "Games"}
            {" · "}
            {counts.quenq.toLocaleString()} quenq ·{" "}
            {counts.crazy.toLocaleString()} crazy · {counts.classic} classics ·{" "}
            {counts.popular} popular · {counts.apps} apps · {counts.cloud} AAA
            {" · "}
            {totalPlayed} played
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={pickSurprise}
            disabled={!unified.length}
            title="Play a random game from the whole collection"
            className="px-3 py-1.5 text-xs font-medium gap-1.5 inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            <Shuffle size={12} /> Surprise
          </button>
        </div>
      </div>

      {/* Source ribbon (All / Quenq / Crazy / Popular / Classics / Apps / AAA) */}
      <div className="flex flex-wrap gap-1.5">
        {sourcesPresent.map((f) => {
          const active = source === f.value;
          return (
            <button
              key={f.value}
              onClick={() => setSource(f.value)}
              className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 rounded-lg transition-colors ${
                active
                  ? a.active
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {f.value === "all" ? (
                <Gamepad2 size={12} />
              ) : f.value === "quenq" ? (
                <Globe size={12} />
              ) : f.value === "crazy" ? (
                <Star size={12} />
              ) : f.value === "popular" ? (
                <Trophy size={12} />
              ) : f.value === "classic" ? (
                <Clock size={12} />
              ) : f.value === "apps" ? (
                <AppWindow size={12} />
              ) : (
                <Cloud size={12} />
              )}
              {f.label}
              {f.value !== "all" && (
                <span className="opacity-70 text-[10px]">
                  {counts[f.value].toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Unified search + genre + sort */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all 2,000+ games by name, genre or source…"
            className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 inline-flex items-center gap-1 pt-1">
              <ListFilter size={11} /> Genre
            </span>
            {genreOptions.slice(0, 20).map((g) => (
              <button
                key={g}
                onClick={() => setGenre(g)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  genre === g
                    ? a.active
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <ArrowUpAZ size={12} className="text-gray-400" />
            <button
              onClick={() => setSort(sort === "name" ? "plays" : "name")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                sort === "name"
                  ? "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {sort === "name" ? "A–Z" : "Most played"}
            </button>
          </div>
        </div>
      </div>

      {/* Error / empty states */}
      {error && !unified.length ? (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 text-sm text-rose-700 dark:text-rose-300">
          {error} Showing curated titles instead.
        </div>
      ) : filteredUnified.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Gamepad2 size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No games match your search.</p>
        </div>
      ) : (
        <>
          {/* Result count */}
          <div className="text-[11px] text-gray-500 dark:text-gray-400">
            {filteredUnified.length.toLocaleString()} result
            {filteredUnified.length === 1 ? "" : "s"}
            {source !== "all"
              ? ` in ${sourceLabelFor(source)}`
              : " across all sources"}
            {genre !== "All" ? ` · ${genre}` : ""}
            {search ? ` · “${search}”` : ""}
          </div>

          {/* UNIFIED grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {visibleUnified.map((g) => (
              <UnifiedCard
                key={g.id}
                game={g}
                favorite={favorites.has(g.id)}
                onFavorite={() => toggleFavorite(g)}
                onPlay={() => playGame(g)}
                accent={a}
              />
            ))}
          </div>

          {visibleUnified.length < filteredUnified.length && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setCount((c) => c + PAGE_SIZE)}
                className="px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                Load more
                <span className="text-emerald-100 text-xs">
                  ({visibleUnified.length.toLocaleString()} /{" "}
                  {filteredUnified.length.toLocaleString()})
                </span>
              </button>
            </div>
          )}

          {/* CrazyGames "load more pages" (only visible when browsing crazy) */}
          {source === "crazy" &&
            visibleUnified.length >= filteredUnified.length &&
            filteredUnified.length < crazyCat.total && (
              <div className="flex justify-center pt-1">
                <button
                  onClick={loadMoreCrazy}
                  disabled={crazyLoading}
                  className="px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors disabled:opacity-60"
                >
                  {crazyLoading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Star size={14} />
                  )}
                  Load more CrazyGames (
                  {filteredUnified.length.toLocaleString()} /{" "}
                  {crazyCat.total.toLocaleString()})
                </button>
              </div>
            )}
        </>
      )}

      {/* Honesty note for cloud sources */}
      {(source === "cloud" || source === "all") && (
        <NotBrowserPlayableInfo accent={a} />
      )}

      {/* Recently played (all sources) */}
      {history.length > 0 && activeGame === null && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-2 flex items-center gap-2">
            <Clock size={14} className={a.icon} /> Recently played
          </h4>
          <div className="flex flex-wrap gap-2">
            {history.slice(0, 8).map((h) => {
              const g = unified.find((x) => x.id === h.slug);
              return (
                <button
                  key={h.slug}
                  onClick={() => g && playGame(g)}
                  className="px-2.5 py-1 rounded-lg text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  {h.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Unified player modal (no ads) */}
      {activeGame && (
        <UnifiedPlayer
          game={activeGame}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          onClose={exitPlayer}
          wrapRef={playerWrapRef}
        />
      )}
    </div>
  );
}

function sourceLabelFor(source: GameSource): string {
  return (
    SOURCE_FILTERS.find((f) => f.value === source)?.label ||
    SOURCE_FILTERS[0].label
  );
}

// UnifiedCard - one card layout for the WHOLE collection with source badge.
function UnifiedCard({
  game,
  favorite,
  onFavorite,
  onPlay,
  accent,
}: {
  game: UnifiedGame;
  favorite: boolean;
  onFavorite: () => void;
  onPlay: () => void;
  accent: { active: string; icon: string; chip: string };
}) {
  const external = game.kind === "external" || game.kind === "cloud";
  const tint = SOURCE_TINT[game.source];

  return (
    <div className="group relative rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
      {external ? (
        <a
          href={game.playUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Play ${game.name}`}
          title={`Play ${game.name}`}
          className="absolute inset-0 z-10 w-full h-full flex items-center justify-center"
        >
          <span className="bg-black/40 backdrop-blur-sm text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <ExternalLink size={22} />
          </span>
        </a>
      ) : (
        <button
          onClick={onPlay}
          className="absolute inset-0 z-10 w-full h-full flex items-center justify-center"
          aria-label={`Play ${game.name}`}
          title={`Play ${game.name}`}
        >
          <span className="bg-black/40 backdrop-blur-sm text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={22} fill="currentColor" />
          </span>
        </button>
      )}
      <button
        onClick={onFavorite}
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        className={`absolute top-1.5 right-1.5 z-20 p-1.5 rounded-full ${
          favorite
            ? "bg-rose-500 text-white"
            : "bg-black/30 text-white hover:bg-black/50"
        } transition-colors`}
      >
        <Heart size={14} fill={favorite ? "currentColor" : "none"} />
      </button>

      {/* Source badge */}
      <span
        className={`absolute top-1.5 left-1.5 z-20 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${tint}`}
      >
        {game.sourceLabel}
      </span>

      <div className="relative aspect-video bg-gray-900 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
        <Gamepad2 size={28} className="text-gray-600 opacity-40" />
        {game.coverUrl && (
          <img
            src={game.coverUrl}
            alt={game.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        {external && (
          <span className="absolute bottom-1.5 left-1.5 z-20 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-amber-500/90 text-white">
            {game.kind === "cloud" ? "Cloud" : "Opens site"}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">
          {game.name}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide ${accent.chip} ${accent.icon}`}
          >
            {game.genre.split(",")[0] || "Game"}
          </span>
          {game.plays ? (
            <span className="text-[9px] text-gray-400 dark:text-gray-500">
              {game.plays >= 1_000_000
                ? `${(game.plays / 1_000_000).toFixed(1)}M plays`
                : `${(game.plays / 1_000).toFixed(1)}K plays`}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// UnifiedPlayer - one player modal for the whole collection.
function UnifiedPlayer({
  game,
  fullscreen,
  onToggleFullscreen,
  onClose,
  wrapRef,
}: {
  game: UnifiedGame;
  fullscreen: boolean;
  onToggleFullscreen: (target?: HTMLElement | null) => void;
  onClose: () => void;
  wrapRef: { current: HTMLDivElement | null };
}) {
  const [frameLoading, setFrameLoading] = useState(true);
  const [controlMode, setControlMode] = useState<ControlMode>("auto");
  const [controlStatus, setControlStatus] = useState<GameControlStatus>(() =>
    detectControls(),
  );
  const [controlsOpen, setControlsOpen] = useState(false);
  const [bridgeActive, setBridgeActive] = useState(false);
  const [focusHint, setFocusHint] = useState(true);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setFrameLoading(true);
    setControlMode("auto");
    setBridgeActive(false);
    setFocusHint(true);
  }, [game.id]);

  // Auto-dismiss the one-time "click to focus" hint so it never lingers over
  // the game (we already auto-focus + forward keys, so it's just a nudge).
  useEffect(() => {
    if (!focusHint) return;
    const t = window.setTimeout(() => setFocusHint(false), 4500);
    return () => window.clearTimeout(t);
  }, [focusHint, game.id]);

  const external = game.kind === "external" || game.kind === "cloud";
  const sameOrigin = !external && isSameOriginFrame(game.playUrl);
  const Icon =
    game.kind === "cloud"
      ? Cloud
      : game.kind === "external"
        ? ExternalLink
        : Gamepad2;

  const getFrame = useCallback(() => frameRef.current, []);

  // Auto-focus the game frame once it loads (fixes "keyboard controls don't
  // work" — an iframe only receives keys while IT is focused). Retry a few
  // times in case the frame re-renders after mount.
  useEffect(() => {
    if (external) return;
    let tries = 0;
    let t1 = 0;
    const focus = () => {
      const ok = focusGameFrame(frameRef.current);
      if (!ok && tries < 4) {
        t1 = window.setTimeout(focus, 120);
        tries += 1;
      }
    };
    t1 = window.setTimeout(focus, 80);
    return () => window.clearTimeout(t1);
  }, [game.id, external]);

  // Forward stray keystrokes into the game frame while it isn't focused.
  useEffect(() => {
    if (external) return;
    return forwardKeysToFrame(getFrame);
  }, [external, getFrame]);

  // Gamepad → keyboard bridge. Active for SAME-ORIGIN mirror games when the
  // user chooses Auto or Controller mode. Cross-origin embeds use their own
  // native gamepad support (the `gamepad` permission-policy token is on the
  // iframe) and we only report detection status.
  useEffect(() => {
    if (external || !sameOrigin) {
      setBridgeActive(false);
      setControlStatus(detectControls());
      return;
    }
    const bridgeOn = controlMode === "auto" || controlMode === "gamepad";
    if (!bridgeOn) {
      setBridgeActive(false);
      setControlStatus(detectControls());
      return;
    }
    const handle: GamepadBridgeHandle = startGamepadBridge(getFrame, (s) => {
      setControlStatus(s);
      setBridgeActive(s.gamepadCount > 0);
    });
    return () => {
      handle.stop();
      setBridgeActive(false);
    };
  }, [external, sameOrigin, controlMode, getFrame]);

  const handleSurfacePointerDown = useCallback(() => {
    focusGameFrame(frameRef.current);
    setFocusHint(false);
  }, []);

  const handleSurfaceDoubleClick = useCallback(() => {
    focusGameFrame(frameRef.current);
    setFocusHint(false);
    onToggleFullscreen(wrapRef.current);
  }, [onToggleFullscreen]);

  const activeModeLabel =
    CONTROL_MODES.find((m) => m.value === controlMode)?.label ?? "Auto";
  const activeModeHint =
    CONTROL_MODES.find((m) => m.value === controlMode)?.hint ?? "";
  const modeIcon =
    controlMode === "gamepad"
      ? Gamepad2
      : controlMode === "mouse"
        ? MousePointer2
        : Keyboard;

  return (
    <div
      className={`fixed inset-0 z-[90] bg-gray-950/90 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 ${fullscreen ? "fullscreen-player-overlay" : ""}`}
    >
      <div
        ref={wrapRef}
        className="fuelpro-fullscreen-target relative w-full max-w-5xl bg-black rounded-xl overflow-hidden shadow-2xl"\n        data-fuelpro-fullscreen-target
        style={{
          height: fullscreen
            ? "100dvh"
            : external
              ? "auto"
              : "min(70vh, 640px)",
        }}
      >
        {/* Player header */}
        <div data-fuelpro-fullscreen-chrome className="fuelpro-fullscreen-chrome absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
          <Icon size={16} className="text-emerald-400" />
          <span className="text-white text-sm font-semibold truncate flex-1">
            {game.name}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
            No ads
          </span>
          {!external && (
            <>
              {/* Controls picker */}
              <div className="relative">
                <button
                  onClick={() => setControlsOpen((o) => !o)}
                  title="Controls — choose keyboard / mouse / controller (auto-detected)"
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  {(() => {
                    const ModeIcon = modeIcon;
                    return <ModeIcon size={13} />;
                  })()}
                  {activeModeLabel}
                </button>
                {controlsOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setControlsOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 z-30 w-72 rounded-xl bg-gray-900/95 border border-white/10 shadow-2xl p-3 backdrop-blur-md">
                      <div className="flex items-center gap-2 mb-2">
                        <Cable size={14} className="text-emerald-400" />
                        <span className="text-white text-xs font-semibold">
                          Game controls
                        </span>
                        <span className="ml-auto text-[10px] text-gray-400">
                          auto-detected
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {CONTROL_MODES.map((m) => {
                          const active = controlMode === m.value;
                          return (
                            <button
                              key={m.value}
                              onClick={() => {
                                setControlMode(m.value);
                                setControlsOpen(false);
                              }}
                              className={`flex flex-col items-start gap-1 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                                active
                                  ? "border-emerald-400 bg-emerald-500/15 text-emerald-300"
                                  : "border-white/10 bg-white/5 text-white hover:bg-white/10"
                              }`}
                            >
                              <span className="text-[11px] font-semibold inline-flex items-center gap-1">
                                {m.value === "gamepad" ? (
                                  <Cable size={11} />
                                ) : m.value === "mouse" ? (
                                  <MousePointer2 size={11} />
                                ) : m.value === "keyboard" ? (
                                  <Keyboard size={11} />
                                ) : (
                                  <Check size={11} />
                                )}
                                {m.label}
                              </span>
                              <span
                                className={`text-[9px] leading-tight ${active ? "text-emerald-400/90" : "text-gray-400"}`}
                              >
                                {m.hint}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
                        <p className="text-[10px] text-gray-300 inline-flex items-center gap-1.5">
                          <Gamepad2 size={11} className="text-gray-400" />
                          {controlStatus.gamepadCount > 0
                            ? `${controlStatus.gamepadCount} gamepad connected${bridgeActive && sameOrigin ? " · bridge ON (maps to keyboard)" : ""}`
                            : "No gamepad detected yet"}
                        </p>
                        <p className="text-[10px] text-gray-400 inline-flex items-center gap-1.5">
                          <MousePointer2 size={11} className="text-gray-400" />
                          {controlStatus.touch ? "Touch" : "Mouse"}
                          {controlStatus.keyboard ? " · Keyboard" : ""}
                        </p>
                        {!sameOrigin && !external && (
                          <p className="text-[9px] text-gray-500 leading-snug">
                            External-host embeds can’t be bridged — use the
                            game’s own keyboard/mouse or native gamepad support.
                          </p>
                        )}
                        <p className="text-[9px] text-gray-500 leading-snug">
                          Tip: click the game once to focus it, then play with{" "}
                          {activeModeHint.toLowerCase()}.
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => onToggleFullscreen(wrapRef.current)}
                title={
                  fullscreen
                    ? "Exit fullscreen (double-click too)"
                    : "Fullscreen"
                }
                className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                {fullscreen ? "Exit FS" : "Fullscreen"}
              </button>
            </>
          )}
          <button
            onClick={onClose}
            title="Close"
            className="text-white/80 hover:text-white p-1 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {external ? (
          /* External / cloud launch card */
          <div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-4">
            <div className={`p-3 rounded-2xl ${SOURCE_TINT[game.source]}`}>
              <Icon size={32} />
            </div>
            <div>
              <p className="text-white font-semibold">
                {game.kind === "cloud"
                  ? "Play in the cloud"
                  : "Open on a provider"}
              </p>
              <p className="text-gray-400 text-sm max-w-sm mt-1">
                {game.platform}
              </p>
            </div>
            {game.note && (
              <p className="text-gray-400 text-xs max-w-sm leading-snug">
                {game.note}
              </p>
            )}
            <a
              href={game.playUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
            >
              <ExternalLink size={14} /> Open{" "}
              {game.kind === "cloud" ? "portal" : "game"} in new tab
            </a>
            <p className="text-[11px] text-gray-500">
              {game.kind === "cloud"
                ? "Cloud portals deny iframing (X-Frame-Options: DENY) and need a sign-in."
                : "This provider doesn't allow embedding — it opens in a new tab."}
            </p>
          </div>
        ) : (
          <>
            {frameLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-emerald-500" />
              </div>
            )}
            <iframe
              ref={frameRef}
              src={game.playUrl}
              title={`${game.name} — play`}
              className="fuelpro-fullscreen-content w-full h-full border-0"
              allow="fullscreen; autoplay; gamepad; picture-in-picture"
              data-fuelpro-fullscreen-content
              allowFullScreen
              onLoad={() => {
                setFrameLoading(false);
                focusGameFrame(frameRef.current);
                setFocusHint(false);
              }}
              onPointerDown={handleSurfacePointerDown}
              onDoubleClick={handleSurfaceDoubleClick}
              data-testid="vg-iframe"
            />
            {focusHint && (
              <div className="pointer-events-none absolute inset-x-0 top-10 z-10 flex justify-center">
                <span className="px-3 py-1.5 rounded-full bg-black/70 text-white/90 text-[11px] inline-flex items-center gap-1.5">
                  <Keyboard size={11} /> Click the game once to focus it, then
                  use {activeModeLabel.toLowerCase()} controls
                </span>
              </div>
            )}
          </>
        )}

        {/* Bottom hint */}
        {!external && (
          <div data-fuelpro-fullscreen-chrome className="fuelpro-fullscreen-chrome absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-1.5">
            <span className="text-[10px] text-white/60 truncate">
              {game.sourceLabel}
              {game.platform ? ` · ${game.platform}` : ""}
            </span>
            <span className="ml-auto text-[10px] text-white/50 inline-flex items-center gap-1">
              {controlStatus.gamepadCount > 0 && bridgeActive && sameOrigin ? (
                <>
                  <Cable size={10} className="text-emerald-400" /> Controller
                </>
              ) : (
                <>{statusLabel(controlStatus)}</>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// NotBrowserPlayableInfo - honest note for cloud AAA titles.
const NOT_PLAYABLE = [
  {
    name: "Fortnite",
    why: "Requires the Epic Games client + free account. No browser-exe build exists.",
  },
  {
    name: "GTA V",
    why: "Full client install required (Rockstar Games Launcher) — no official web build.",
  },
  {
    name: "Call of Duty: Warzone",
    why: "Battle.net / console client + account required — not web-playable.",
  },
  {
    name: "Battlefield",
    why: "EA app / Steam client + account — no embeddable web version.",
  },
  {
    name: "reVC (GTA Vice City)",
    why: "The browser port needs YOUR OWN legally-owned game files (DMCA-reformatted) — can't auto-serve without assets.",
  },
];

function NotBrowserPlayableInfo({
  accent,
}: {
  accent: { icon: string; chip: string };
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-2 flex items-center gap-2">
        <Info size={14} className={accent.icon} /> Why &quot;Cloud AAA&quot;
        opens in a new tab
      </h4>
      <div className="space-y-1.5">
        {NOT_PLAYABLE.map((t) => (
          <div
            key={t.name}
            className="flex gap-2 text-xs text-gray-600 dark:text-gray-300"
          >
            <span
              className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${accent.chip} ${accent.icon}`}
            >
              {t.name}
            </span>
            <span>{t.why}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
        These titles need a game client, an account, or paid cloud-streaming —
        no ad-free embeddable web build exists. Browse the thousands of
        in-browser games above (quenq arcade, CrazyGames, Classics, Popular
        &amp; Apps) for instant, ad-free play.
      </p>
    </div>
  );
}
