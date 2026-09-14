/**
 * VideoGames — the "Video Games" top-level tab.
 *
 * Reverse-engineered quenq.com arcade (1316 Flash/HTML5 games) embedded as a
 * NO-ADS native FuelPro experience:
 *   - Full catalog grid (search + genre filter + responsive cards) with
 *     real thumbnails from quenq's thumbnail CDN (CORS-open).
 *   - Clean iframe player: the game embed page
 *     (quenq.com/arcade/data/games/<slug>/) is a BLACK fullscreen Ruffle
 *     (SWF) player with NO ads and NO X-Frame-Options, so it plays inline.
 *     No upstream branding is surfaced — only the game name + "Play".
 *   - Cloud-synced favorites (bookmarks) + recently-played history
 *     (3-ref guard pattern, same as LiveFeedEmbed / MoviesEmbed).
 *   - Surprise (random) game, fullscreen toggle, played timestamps, a
 *     "featured top games" seed so the grid renders even offline.
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
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  fetchGameCatalog,
  searchGames,
  filterGamesByGenre,
  gameEmbedUrl,
  gameThumbUrl,
  gameGenreLabels,
  CLASSIC_GAMES,
  classicGameEmbedUrl,
  classicGamePageUrl,
  classicCoverUrl,
  CLOUD_AAA_GAMES,
  POPULAR_GAMES,
  CRAZYGAMES_CATEGORIES,
  fetchCrazyGamesCatalog,
  mergeCrazyGamesCatalogs,
  type GameItem,
  type GameCatalog,
  type ClassicGame,
  type CloudAAAGame,
  type PopularGame,
  type CrazyGamesGame,
  type CrazyGamesCatalog,
} from "@/react-app/services/GameCatalogService";

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
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("All");
  // "arcade" = quenq catalog; "classics" = archive.org in-browser DOS classics;
  // "cloud" = official cloud-gaming portals (Fortnite / GTA V / Warzone / Battlefield / reVC);
  // "popular" = the titles users ask for by name (Minecraft, GTA, Angry Birds…);
  // "crazy" = the no-ads CrazyGames catalog (via /api/game-catalog-proxy)
  const [view, setView] = useState<
    "arcade" | "classics" | "cloud" | "popular" | "crazy"
  >("arcade");
  const [activeClassic, setActiveClassic] = useState<ClassicGame | null>(null);
  const [activePopular, setActivePopular] = useState<PopularGame | null>(null);

  // CrazyGames catalog state
  const [crazyCat, setCrazyCat] = useState<CrazyGamesCatalog>({
    source: "crazygames",
    category: "action",
    games: [],
    total: 0,
    page: 1,
    size: 0,
    fetchedAt: 0,
  });
  const [crazyCategory, setCrazyCategory] = useState("action");
  const [crazyLoading, setCrazyLoading] = useState(false);
  const [crazyError, setCrazyError] = useState<string | null>(null);
  const [crazySearch, setCrazySearch] = useState("");
  const [activeCrazy, setActiveCrazy] = useState<CrazyGamesGame | null>(null);

  // Player state
  const [activeGame, setActiveGame] = useState<GameItem | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const playerWrapRef = useRef<HTMLDivElement | null>(null);

  // Pagination — renders a bounded number of cards (no 1,316-node DOM jank
  // on phones; search/filter still scans the full in-memory catalog).
  const PAGE_SIZE = 48;
  const [visibleCount, setCount] = useState(PAGE_SIZE);

  // Cloud state (3-ref guard)
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const favoritesRef = useRef<Set<string>>(new Set());
  const historyRef = useRef<HistoryEntry[]>([]);
  favoritesRef.current = favorites;
  historyRef.current = history;

  // ── Cloud load / persist ───────────────────────────────────────────────
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
          // flush any local edits made before the load completed
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
    (game: GameItem) => {
      const next = new Set(favoritesRef.current);
      if (next.has(game.slug)) next.delete(game.slug);
      else next.add(game.slug);
      // cap the set
      if (next.size > FAVORITES_MAX) {
        const first = next.values().next().value;
        if (first !== undefined) next.delete(first);
      }
      persistFavorites(next);
    },
    [persistFavorites],
  );

  // ── Catalog load ───────────────────────────────────────────────────────
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

  // ── CrazyGames catalog load (per-category, pageable) ───────────────────
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setCrazyLoading(true);
    setCrazyError(null);
    setCrazySearch("");
    fetchCrazyGamesCatalog(crazyCategory, 1, controller.signal)
      .then((cat) => {
        if (cancelled) return;
        if (cat.games.length) {
          setCrazyCat(cat);
          setCrazyError(null);
        } else {
          setCrazyError("Could not load that category right now.");
        }
      })
      .catch(() => {
        if (!cancelled) setCrazyError("Could not load CrazyGames catalog.");
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

  const filteredCrazy = useMemo(() => {
    let list = crazyCat.games;
    const q = crazySearch.trim().toLowerCase();
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q));
    return list;
  }, [crazyCat.games, crazySearch]);

  const visibleCrazy = useMemo(
    () => filteredCrazy.slice(0, 60),
    [filteredCrazy],
  );

  const playCrazy = useCallback((g: CrazyGamesGame) => setActiveCrazy(g), []);

  // ── Derived lists ──────────────────────────────────────────────────────
  const games = useMemo(() => (catalog ? catalog.games : []), [catalog]);

  const filtered = useMemo(() => {
    let list = filterGamesByGenre(games, genre);
    list = searchGames(list, search);
    return list;
  }, [games, genre, search]);

  // Reset the pagination window whenever the filter/search changes so the
  // first page of the new result set is always shown.
  useEffect(() => {
    setCount(PAGE_SIZE);
  }, [search, genre]);

  const visibleGames = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  const recordPlay = useCallback(
    (g: GameItem) => {
      persistHistory({ slug: g.slug, name: g.name, playedAt: Date.now() });
    },
    [persistHistory],
  );

  const pickSurprise = useCallback(() => {
    if (!catalog || !catalog.games.length) return;
    const g = catalog.games[Math.floor(Math.random() * catalog.games.length)];
    setActiveGame(g);
    recordPlay(g);
  }, [catalog, recordPlay]);

  const playGame = useCallback(
    (g: GameItem) => {
      setActiveGame(g);
      recordPlay(g);
    },
    [recordPlay],
  );

  useEffect(() => {
    const el = playerWrapRef.current;
    if (!el) return;
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    if (fullscreen && !document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => setFullscreen(false));
    }
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [fullscreen, activeGame]);

  const exitPlayer = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    setActiveGame(null);
    setFullscreen(false);
  }, []);

  const totalPlayed = history.length;
  const sourceLabel = catalog?.total
    ? `${catalog.total.toLocaleString()} games`
    : loading
      ? "Loading…"
      : "Games";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={`p-2 rounded-lg ${a.chip}`}>
          <Gamepad2 size={16} className={a.icon} />
        </div>
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Video Games
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {view === "arcade"
              ? `${sourceLabel} · ${genreFilterLabel(genre)}`
              : view === "classics"
                ? `${CLASSIC_GAMES.length} in-browser classics`
                : view === "cloud"
                  ? `${CLOUD_AAA_GAMES.length} cloud AAA titles`
                  : view === "crazy"
                    ? crazyCat.total
                      ? `${crazyCat.total.toLocaleString()} ${crazyCat.category} games`
                      : "hundreds of no-ads browser games"
                    : `${POPULAR_GAMES.length} requested titles`}{" "}
            · {totalPlayed} played
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={pickSurprise}
            disabled={!catalog || !catalog.games.length}
            title="Play a random game"
            className="px-3 py-1.5 text-xs font-medium gap-1.5 inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            <Shuffle size={12} /> Surprise
          </button>
        </div>
      </div>

      {/* View switcher: All Games (quenq) / Classics (in-browser DOS archive) */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setView("arcade")}
          className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 rounded-lg transition-colors ${
            view === "arcade"
              ? a.active
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          <Gamepad2 size={12} /> All games (
          {catalog ? catalog.total.toLocaleString() : "…"})
        </button>
        <button
          onClick={() => setView("classics")}
          className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 rounded-lg transition-colors ${
            view === "classics"
              ? a.active
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          <Trophy size={12} /> Greatest classics
        </button>
        <button
          onClick={() => setView("cloud")}
          className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 rounded-lg transition-colors ${
            view === "cloud"
              ? a.active
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          <Cloud size={12} /> AAA in browser
        </button>
        <button
          onClick={() => setView("popular")}
          className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 rounded-lg transition-colors ${
            view === "popular"
              ? a.active
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          <Star size={12} /> Popular
        </button>
        <button
          onClick={() => setView("crazy")}
          className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 rounded-lg transition-colors ${
            view === "crazy"
              ? a.active
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          }`}
        >
          <Globe size={12} /> CrazyGames
        </button>
      </div>

      {/* Search + genre filter (arcade view only) */}
      {view === "arcade" && (
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
              placeholder="Search games by name or genre…"
              className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {catalog && catalog.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
              {["All", ...catalog.genres].map((g) => (
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
          )}
        </div>
      )}

      {/* Error / empty states */}
      {error && view === "arcade" && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 text-sm text-rose-700 dark:text-rose-300">
          {error} Showing featured games instead.
        </div>
      )}

      {/* ── CLASSICS view (archive.org in-browser DOS emulator) ── */}
      {view === "classics" ? (
        <>
          <ClassicsSection
            activeGame={activeClassic}
            onPlay={(c) => setActiveClassic(c)}
            onClose={() => setActiveClassic(null)}
            accent={a}
          />
          <NotBrowserPlayableInfo accent={a} />
        </>
      ) : view === "cloud" ? (
        <>
          <CloudAAASection accent={a} />
          <NotBrowserPlayableInfo accent={a} />
        </>
      ) : view === "popular" ? (
        <PopularSection
          activeGame={activePopular}
          onPlay={setActivePopular}
          onClose={() => setActivePopular(null)}
          accent={a}
        />
      ) : view === "crazy" ? (
        <CrazyGamesSection
          activeGame={activeCrazy}
          onPlay={playCrazy}
          onClose={() => setActiveCrazy(null)}
          accent={a}
          loading={crazyLoading}
          error={crazyError}
          search={crazySearch}
          onSearch={setCrazySearch}
          category={crazyCategory}
          onCategory={setCrazyCategory}
          games={visibleCrazy}
          filteredTotal={filteredCrazy.length}
          total={crazyCat.total}
          onLoadMore={loadMoreCrazy}
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-emerald-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Gamepad2 size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No games match your search.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {visibleGames.map((g) => (
              <GameCard
                key={g.slug}
                game={g}
                favorite={favorites.has(g.slug)}
                onFavorite={() => toggleFavorite(g)}
                onPlay={() => playGame(g)}
                accent={a}
              />
            ))}
          </div>
          {visibleGames.length < filtered.length && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setCount((c) => c + PAGE_SIZE)}
                className="px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
              >
                Load more
                <span className="text-emerald-100 text-xs">
                  ({visibleGames.length.toLocaleString()} /{" "}
                  {filtered.length.toLocaleString()})
                </span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Recently played */}
      {history.length > 0 && activeGame === null && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm mb-2 flex items-center gap-2">
            <Clock size={14} className={a.icon} /> Recently played
          </h4>
          <div className="flex flex-wrap gap-2">
            {history.slice(0, 8).map((h) => (
              <button
                key={h.slug}
                onClick={() => {
                  const g = games.find((x) => x.slug === h.slug);
                  if (g) playGame(g);
                }}
                className="px-2.5 py-1 rounded-lg text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                {h.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Player modal (no ads) */}
      {activeGame && (
        <GamePlayer
          game={activeGame}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((f) => !f)}
          onClose={exitPlayer}
          wrapRef={playerWrapRef}
        />
      )}
    </div>
  );
}

function genreFilterLabel(genre: string): string {
  return genre === "All" ? "All genres" : genre;
}

// ─── GameCard ────────────────────────────────────────────────────────────────
function GameCard({
  game,
  favorite,
  onFavorite,
  onPlay,
  accent,
}: {
  game: GameItem;
  favorite: boolean;
  onFavorite: () => void;
  onPlay: () => void;
  accent: {
    active: string;
    icon: string;
    chip: string;
  };
}) {
  const labels = gameGenreLabels(game);
  return (
    <div className="group relative rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
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
      <div className="aspect-video bg-gray-900 dark:bg-gray-900 overflow-hidden">
        <img
          src={gameThumbUrl(game)}
          alt={game.name}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="p-2.5">
        <p className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">
          {game.name}
        </p>
        {labels.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {labels.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide ${accent.chip} ${accent.icon}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── GamePlayer ──────────────────────────────────────────────────────────────
function GamePlayer({
  game,
  fullscreen,
  onToggleFullscreen,
  onClose,
  wrapRef,
}: {
  game: GameItem;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  wrapRef: { current: HTMLDivElement | null };
}) {
  const [frameLoading, setFrameLoading] = useState(true);
  const embedSrc = gameEmbedUrl(game);

  useEffect(() => setFrameLoading(true), [embedSrc]);

  return (
    <div className="fixed inset-0 z-[90] bg-gray-950/90 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div
        ref={wrapRef}
        className="relative w-full max-w-5xl bg-black rounded-xl overflow-hidden shadow-2xl"
        style={{ height: fullscreen ? "100%" : "min(70vh, 640px)" }}
      >
        {/* Player header */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
          <Gamepad2 size={16} className="text-emerald-400" />
          <span className="text-white text-sm font-semibold truncate flex-1">
            {game.name}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
            No ads
          </span>
          <button
            onClick={onToggleFullscreen}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="text-white/80 hover:text-white p-1 transition-colors"
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={onClose}
            title="Close"
            className="text-white/80 hover:text-white p-1 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {frameLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-emerald-500" />
          </div>
        )}

        <iframe
          src={embedSrc}
          title={`${game.name} — play`}
          className="w-full h-full border-0"
          allow="fullscreen; autoplay"
          onLoad={() => setFrameLoading(false)}
        />

        {/* Bottom hint */}
        <div className="absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-1.5">
          <span className="text-[10px] text-white/60 truncate">
            {gameGenreLabels(game).join(" · ")}
          </span>
          <span className="ml-auto text-[10px] text-white/40">Play</span>
        </div>
      </div>
    </div>
  );
}
// ─── ClassicsSection ─────────────────────────────────────────────────────────
// "Greatest classics" — in-browser DOS/Windows games (ad-free, no login) from
// archive.org's Internet Arcade emulator. These are the browser-playable
// stand-ins for the classic AAA titles.
function ClassicsSection({
  activeGame,
  onPlay,
  onClose,
  accent,
}: {
  activeGame: ClassicGame | null;
  onPlay: (c: ClassicGame) => void;
  onClose: () => void;
  accent: { active: string; icon: string; chip: string };
}) {
  const classics = CLASSIC_GAMES;
  const [frameLoading, setFrameLoading] = useState(true);

  useEffect(() => setFrameLoading(true), [activeGame?.id]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg ${accent.chip}`}>
          <Trophy size={14} className={accent.icon} />
        </div>
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
            Greatest classics — play in your browser
          </h4>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {classics.length} classic titles · ad-free · no install needed
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {classics.map((c) => (
          <div
            key={c.id}
            className="group relative rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
          >
            <button
              onClick={() => onPlay(c)}
              className="absolute inset-0 z-10 w-full h-full flex items-center justify-center"
              aria-label={`Play ${c.name}`}
              title={`Play ${c.name}`}
            >
              <span className="bg-black/40 backdrop-blur-sm text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play size={22} fill="currentColor" />
              </span>
            </button>
            <div className="relative aspect-video bg-gray-900 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
              <Trophy size={28} className="text-amber-400 opacity-70" />
              <img
                src={classicCoverUrl(c.id)}
                alt={c.name}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
                onError={(e) => {
                  // fall back to the trophy placeholder if cover art is missing
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
            <div className="p-2.5">
              <p className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">
                {c.name}
              </p>
              <span
                className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide ${accent.chip} ${accent.icon}`}
              >
                {c.genre}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Classic player modal */}
      {activeGame && (
        <div className="fixed inset-0 z-[90] bg-gray-950/90 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div
            className="relative w-full max-w-5xl bg-black rounded-xl overflow-hidden shadow-2xl"
            style={{ height: "min(80vh, 700px)" }}
          >
            <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
              <Trophy size={16} className="text-amber-400" />
              <span className="text-white text-sm font-semibold truncate flex-1">
                {activeGame.name}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                No ads
              </span>
              <a
                href={classicGamePageUrl(activeGame.id)}
                target="_blank"
                rel="noreferrer"
                className="text-white/70 hover:text-white text-[11px] px-2 py-0.5 rounded bg-white/10"
              >
                Info
              </a>
              <button
                onClick={onClose}
                title="Close"
                className="text-white/80 hover:text-white p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {frameLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-emerald-500" />
              </div>
            )}

            <iframe
              src={classicGameEmbedUrl(activeGame.id)}
              title={`${activeGame.name} — play`}
              className="w-full h-full border-0"
              allow="fullscreen; autoplay"
              onLoad={() => setFrameLoading(false)}
            />

            <div className="absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-1.5">
              <span className="text-[10px] text-white/60 truncate">
                {activeGame.note}
              </span>
              <span className="ml-auto text-[10px] text-white/40">Play</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CloudAAASection ─────────────────────────────────────────────────────────
// Current-gen AAA titles (Fortnite / GTA V / Warzone / Battlefield / reVC).
// These officially stream in a browser via cloud-gaming portals, but every
// portal sends X-Frame-Options: DENY (login + DRM) so they must open in a new
// tab. Every URL below is a verified working launch path (probed live 2026-09-14).
const CLOUD_ACCENT: Record<
  CloudAAAGame["accent"],
  { chip: string; text: string; badge: string }
> = {
  sky: {
    chip: "bg-sky-500/10",
    text: "text-sky-600 dark:text-sky-400",
    badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  emerald: {
    chip: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  rose: {
    chip: "bg-rose-500/10",
    text: "text-rose-600 dark:text-rose-400",
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  },
  violet: {
    chip: "bg-violet-500/10",
    text: "text-violet-600 dark:text-violet-400",
    badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  amber: {
    chip: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
};

function CloudAAASection({
  accent,
}: {
  accent: { chip: string; icon: string };
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg ${accent.chip}`}>
          <Cloud size={14} className={accent.icon} />
        </div>
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
            AAA titles — play in your browser (cloud streaming)
          </h4>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Official portals (Xbox Cloud Gaming / GeForce NOW). Free tiers exist
            — sign-in + queue required. Opens in a new tab.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CLOUD_AAA_GAMES.map((g) => {
          const c = CLOUD_ACCENT[g.accent];
          return (
            <div
              key={g.id}
              className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors overflow-hidden flex flex-col gap-2"
            >
              <div className="relative aspect-video bg-gray-900 dark:bg-gray-900 flex items-center justify-center">
                <div className={`p-1.5 rounded-lg ${c.chip}`}>
                  <Cloud size={18} className={c.text} />
                </div>
                <img
                  src={g.image}
                  alt={g.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              </div>

              <div className="px-3.5 pt-1 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {g.name}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      {g.genre}
                    </p>
                  </div>
                  <span
                    className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide ${c.badge}`}
                  >
                    {g.free ? "Free to play" : "Library"}
                  </span>
                </div>

                <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                  {g.how}
                </p>

                <p className="text-[10px] leading-snug py-1.5 px-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
                  ⚠ {g.regionNote}
                </p>

                <a
                  href={g.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`Play ${g.name} on ${g.platform}`}
                  className="mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                >
                  <ExternalLink size={12} /> Play on {g.platform}
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        No free-streaming portal can be embedded directly (they all block
        iframing with <code>X-Frame-Options: DENY</code> and need a sign-in).
        Tapping a "Play" button above opens the official portal on the game's
        page in a new tab — one tap away from actually playing.
      </p>
    </div>
  );
}

// ─── PopularSection ──────────────────────────────────────────────────────────
// The titles users ask for by name (Minecraft, GTA, Angry Birds…). Each entry
// is a REAL verified embed or a verified best-path launch link.
function PopularSection({
  activeGame,
  onPlay,
  onClose,
  accent,
}: {
  activeGame: PopularGame | null;
  onPlay: (g: PopularGame) => void;
  onClose: () => void;
  accent: { active: string; icon: string; chip: string };
}) {
  const [frameLoading, setFrameLoading] = useState(true);
  useEffect(() => setFrameLoading(true), [activeGame?.id]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg ${accent.chip}`}>
          <Star size={14} className={accent.icon} />
        </div>
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
            Popular &amp; requested — play in your browser
          </h4>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {POPULAR_GAMES.length} requested titles · verified no-ads sources
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {POPULAR_GAMES.map((g) => {
          const isExternal = g.kind === "external";
          return (
            <div
              key={g.id}
              className="group relative rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              {isExternal ? (
                <a
                  href={g.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`Play ${g.name}`}
                  title={`Play ${g.name}`}
                  className="absolute inset-0 z-10 w-full h-full flex items-center justify-center"
                >
                  <span className="bg-black/40 backdrop-blur-sm text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ExternalLink size={22} />
                  </span>
                </a>
              ) : (
                <button
                  onClick={() => onPlay(g)}
                  className="absolute inset-0 z-10 w-full h-full flex items-center justify-center"
                  aria-label={`Play ${g.name}`}
                  title={`Play ${g.name}`}
                >
                  <span className="bg-black/40 backdrop-blur-sm text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play size={22} fill="currentColor" />
                  </span>
                </button>
              )}
              <div className="relative aspect-video bg-gray-900 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
                <Star size={28} className="text-amber-400 opacity-70" />
                <img
                  src={g.image}
                  alt={g.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
                {isExternal && (
                  <span className="absolute top-1.5 left-1.5 z-20 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-amber-500/90 text-white">
                    Opens site
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <p className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">
                  {g.name}
                </p>
                <span
                  className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide ${accent.chip} ${accent.icon}`}
                >
                  {g.genre}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        {activeGame && activeGame.kind !== "external" ? (
          <span>Playing: {activeGame.name}</span>
        ) : (
          <span>
            Titles marked "Opens site" launch on a verified provider in a new
            tab — those providers do not allow embedding (their choice).
          </span>
        )}
      </p>

      {/* Popular player modal */}
      {activeGame && activeGame.kind !== "external" && (
        <div className="fixed inset-0 z-[90] bg-gray-950/90 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div
            className="relative w-full max-w-5xl bg-black rounded-xl overflow-hidden shadow-2xl"
            style={{ height: "min(80vh, 700px)" }}
          >
            <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
              <Star size={16} className="text-amber-400" />
              <span className="text-white text-sm font-semibold truncate flex-1">
                {activeGame.name}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                No ads
              </span>
              <button
                onClick={onClose}
                title="Close"
                className="text-white/80 hover:text-white p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {frameLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-emerald-500" />
              </div>
            )}

            <iframe
              src={activeGame.url}
              title={`${activeGame.name} — play`}
              className="w-full h-full border-0"
              allow="fullscreen; autoplay"
              onLoad={() => setFrameLoading(false)}
            />

            <div className="absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-1.5">
              <span className="text-[10px] text-white/60 truncate">
                {activeGame.note}
              </span>
              <span className="ml-auto text-[10px] text-white/40">Play</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CrazyGamesSection ──────────────────────────────────────────────────────
// The "CrazyGames" view — a full no-ads catalog of browser-playable HTML5
// games fetched via /api/game-catalog-proxy. Covers metadata (imgs.crazygames
// .com) + direct clean embeds (games.crazygames.com).
function CrazyGamesSection({
  activeGame,
  onPlay,
  onClose,
  accent,
  loading,
  error,
  search,
  onSearch,
  category,
  onCategory,
  games,
  filteredTotal,
  total,
  onLoadMore,
}: {
  activeGame: CrazyGamesGame | null;
  onPlay: (g: CrazyGamesGame) => void;
  onClose: () => void;
  accent: { active: string; icon: string; chip: string };
  loading: boolean;
  error: string | null;
  search: string;
  onSearch: (s: string) => void;
  category: string;
  onCategory: (c: string) => void;
  games: CrazyGamesGame[];
  filteredTotal: number;
  total: number;
  onLoadMore: () => void;
}) {
  const [frameLoading, setFrameLoading] = useState(true);
  useEffect(() => setFrameLoading(true), [activeGame?.slug]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-lg ${accent.chip}`}>
          <Globe size={14} className={accent.icon} />
        </div>
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white text-sm">
            CrazyGames — no-ads browser games
          </h4>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {total > 0
              ? `${total.toLocaleString()} ${category} games`
              : "hundreds of games"}{" "}
            · plays directly · no ads
          </p>
        </div>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-1.5">
        {CRAZYGAMES_CATEGORIES.map((c) => (
          <button
            key={c.slug}
            onClick={() => onCategory(c.slug)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
              category === c.slug
                ? accent.active
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Search within loaded games */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search loaded CrazyGames (category-wide search comes next)…"
          className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {loading && !games.length ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-emerald-500" />
        </div>
      ) : games.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Globe size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No games match your search.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {games.map((g, i) => (
              <CrazyGameCard
                key={`${category}-${g.slug}-${i}`}
                game={g}
                onPlay={() => onPlay(g)}
                accent={accent}
              />
            ))}
          </div>
          {games.length === filteredTotal && filteredTotal < total && (
            <div className="flex justify-center pt-1">
              <button
                onClick={onLoadMore}
                disabled={loading}
                className="px-5 py-2.5 text-sm font-medium inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Globe size={14} />
                )}
                Load more ({games.length.toLocaleString()} /{" "}
                {total.toLocaleString()})
              </button>
            </div>
          )}
        </>
      )}

      {/* CrazyGames player modal (clean direct embed) */}
      {activeGame && (
        <div className="fixed inset-0 z-[90] bg-gray-950/90 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div
            className="relative w-full max-w-5xl bg-black rounded-xl overflow-hidden shadow-2xl"
            style={{ height: "min(80vh, 700px)" }}
          >
            <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2 px-3 py-2 bg-gradient-to-b from-black/70 to-transparent">
              <Globe size={16} className="text-emerald-400" />
              <span className="text-white text-sm font-semibold truncate flex-1">
                {activeGame.name}
              </span>
              <span className="text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                No ads
              </span>
              <button
                onClick={onClose}
                title="Close"
                className="text-white/80 hover:text-white p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {frameLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={28} className="animate-spin text-emerald-500" />
              </div>
            )}

            <iframe
              src={activeGame.embedUrl}
              title={`${activeGame.name} — play`}
              className="w-full h-full border-0"
              allow="fullscreen; autoplay; gamepad"
              onLoad={() => setFrameLoading(false)}
            />

            <div className="absolute bottom-0 left-0 right-0 z-10 px-3 py-1.5 bg-gradient-to-t from-black/70 to-transparent flex items-center gap-1.5">
              <span className="text-[10px] text-white/60 truncate">
                {activeGame.plays > 0
                  ? `${activeGame.plays.toLocaleString()} plays`
                  : activeGame.category}
                {activeGame.year ? ` · ${activeGame.year}` : ""}
              </span>
              <span className="ml-auto text-[10px] text-white/40">Play</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CrazyGameCard ──────────────────────────────────────────────────────────
function CrazyGameCard({
  game,
  onPlay,
  accent,
}: {
  game: CrazyGamesGame;
  onPlay: () => void;
  accent: { chip: string; icon: string };
}) {
  return (
    <div className="group relative rounded-xl overflow-hidden bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
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
      <div className="relative aspect-video bg-gray-900 dark:bg-gray-900 flex items-center justify-center overflow-hidden">
        <Globe size={28} className="text-emerald-400 opacity-60" />
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
      </div>
      <div className="p-2.5">
        <p className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">
          {game.name}
        </p>
        <span
          className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide ${accent.chip} ${accent.icon}`}
        >
          {game.category || "Game"}
        </span>
      </div>
    </div>
  );
}

// ─── NotBrowserPlayableInfo ──────────────────────────────────────────────────
// Honest note: titles like Fortnite / GTA 5 / Warzone / Battlefield / reVC
// have no legal no-ads embeddable web build (they need a client install +
// account, or a paid/branded cloud-streaming login). Embedding pirated or
// account-walled builds would violate "NO ADS" and copyright.
const NOT_PLAYABLE = [
  {
    name: "Fortnite",
    why: "Requires the Epic Games client + free account. No browser-exe build exists.",
  },
  {
    name: "GTA V",
    why: "Full client install required (Rockstar/Rockstar Games Launcher) — no official web build.",
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
        <Info size={14} className={accent.icon} /> Why you can't play AAA titles
        like Fortnite / GTA V in the browser
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
        no ad-free embeddable web build exists. The "Greatest classics" section
        above brings you the closest legal browser-playable classics (DOOM, Duke
        Nukem 3D, Quake, Wolfenstein 3D…).
      </p>
    </div>
  );
}
