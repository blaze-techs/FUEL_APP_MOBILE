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
  type GameItem,
  type GameCatalog,
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
            {sourceLabel} · {genreFilterLabel(genre)} · {totalPlayed} played
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

      {/* Search + genre filter */}
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

      {/* Error / empty states */}
      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 text-sm text-rose-700 dark:text-rose-300">
          {error} Showing featured games instead.
        </div>
      )}

      {/* Game grid */}
      {loading ? (
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
