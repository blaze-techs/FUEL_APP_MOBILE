/**
 * QuickSearch.tsx
 * Global quick-search / command palette (Ctrl+K / Cmd+K).
 * Lets users instantly search + jump to any tab, action, or quick link
 * from anywhere in the app. Professional UX pattern used by GitHub,
 * Linear, Notion, etc.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, X, ArrowRight, Layout, Zap, Film, Layers } from "lucide-react";
import {
  switchToTab,
  navigateToTab,
} from "@/react-app/lib/mpesa-integration-service";
import {
  searchSubTabs,
  searchActions,
  type SubTabEntry,
  type QuickActionEntry,
} from "@/react-app/lib/site-search-index";
import {
  searchMovies,
  type MovieItem,
} from "@/react-app/services/MovieService";

interface SearchEntry {
  id: string;
  label: string;
  description?: string;
  category: "Navigation" | "Quick Action";
  tabId?: string;
  action?: () => void;
  keywords?: string;
}

interface QuickSearchProps {
  entries: SearchEntry[];
  /**
   * Hide the visible trigger button (the palette is opened from elsewhere —
   * e.g. the mobile bottom-nav's dedicated Search button, which clicks this
   * hidden trigger). The Ctrl+K/Cmd+K shortcut and programmatic access still
   * work because the button remains in the DOM (display:none only).
   */
  triggerHidden?: boolean;
}

export default function QuickSearch({
  entries,
  triggerHidden,
}: QuickSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Live movie search — debounced against the streaming catalog via the
  // same-origin /api/movies proxy.
  const [movieResults, setMovieResults] = useState<MovieItem[]>([]);
  const [movieSearching, setMovieSearching] = useState(false);
  const movieSeqRef = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMovieResults([]);
      setMovieSearching(false);
      return;
    }
    setMovieSearching(true);
    const seq = ++movieSeqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await searchMovies(q);
        if (movieSeqRef.current === seq) setMovieResults(res.slice(0, 6));
      } catch {
        if (movieSeqRef.current === seq) setMovieResults([]);
      } finally {
        if (movieSeqRef.current === seq) setMovieSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Static site-wide matches (sub-tabs + quick actions) — from the
  // site-search-index registry.
  const [subTabHits, setSubTabHits] = useState<SubTabEntry[]>([]);
  const [actionHits, setActionHits] = useState<QuickActionEntry[]>([]);
  useEffect(() => {
    setSubTabHits(searchSubTabs(query, 8));
    setActionHits(searchActions(query, 4));
  }, [query]);

  // Global keyboard shortcut: Ctrl+K / Cmd+K to toggle.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Focus input when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useCallback(() => {
    if (!query.trim()) return entries.slice(0, 8);
    const q = query.toLowerCase();
    return entries
      .filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q) ||
          e.keywords?.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [query, entries]);

  const results = filtered();

  const openSubTab = useCallback((e: SubTabEntry) => {
    navigateToTab(e.hostTab, { subTab: e.subId });
    setOpen(false);
  }, []);

  const openAction = useCallback((a: QuickActionEntry) => {
    navigateToTab(a.hostTab, a.subId ? { subTab: a.subId } : undefined);
    setOpen(false);
  }, []);

  const openMovie = useCallback((movie: MovieItem) => {
    navigateToTab("news", { subTab: "movies", movieTitle: movie.name });
    setOpen(false);
  }, []);

  const execute = useCallback((entry: SearchEntry) => {
    if (entry.action) {
      entry.action();
    } else if (entry.tabId) {
      switchToTab(entry.tabId);
    }
    setOpen(false);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      execute(results[activeIndex]);
    }
  };

  // Scroll active item into view.
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`flex h-9 items-center gap-2 px-3 rounded-lg bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 text-xs font-medium border border-gray-200 dark:border-white/10 transition-colors ${
          triggerHidden ? "hidden" : ""
        }`}
        aria-label="Quick search (Ctrl+K)"
        title="Quick search (Ctrl+K)"
      >
        <Search size={14} />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-500">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4"
        onClick={() => setOpen(false)}
      >
        {/* Modal */}
        <div
          className="w-full max-w-xl bg-slate-800 rounded-2xl border border-slate-600 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
            <Search size={20} className="text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search anything — tabs, sub-tabs, settings, actions, movies…"
              className="flex-1 bg-transparent text-white placeholder-slate-500 outline-none text-base"
            />
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-white"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
            {(subTabHits.length > 0 || actionHits.length > 0) && (
              <div className="mb-2">
                {subTabHits.length > 0 && (
                  <>
                    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Sub-tabs & Settings
                    </p>
                    {subTabHits.map((e) => (
                      <button
                        key={`sub-${e.hostTab}-${e.subId}`}
                        onClick={() => openSubTab(e)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-slate-700/60 transition-colors group"
                      >
                        <div className="w-7 h-7 rounded bg-slate-700 flex items-center justify-center shrink-0">
                          <Layers size={14} className="text-slate-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">
                            {e.label}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {e.description || e.keywords}
                          </p>
                        </div>
                        <ArrowRight
                          size={14}
                          className="text-slate-600 group-hover:text-slate-400 shrink-0"
                        />
                      </button>
                    ))}
                  </>
                )}
                {actionHits.length > 0 && (
                  <>
                    <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Do it now
                    </p>
                    {actionHits.map((a) => (
                      <button
                        key={`act-${a.label}`}
                        onClick={() => openAction(a)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-slate-700/60 transition-colors group"
                      >
                        <div className="w-7 h-7 rounded bg-slate-700 flex items-center justify-center shrink-0">
                          <Zap size={14} className="text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">
                            {a.label}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {a.description}
                          </p>
                        </div>
                        <ArrowRight
                          size={14}
                          className="text-slate-600 group-hover:text-slate-400 shrink-0"
                        />
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {(movieResults.length > 0 || movieSearching) && (
              <div className="mb-2">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Movies & TV
                </p>
                {movieSearching && movieResults.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-slate-500">
                    Searching the movie catalog…
                  </p>
                ) : (
                  movieResults.map((m) => (
                    <button
                      key={`movie-${m.id}`}
                      onClick={() => openMovie(m)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-slate-700/60 transition-colors group"
                    >
                      <div className="w-8 h-10 rounded bg-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
                        {m.poster ? (
                          <img
                            src={m.poster}
                            alt={m.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Film size={14} className="text-slate-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{m.name}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {m.year ? `${m.year} · ` : ""}
                          {m.type === "tv" ? "Series" : "Movie"}
                        </p>
                      </div>
                      <ArrowRight
                        size={14}
                        className="text-slate-600 group-hover:text-slate-400 shrink-0"
                      />
                    </button>
                  ))
                )}
              </div>
            )}
            {results.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500">
                <Search size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No results for "{query}"</p>
              </div>
            ) : (
              results.map((entry, idx) => (
                <button
                  key={entry.id}
                  onClick={() => execute(entry)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    idx === activeIndex
                      ? "bg-indigo-500/20 text-white"
                      : "text-slate-300 hover:bg-slate-700/50"
                  }`}
                >
                  {entry.category === "Navigation" ? (
                    <Layout size={18} className="shrink-0 text-indigo-400" />
                  ) : (
                    <Zap size={18} className="shrink-0 text-amber-400" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {entry.label}
                    </p>
                    {entry.description && (
                      <p className="text-xs text-slate-500 truncate">
                        {entry.description}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-slate-600 shrink-0">
                    {entry.category}
                  </span>
                  {idx === activeIndex && (
                    <ArrowRight size={14} className="text-slate-500 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-slate-700 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-slate-700 border border-slate-600">
                  ↑↓
                </kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-slate-700 border border-slate-600">
                  ↵
                </kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-slate-700 border border-slate-600">
                  esc
                </kbd>
                close
              </span>
            </div>
            <span>{results.length} results</span>
          </div>
        </div>
      </div>
    </>
  );
}
