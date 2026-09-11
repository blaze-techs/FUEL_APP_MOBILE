/**
 * MoviesEmbed — the Movies sub-tab (reverse-engineered streamingunity.vip /
 * StreamingCommunity mirror). Renders a native FuelPro movie + series catalog
 * (movies, series, TV shows, limited series) with search, genre filter, type
 * filter, surprise pick, cloud-synced favorites / watchlist / continue-
 * watching, a detail modal with season/episode picker, and a NATIVE hls.js
 * player (the raw HLS playlist chain is CORS-open, so playback needs no
 * iframe — the upstream embed iframe is kept only as an explicit fallback).
 *
 * Matches the LiveFeedEmbed feature set so all live-content sub-tabs in the
 * News tab behave consistently. Cloud sync uses the 3-ref guard pattern
 * (cloudLoadCompleteRef / localModifiedRef / post-load flush) to prevent the
 * flash-then-blank data-loss bug.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import {
  Film,
  Search,
  Star,
  Shuffle,
  Heart,
  Clock,
  Play,
  X,
  Bookmark,
  BookmarkCheck,
  ListVideo,
  Loader2,
  History,
  Trash2,
  MonitorPlay,
  Tv,
  Clapperboard,
  RotateCcw,
  Settings2,
  Server,
  Captions,
  Volume2,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import {
  usePopupShield,
  PopupShieldBadge,
} from "@/react-app/components/ui/PopupShieldBadge";
import {
  armNavGuard,
  getLastGestureTime,
  noteBlockedEvent,
} from "@/react-app/lib/ad-blocker";
import {
  fetchMovieCatalog,
  fetchMovieBrowse,
  searchMovies,
  fetchMovieDetail,
  fetchMovieStreams,
  fetchClassicMovies,
  fetchClassicDetail,
  type MovieItem,
  type MovieDetail,
  type MovieGenre,
  type MovieStreamInfo,
  type ClassicMovieItem,
} from "@/react-app/services/MovieService";

// ─── Cloud keys ----------------------------------------------------------------
const FAVORITES_KEY = "movie_favorites";
const WATCHLIST_KEY = "movie_watchlist";
const HISTORY_KEY = "movie_history";
const AUTO_NEXT_KEY = "movie_auto_next";
const HISTORY_MAX = 24;
const FAVORITES_MAX = 100;

type ViewMode = "catalog" | "search" | "genre" | "classics";
type TypeFilter = "all" | "movie" | "tv";

interface Props {
  accent?: "blue" | "purple" | "amber";
  /** External search seed (QuickSearch / AI Chatbot deep links). */
  searchSeed?: string;
  /** Changes on every new seed (even identical queries) to re-fire. */
  searchSeedKey?: number;
}

// ─── MoviePlayer — native hls.js player for the reverse-engineered stream ─────
// Plays the raw HLS playlist DIRECTLY from the user's browser: vixcloud
// serves residential/browser IPs with ACAO:* but blocks all datacenter IPs,
// and segment tokens are IP-bound to whoever fetched the playlist — so the
// browser is the only workable path. The upstream title page is offered as a
// last-resort fallback when the stream is unreachable.
function MoviePlayer({
  streamInfo,
  title,
  poster,
  onClose,
  onRotateServer,
  activeServerIdx,
  serverNames,
  onAllFailed,
}: {
  streamInfo: MovieStreamInfo;
  title: string;
  poster: string | null;
  onClose: () => void;
  onRotateServer?: (idx: number) => void;
  activeServerIdx?: number;
  serverNames?: string[];
  /** Called once after the auto-rotation engine exhausts all candidates + cycles. */
  onAllFailed?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [levels, setLevels] = useState<
    { height: number; bitrate: number; hlsIndex: number }[]
  >([]);
  const [currentLevel, setCurrentLevel] = useState(-1); // -1 = auto (hls index)
  const [error, setError] = useState<string | null>(null);
  const [showQuality, setShowQuality] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [showServers, setShowServers] = useState(false);
  // A/V boost + sync support: routes the video element through
  // MediaElementAudioSourceNode → GainNode so quiet sources can be amplified,
  // and so buffered drift can be corrected once (keeping audio aligned to
  // the picture). The boost engages on <video> loadmetadata; guarded so
  // sources with healthy audio are untouched (boost toggle becomes active
  // only when boost is on).
  const audioChainRef = useRef<{
    ctx: AudioContext;
    srcNode: MediaElementAudioSourceNode;
    gainNode: GainNode;
  } | null>(null);
  const [boostActive, setBoostActive] = useState(false);
  const toggleBoost = useCallback(() => {
    const chain = audioChainRef.current;
    if (!chain) return;
    const nextGain = boostActive ? 1.0 : 4.0;
    try {
      chain.gainNode.gain.setTargetAtTime(nextGain, chain.ctx.currentTime, 0.1);
      setBoostActive(!boostActive);
    } catch {}
  }, [boostActive]);
  const attachAudioChain = useCallback((video: HTMLVideoElement) => {
    if (audioChainRef.current) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const srcNode = ctx.createMediaElementSource(video);
      const gainNode = ctx.createGain();
      srcNode.connect(gainNode);
      gainNode.connect(ctx.destination);
      audioChainRef.current = { ctx, srcNode, gainNode };
    } catch {
      // CORS block / captured earlier / unsupported browser → fall back to
      // native <video> src (no boost, but playback unaffected).
    }
  }, []);
  const detachAudioChain = useCallback(() => {
    const chain = audioChainRef.current;
    if (!chain) return;
    try {
      chain.srcNode.disconnect();
      chain.gainNode.disconnect();
      chain.ctx.close().catch(() => {});
    } catch {}
    audioChainRef.current = null;
    setBoostActive(false);
  }, []);
  // Subtitle (CC) + audio-language tracks from the HLS master playlist.
  const [subtitleTracks, setSubtitleTracks] = useState<
    { id: number; name: string; lang: string }[]
  >([]);
  const [audioTracks, setAudioTracks] = useState<
    { id: number; name: string; lang: string }[]
  >([]);
  const [activeSubtitle, setActiveSubtitle] = useState(-1); // -1 = off
  const [activeAudio, setActiveAudio] = useState(-1); // -1 = default
  const [showSubs, setShowSubs] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  // Escape hatch: skip the bare-URL reachability check and go straight to the
  // same-origin proxy (user-triggered when their IP is blocked).
  const [forceProxyNonce, setForceProxyNonce] = useState(0);
  // Auto-rotation engine: cycle through candidates with progress, auto-retry
  // the whole chain, and only surface the error after sustained failure.
  const [rotating, setRotating] = useState(false);
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [autoRetryIn, setAutoRetryIn] = useState<number | null>(null);
  const MAX_CYCLES = 3;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    detachAudioChain();
    video.addEventListener("loadedmetadata", () => attachAudioChain(video), {
      once: true,
    });
    setError(null);
    setLevels([]);
    setCurrentLevel(-1);
    setSubtitleTracks([]);
    setAudioTracks([]);
    setAutoRetryIn(null);
    setCycle(0);
    setRotating(true);

    // onFatal: either advance to the next candidate (show progress), restart
    // a new cycle, or — after MAX_CYCLES — surface the error with an
    // auto-retry countdown.
    //
    // RAPID-ROTATION FIX: one candidate can emit MULTIPLE fatal errors (an
    // hls.js manifest retry fail + level fail + several frag fails), and each
    // was advancing to the next candidate — effectively skipping working
    // sources every second. `busy` debounces so ONE candidate only advances
    // ONCE; it is cleared when the next candidate attaches.
    const onFatalRef = { current: null as null | (() => void) };
    const failState = {
      idx: 0,
      len: 0,
      cycle: 0,
      exhausted: false,
      busy: false,
    };
    const updateProgress = () => {
      setCandidateIdx(failState.idx);
      setCandidateTotal(failState.len);
      setCycle(failState.cycle);
    };
    const finalize = () => {
      if (failState.exhausted) return; // idempotent — only finalize once
      failState.exhausted = true;
      setRotating(false);
      setError(
        "This title's stream is temporarily unreachable right now. " +
          "We already tried every available server automatically. " +
          "It usually recovers quickly — auto-retrying below.",
      );
      // keep auto-retrying in the background so the error is transient, and
      // let the parent offer a guaranteed fallback (embed player / trailer).
      if (onAllFailed) onAllFailed();
    };
    const onFatal = () => {
      if (failState.busy) return; // a failure for this candidate is in flight
      failState.busy = true;
      if (failState.idx < failState.len - 1) {
        failState.idx += 1;
        updateProgress();
        hlsRef.current?.destroy();
        hlsRef.current = null;
        void attach(candidates[failState.idx]);
        return;
      }
      // Start a new cycle unless we've hit MAX_CYCLES.
      if (failState.cycle < MAX_CYCLES - 1) {
        failState.cycle += 1;
        failState.idx = 0;
        updateProgress();
        void attach(candidates[0]);
        return;
      }
      finalize();
    };
    onFatalRef.current = onFatal;

    // ── Candidate playlist URLs ────────────────────────────────────────────
    // CRITICAL IP-BOUND TOKEN FIX: the serverless proxy fetched the playlist
    // so its token/expires params are bound to the datacenter IP. Reattaching
    // them to the bare server URLs made every segment 403 in the browser
    // (the "stuck at 0:00" bug). The BARE server URLs (…?ub=1 / ?ab=1) are
    // PUBLIC — the user's browser fetches them and vixcloud mints a playlist
    // whose tokens are bound to the USER'S IP → playable. We verify the bare
    // URL is reachable (and contains #EXTM3U) before handing it to hls.js,
    // and fall back to the same-origin /api/hls-proxy if even that fails.
    const bareFromPlaylist = (() => {
      try {
        const u = new URL(streamInfo.playlistUrl);
        const variant = u.searchParams.get("ub")
          ? "ub=1"
          : u.searchParams.get("ab")
            ? "ab=1"
            : null;
        return variant ? `${u.origin}${u.pathname}?${variant}` : null;
      } catch {
        return null;
      }
    })();
    const bareServerUrls = (streamInfo.servers || [])
      .filter((s) => s.url)
      .map((s) => s.url);
    const directCandidates = [
      ...bareServerUrls,
      ...(bareFromPlaylist && !bareServerUrls.includes(bareFromPlaylist)
        ? [bareFromPlaylist]
        : []),
    ];
    if (directCandidates.length === 0) {
      directCandidates.push(streamInfo.playlistUrl);
    }

    // Proxy candidates — the Cloudflare edge can fetch playlist+segments
    // server-side (vixcloud allows it), so this works even when the user's
    // IP is blocked. Kept as fallback, tried only if direct fails.
    const tokened = [
      streamInfo.playlistUrl,
      ...(streamInfo.servers || [])
        .filter((s) => s.url)
        .map((s) => {
          try {
            const pl = new URL(streamInfo.playlistUrl);
            const u = new URL(s.url, pl.origin);
            for (const key of ["token", "expires", "asn", "h"]) {
              const v = pl.searchParams.get(key);
              if (v && !u.searchParams.get(key)) u.searchParams.set(key, v);
            }
            return u.href;
          } catch {
            return s.url;
          }
        }),
    ];
    const proxyCandidates = tokened.map(
      (u) => `/api/hls-proxy?url=${encodeURIComponent(u)}`,
    );

    const candidates =
      forceProxyNonce > 0
        ? proxyCandidates // user forced proxy — skip the bare-URL checks
        : [...directCandidates, ...proxyCandidates];
    let destroyed = false;
    failState.len = candidates.length;
    updateProgress();

    // Initialize UI-side progress so the "Trying source N of M" overlay is
    // accurate. failState is mutated by onFatal; updateProgress mirrors it.
    // (declared above so onFatal can call it before assignment in closure).

    // Watchdog — if the video hasn't started within the timeout, advance to
    // the next candidate via onFatal (progress) instead of a hard error.
    // 12s gives a genuinely-working (but slow) source enough time to start,
    // so we never skip past a source that would have played.
    const WATCHDOG_MS = 12000;
    let watchdog: number | null = null;
    const resetWatchdog = () => {
      if (watchdog !== null) window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => {
        if (video.readyState === 0 && video.paused && !failState.exhausted) {
          onFatalRef.current?.();
        }
      }, WATCHDOG_MS);
    };
    const clearPlayTimeout = () => {
      if (watchdog !== null) window.clearTimeout(watchdog);
      watchdog = null;
    };
    const onPlaying = () => {
      clearPlayTimeout();
      setRotating(false);
    };
    video.addEventListener("playing", onPlaying);

    const attachHls = (src: string) => {
      const hls = new Hls({
        enableWorker: false,
        manifestLoadingTimeOut: 12000,
        levelLoadingTimeOut: 12000,
        fragLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 600,
        levelLoadingRetryDelay: 600,
        fragLoadingRetryDelay: 800,
        fetchSetup: (context, initParams) =>
          new Request(context.url, {
            ...initParams,
            referrerPolicy: "no-referrer",
            credentials: "omit",
          }),
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const lv = (hls.levels || [])
          .map((l, hlsIndex) => ({
            height: l.height,
            bitrate: l.bitrate,
            hlsIndex,
          }))
          .sort((a, b) => b.height - a.height);
        setLevels(lv);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
        setSubtitleTracks(
          (data.subtitleTracks || []).map((t, i) => ({
            id: i,
            name: t.name || t.lang || `Track ${i + 1}`,
            lang: t.lang || "",
          })),
        );
      });
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
        setAudioTracks(
          (data.audioTracks || []).map((t, i) => ({
            id: i,
            name: t.name || t.lang || `Audio ${i + 1}`,
            lang: t.lang || "",
          })),
        );
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        // Any fatal network error: advance to the next candidate via
        // onFatal (progress bar advances; cycles and auto-retries kick in
        // automatically).
        onFatal();
      });
      return hls;
    };

    const attach = async (src: string): Promise<void> => {
      if (destroyed) return;
      // A NEW candidate is now attaching — clear the failure-in-flight flag
      // so the first error for THIS candidate can advance again.
      failState.busy = false;
      // (Re)arm the stall watchdog on every attempt so a hung candidate is
      // advanced automatically instead of spinning forever.
      resetWatchdog();
      const isProxy = src.startsWith("/api/");
      if (!isProxy) {
        // Verify the bare URL is reachable from THIS browser first —
        // otherwise hls.js would loop on a 403 forever.
        try {
          const res = await fetch(src, {
            referrerPolicy: "no-referrer",
            credentials: "omit",
            cache: "no-store",
          });
          if (!res.ok) throw new Error(String(res.status));
          const text = await res.text();
          if (!text.includes("#EXTM3U")) throw new Error("not-m3u8");
        } catch {
          onFatal();
          return;
        }
      }
      if (Hls.isSupported()) {
        attachHls(src);
        return;
      }
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.play().catch(() => {});
        video.addEventListener("error", () => onFatal(), { once: true });
        return;
      }
      onFatal();
    };

    // Kick off the rotation — the first candidate attaches immediately.
    void attach(candidates[0]);

    return () => {
      destroyed = true;
      clearPlayTimeout();
      video.removeEventListener("playing", onPlaying);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamInfo, retryNonce, forceProxyNonce, onAllFailed]);

  const setQuality = (hlsIndex: number) => {
    setCurrentLevel(hlsIndex);
    if (hlsRef.current) hlsRef.current.currentLevel = hlsIndex;
    setShowQuality(false);
  };

  const setSub = (trackId: number) => {
    setActiveSubtitle(trackId);
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = trackId;
      hlsRef.current.subtitleDisplay = trackId >= 0;
    }
    setShowSubs(false);
  };

  const setAudio = (trackId: number) => {
    setActiveAudio(trackId);
    if (hlsRef.current && trackId >= 0) hlsRef.current.audioTrack = trackId;
    setShowAudio(false);
  };

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden mb-4 group">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full"
        controls
        playsInline
        poster={poster ?? undefined}
        aria-label={title}
      />
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
        title="Close player"
      >
        <X size={14} />
      </button>
      {/* Boost toggle (quiet source amplification → boosts audio) */}
      <button
        onClick={toggleBoost}
        className={`absolute top-2 right-16 z-10 px-1.5 py-1 rounded-lg text-white hover:bg-black/80 bg-black/60 flex items-center gap-1 ${
          boostActive ? "ring-1 ring-amber-400" : ""
        }`}
        title={
          boostActive
            ? "Audio boost ON — tap to restore normal volume"
            : "Audio too quiet? Tap to boost (up to 4x)"
        }
      >
        <Settings2 size={13} />
        <span className="text-[10px] font-semibold">
          {boostActive ? "BOOST ON" : "BOOST"}
        </span>
      </button>
      {/* Server selector (manual rotation) */}
      {serverNames && serverNames.length > 1 && onRotateServer && (
        <div className="absolute top-2 right-10 z-10">
          <button
            onClick={() => setShowServers((v) => !v)}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 flex items-center gap-1 text-[10px]"
            title="Server"
          >
            <Server size={13} />
            {serverNames[activeServerIdx ?? 0] ?? "Server"}
          </button>
          {showServers && (
            <div className="absolute top-9 right-0 rounded-lg bg-black/90 border border-white/10 py-1 min-w-[110px]">
              {serverNames.map((name, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    onRotateServer(idx);
                    setShowServers(false);
                  }}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] ${idx === activeServerIdx ? "text-amber-400" : "text-white/80 hover:bg-white/10"}`}
                >
                  {name}
                  {idx === activeServerIdx && " ✓"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Quality selector */}
      {levels.length > 1 && (
        <div className="absolute top-2 left-2 z-10">
          <button
            onClick={() => setShowQuality((v) => !v)}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 flex items-center gap-1 text-[10px]"
            title="Quality"
          >
            <Settings2 size={13} />
            {currentLevel === -1
              ? "Auto"
              : `${levels.find((l) => l.hlsIndex === currentLevel)?.height ?? ""}p`}
          </button>
          {showQuality && (
            <div className="absolute top-9 left-0 rounded-lg bg-black/90 border border-white/10 py-1 min-w-[110px]">
              <button
                onClick={() => setQuality(-1)}
                className={`block w-full text-left px-3 py-1.5 text-[11px] ${currentLevel === -1 ? "text-amber-400" : "text-white/80 hover:bg-white/10"}`}
              >
                Auto
              </button>
              {levels.map((l) => (
                <button
                  key={l.hlsIndex}
                  onClick={() => setQuality(l.hlsIndex)}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] ${currentLevel === l.hlsIndex ? "text-amber-400" : "text-white/80 hover:bg-white/10"}`}
                >
                  {l.height}p
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Subtitle (CC) selector */}
      {subtitleTracks.length > 0 && (
        <div className="absolute bottom-2 left-2 z-10">
          <button
            onClick={() => setShowSubs((v) => !v)}
            className={`p-1.5 rounded-lg bg-black/60 hover:bg-black/80 flex items-center gap-1 text-[10px] ${activeSubtitle >= 0 ? "text-amber-400" : "text-white"}`}
            title="Subtitles"
          >
            <Captions size={13} />
            CC {activeSubtitle >= 0 ? "on" : "off"}
          </button>
          {showSubs && (
            <div className="absolute bottom-9 left-0 rounded-lg bg-black/90 border border-white/10 py-1 min-w-[130px]">
              <button
                onClick={() => setSub(-1)}
                className={`block w-full text-left px-3 py-1.5 text-[11px] ${activeSubtitle === -1 ? "text-amber-400" : "text-white/80 hover:bg-white/10"}`}
              >
                Off
              </button>
              {subtitleTracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSub(t.id)}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] ${activeSubtitle === t.id ? "text-amber-400" : "text-white/80 hover:bg-white/10"}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Audio-language selector */}
      {audioTracks.length > 1 && (
        <div className="absolute bottom-2 left-[86px] z-10">
          <button
            onClick={() => setShowAudio((v) => !v)}
            className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 flex items-center gap-1 text-[10px]"
            title="Audio language"
          >
            <Volume2 size={13} />
            {audioTracks.find((t) => t.id === activeAudio)?.name ??
              audioTracks[0]?.name ??
              "Audio"}
          </button>
          {showAudio && (
            <div className="absolute bottom-9 left-0 rounded-lg bg-black/90 border border-white/10 py-1 min-w-[130px]">
              {audioTracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setAudio(t.id)}
                  className={`block w-full text-left px-3 py-1.5 text-[11px] ${activeAudio === t.id ? "text-amber-400" : "text-white/80 hover:bg-white/10"}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Auto-rotation progress overlay (replaces the old premature error —
          shows the player is ACTUALLY rotating through the servers, not just
          threatening to). */}
      {rotating && !error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/45 px-4 text-center pointer-events-none">
          <Loader2 size={22} className="animate-spin text-amber-400" />
          <p className="text-[11px] font-medium text-white/90">
            {cycle === 0
              ? `Trying source ${candidateIdx + 1} of ${candidateTotal}${
                  candidateIdx < 2 ? " (direct server)" : " (secure relay)"
                }…`
              : `Still rotating — cycle ${cycle + 1} of ${MAX_CYCLES} (source ${candidateIdx + 1}/${candidateTotal})…`}
          </p>
          <p className="text-[10px] text-white/60">
            Each source gets a full 12s window — nothing playable is skipped.
          </p>
        </div>
      )}
      {/* Error overlay (only after MAX_CYCLES automatic attempts, with an
          automatic background retry so the error itself is transient). */}
      {error && (
        <AutoRetryOverlay
          error={error}
          autoRetryIn={autoRetryIn}
          setAutoRetryIn={setAutoRetryIn}
          onRetry={() => setRetryNonce((n) => n + 1)}
          onRotateServer={onRotateServer}
          serverNames={serverNames}
          activeServerIdx={activeServerIdx}
          onForceProxy={() => setForceProxyNonce((n) => n + 1)}
        />
      )}
    </div>
  );
}

/**
 * Error overlay with an automatic background retry countdown + all the
 * escape hatches (manual retry, server switch, force-proxy).
 */
function AutoRetryOverlay({
  error,
  autoRetryIn,
  setAutoRetryIn,
  onRetry,
  onRotateServer,
  serverNames,
  activeServerIdx,
  onForceProxy,
}: {
  error: string;
  autoRetryIn: number | null;
  setAutoRetryIn: (n: number | null) => void;
  onRetry: () => void;
  onRotateServer?: (idx: number) => void;
  serverNames?: string[];
  activeServerIdx?: number;
  onForceProxy: () => void;
}) {
  const AUTO_RETRY_SECONDS = 15;
  useEffect(() => {
    if (autoRetryIn === null) setAutoRetryIn(AUTO_RETRY_SECONDS);
    if (autoRetryIn === null) return;
    if (autoRetryIn <= 0) {
      onRetry();
      return;
    }
    const t = window.setTimeout(() => setAutoRetryIn(autoRetryIn - 1), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRetryIn]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 px-4 text-center">
      <p className="text-xs text-gray-300 max-w-sm">{error}</p>
      {autoRetryIn !== null && autoRetryIn > 0 && (
        <p className="text-[11px] text-amber-400 font-medium flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Auto-retrying in{" "}
          {autoRetryIn}s…
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium flex items-center gap-1.5"
        >
          <RotateCcw size={13} /> Retry now
        </button>
        {onRotateServer &&
          serverNames &&
          serverNames.length > 1 &&
          serverNames.map((name, idx) => (
            <button
              key={idx}
              onClick={() => onRotateServer(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${idx === activeServerIdx ? "bg-amber-500 text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}
            >
              {name}
            </button>
          ))}
        {/* Force-proxy escape hatch: skip the bare-URL reachability check
            and go straight to the same-origin proxy (the Cloudflare edge
            fetches playlist+segments server-side). */}
        <button
          onClick={onForceProxy}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
        >
          Try proxy
        </button>
      </div>
    </div>
  );
}

// ─── Iframe embed fallback (mirror-player providers) ───────────────────────
// When the native HLS chain is unreachable (every vixcloud server + proxy
// exhausted), we fall back to public embed-player endpoints keyed by TMDB /
// IMDb id. These render inside an iframe; any provider watermark/branding in
// the corners is hidden behind blurred overlay patches so the player chrome
// stays clean. Auto-rotates to the next provider if one fails to load.
interface EmbedCandidate {
  label: string;
  url: string;
  /**
   * True when the URL is served from OUR OWN origin via the /api/movie-embed
   * proxy. The proxied chain serves ONLY the clean final player pages (the
   * ad-laden wrapper layers are fetched server-side and never reach the
   * browser), so a fully sandboxed iframe is safe — and because the upstream
   * wrapper's sandbox-detection script is part of the ad wrapper (never
   * served), nothing can detect or refuse the sandbox. The browser then
   * natively blocks ALL popups + top-level redirects from the player.
   */
  proxied?: boolean;
}

// The ad-free proxied player chain lives at /api/movie-embed. The upstream
// session gate (vsembed.ru) is behind a Cloudflare bot challenge that blocks
// Cloudflare Workers' fetch, so on Cloudflare Pages we must call the VERCEL
// deployment (AWS network passes the gate — verified live 2026-08-30). On
// Vercel the relative same-origin path is used. This mirrors the existing
// fuelApiBase() pattern in FuelPriceLocator.tsx. The endpoint deliberately
// omits X-Frame-Options so the cross-origin iframe is allowed.
const MOVIE_EMBED_VERCEL_ORIGIN = "https://fuel-app-mobile.vercel.app";
function movieEmbedBase(): string {
  if (typeof window === "undefined") return MOVIE_EMBED_VERCEL_ORIGIN;
  if (window.location.hostname.includes("vercel.app")) return "";
  return MOVIE_EMBED_VERCEL_ORIGIN;
}

function buildEmbedCandidates(
  detail: MovieDetail,
  type: "movie" | "tv",
  seasonNum: number,
  episodeNum: number,
): EmbedCandidate[] {
  const tmdb = detail.tmdbId;
  const imdb = detail.imdbId;
  const out: EmbedCandidate[] = [];
  const isTv = type === "tv";
  const s = Math.max(1, seasonNum);
  const e = Math.max(1, episodeNum);
  const embedBase = movieEmbedBase();
  if (tmdb) {
    // Server 1 — the ad-free proxied chain (our own function, fully
    // sandboxed). Verified end-to-end 2026-08-30: gate -> landing -> player
    // -> HLS segments all proxied; actual playback confirmed (currentTime
    // advancing, readyState 4, 1080p) with ZERO popups / ZERO redirects.
    out.push({
      label: "Server 1 (Ad-Free HD)",
      url: isTv
        ? `${embedBase}/api/movie-embed?type=tv&id=${tmdb}&season=${s}&episode=${e}`
        : `${embedBase}/api/movie-embed?type=movie&id=${tmdb}`,
      proxied: true,
    });
    // Fallback mirrors (unsandboxed — they refuse sandboxed frames; the
    // ad-blocker engine + hijack watchdog protect these).
    // - vidsrc.to: ACTUAL PLAYBACK confirmed (poster, play, quality menu,
    //   subtitle menu, timeline advancing) even with 3P storage blocked.
    // - autoembed.co: inner player iframes mount (spinner-stuck headless,
    //   expected to work in real browsers).
    // - player.videasy.net + vidlink.pro: require third-party localStorage —
    //   crash/error where 3P storage is blocked; kept as fallbacks only.
    // - vidsrc.me: domain-blocks some referrers ("content is blocked").
    out.push({
      label: "Server 2",
      url: isTv
        ? `https://vidsrc.to/embed/tv/${tmdb}/${s}/${e}`
        : `https://vidsrc.to/embed/movie/${tmdb}`,
    });
    out.push({
      label: "Server 3",
      url: isTv
        ? `https://autoembed.co/tv/tmdb/${tmdb}-${s}-${e}`
        : `https://autoembed.co/movie/tmdb/${tmdb}`,
    });
    out.push({
      label: "Server 4",
      url: isTv
        ? `https://player.videasy.net/tv/${tmdb}/${s}/${e}`
        : `https://player.videasy.net/movie/${tmdb}`,
    });
    out.push({
      label: "Server 5",
      url: isTv
        ? `https://vidsrc.me/embed/tv?tmdb=${tmdb}&season=${s}&episode=${e}`
        : `https://vidsrc.me/embed/movie?tmdb=${tmdb}`,
    });
    out.push({
      label: "Server 6",
      url: isTv
        ? `https://vidlink.pro/tv/${tmdb}/${s}/${e}`
        : `https://vidlink.pro/movie/${tmdb}`,
    });
  }
  if (imdb) {
    out.push({
      label: `Server ${out.length + 1}`,
      url: isTv
        ? `https://www.2embed.cc/embedtv/${imdb}&s=${s}&e=${e}`
        : `https://www.2embed.cc/embed/${imdb}`,
    });
  }
  return out;
}

/**
 * EmbedFallbackPlayer — iframe player for the mirror embed providers.
 * Provider watermarks (typically top-left / top-right / bottom corners) are
 * hidden behind blurred overlay patches so no other site's branding shows.
 *
 * Smart loading behavior (per user spec):
 *  - If the inner player shows a DURATION (e.g. 0:00/1:10) the video HAS
 *    loaded — we then WAIT for it to fully buffer and auto-play, rather
 *    than rotating away.
 *  - A truly dead provider (iframe never fires onLoad) rotates to the next
 *    ranked server quickly.
 *  - If a loaded server has not started playing within SLOW_LOAD_MS we
 *    surface a "Switch server?" prompt so the user can decide, instead of
 *    silently hanging.
 */
const DEAD_PROVIDER_MS = 9000; // rotate if iframe never loads
const SLOW_LOAD_MS = 60000; // 1 min — prompt to switch server

function EmbedFallbackPlayer({
  candidates,
  title,
  poster,
  onClose,
  onAllFailed,
  onPrevEpisode,
  onNextEpisode,
  autoNext,
  onToggleAutoNext,
}: {
  candidates: EmbedCandidate[];
  title: string;
  poster?: string | null;
  onClose: () => void;
  onAllFailed?: () => void;
  onPrevEpisode?: () => void;
  onNextEpisode?: () => void;
  autoNext?: boolean;
  onToggleAutoNext?: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slowPrompt, setSlowPrompt] = useState(false);
  // The iframe is lazy-loaded ONLY after the user clicks play — before that
  // we show the movie poster (like streamingunity/soap2day do) so the user
  // sees familiar artwork + a big play button instead of a slow-loading
  // black box. This also means the dead-provider rotation only runs once the
  // user has actually asked to play.
  const [started, setStarted] = useState(false);
  const deadTimerRef = useRef<number | null>(null);
  const slowTimerRef = useRef<number | null>(null);
  // Iframe hijack watchdog: the embed iframe may only load (a) within 8s of us
  // setting its src (the provider's own redirect chain), or (b) within 1.5s of
  // a user click (a legit in-player navigation). Any other load = the provider
  // navigated itself to an ad page — reset the iframe back to the real embed.
  const [iframeEpoch, setIframeEpoch] = useState(0);
  const srcSetAtRef = useRef(0);

  // Popup Blocker Pro lifecycle: engage the strict popup shield the moment
  // the player mounts (BEFORE the user clicks play — the first click is the
  // classic popup-ad trigger), release when the player closes/unmounts.
  usePopupShield("movies", true);

  const current = candidates[idx];

  const goNext = (toFailure = false) => {
    setSlowPrompt(false);
    setIdx((prev) => {
      if (prev < candidates.length - 1) return prev + 1;
      if (toFailure) {
        setFailed(true);
        if (onAllFailed) onAllFailed();
      }
      return prev;
    });
  };

  // Dead-provider rotation: only rotates if the iframe NEVER fires onLoad,
  // and only once the user clicked play (`started`). Once a server LOADS,
  // it's the working server — rotation STOPS (the user asked for
  // "stop auto-rotating once a working server is found"). Cross-origin
  // iframes can't be inspected for inner-player health, so we rely on
  // onLoad + a slow-load prompt.
  useEffect(() => {
    if (!started) return;
    setLoaded(false);
    setSlowPrompt(false);
    srcSetAtRef.current = Date.now();
    if (deadTimerRef.current !== null)
      window.clearTimeout(deadTimerRef.current);
    if (slowTimerRef.current !== null)
      window.clearTimeout(slowTimerRef.current);
    deadTimerRef.current = window.setTimeout(() => {
      goNext(true);
    }, DEAD_PROVIDER_MS);
    return () => {
      if (deadTimerRef.current !== null)
        window.clearTimeout(deadTimerRef.current);
      if (slowTimerRef.current !== null)
        window.clearTimeout(slowTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, candidates.length, started]);

  const handleLoaded = () => {
    setLoaded(true);
    // A server loaded — stop auto-rotating. This is the user-requested
    // "stop auto-rotating once a working server is found" behavior.
    if (deadTimerRef.current !== null) {
      window.clearTimeout(deadTimerRef.current);
      deadTimerRef.current = null;
    }
    // Loaded — but if the inner player hasn't started playing within
    // SLOW_LOAD_MS, offer to switch server (user decides; we don't
    // auto-abandon a potentially-good-but-slow source).
    if (slowTimerRef.current !== null)
      window.clearTimeout(slowTimerRef.current);
    slowTimerRef.current = window.setTimeout(() => {
      setSlowPrompt(true);
    }, SLOW_LOAD_MS);
  };

  const handleIframeLoad = () => {
    const now = Date.now();
    const legitInitial = now - srcSetAtRef.current < 8000;
    const userDriven = now - getLastGestureTime() < 1500;
    if (!legitInitial && !userDriven) {
      // The provider iframe navigated itself with no user gesture — an ad
      // redirect / hijack. Snap it back to the real embed URL.
      noteBlockedEvent("iframe-hijack", current?.url ?? "");
      srcSetAtRef.current = now;
      setIframeEpoch((e) => e + 1);
      return;
    }
    armNavGuard(3000);
    handleLoaded();
  };

  if (failed) return null; // parent shows the trailer / error path

  if (!current) return null;

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden mb-4">
      {!started ? (
        /* Poster + big play button — like streamingunity/soap2day show the
           artwork first. No iframe = no black box, no slow auto-loading.
           Flat structure (no nested buttons) so the play target is always
           clickable — desktop, mobile, and assistive tech. */
        <div
          className="absolute inset-0 group cursor-pointer"
          onClick={() => setStarted(true)}
        >
          {poster ? (
            <img
              src={poster}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-900 to-black" />
          )}
          <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors" />
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-black/80 to-transparent" />
          <div className="pointer-events-none absolute top-2 left-3 text-[11px] font-semibold text-white/90 drop-shadow">
            {title}
          </div>
          {/* Single, dedicated play button — the only interactive element in
              the center, so clicks/taps always start playback. */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={() => setStarted(true)}
              className="flex items-center justify-center w-20 h-20 rounded-full bg-amber-500 shadow-2xl shadow-amber-500/40 hover:scale-110 transition-transform"
              title={`Play — ${current.label}`}
              aria-label={`Play ${title}`}
            >
              <Play size={36} className="text-black fill-black ml-1.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setStarted(true)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-white/80 bg-black/60 hover:bg-black/80 rounded-full px-3 py-1"
          >
            Click to play
          </button>
          {/* Shield badge is visible BEFORE the play click — the shield
              engages the moment the player opens, so popup ads fired by the
              first click are already blocked. */}
          <div
            className="absolute top-2 left-2 z-30"
            onClick={(e) => e.stopPropagation()}
          >
            <PopupShieldBadge />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="absolute top-2 right-2 z-30 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
            title="Close player"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          <iframe
            key={`${current.url}:${iframeEpoch}`}
            src={current.url}
            className="absolute inset-0 w-full h-full"
            allowFullScreen
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            referrerPolicy="no-referrer"
            title={title}
            onLoad={handleIframeLoad}
            // Sandbox policy:
            // - PROXIED candidates (our own origin via /api/movie-embed): fully
            //   sandboxed — no popups, no top-navigation, browser-enforced.
            //   The upstream sandbox-detection script lives in the ad wrapper
            //   layers which this chain never serves, so nothing can detect or
            //   refuse the sandbox.
            // - Direct mirror providers (vidsrc.to etc.): NO sandbox — they
            //   explicitly detect sandboxed frames and refuse to play
            //   (verified: vidsrc.to renders "This content can't be embedded
            //   in a sandboxed frame"). Those are instead guarded by the
            //   ad-blocker engine (window.open override, network filtering,
            //   cosmetic removal, beforeunload top-redirect trap) + the iframe
            //   hijack watchdog above + the PopupShield engaged here.
            {...(current.proxied
              ? {
                  sandbox:
                    "allow-scripts allow-same-origin allow-forms allow-presentation allow-modals allow-pointer-lock",
                }
              : {})}
          />
          {/* Branding-hiding overlays — blurred patches over the typical
              watermark corners + a clean top gradient with OUR title. */}
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-black/90 via-black/50 to-transparent z-10" />
          <div className="pointer-events-none absolute top-2 left-3 z-20 text-[11px] font-semibold text-white/90 drop-shadow max-w-[60%] truncate">
            {title}
          </div>
          <div className="pointer-events-none absolute top-1.5 right-2 z-20 w-24 h-8 rounded-lg bg-black/40 backdrop-blur-md" />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-black/80 to-transparent z-10" />
          <div className="pointer-events-none absolute bottom-1.5 right-2 z-20 w-24 h-7 rounded-lg bg-black/40 backdrop-blur-md" />
          <div className="pointer-events-none absolute bottom-1.5 left-2 z-20 w-20 h-7 rounded-lg bg-black/30 backdrop-blur-md" />
          {/* Controls: shield badge / close / prev / AUTO NEXT / next */}
          <div className="absolute top-2 right-28 z-30 flex items-center gap-1.5">
            <PopupShieldBadge />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80"
              title="Close player"
            >
              <X size={14} />
            </button>
          </div>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5">
            {!loaded && (
              <span className="flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-[10px] text-white/90">
                <Loader2 size={11} className="animate-spin" /> Loading{" "}
                {current.label}…
              </span>
            )}
            {onPrevEpisode && (
              <button
                onClick={onPrevEpisode}
                className="rounded-full bg-black/70 hover:bg-black/90 px-2.5 py-1 text-[10px] text-white/90"
                title="Previous episode"
              >
                ← Prev
              </button>
            )}
            {onToggleAutoNext && (
              <button
                onClick={onToggleAutoNext}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${autoNext ? "bg-amber-500 text-black" : "bg-black/70 hover:bg-black/90 text-white/90"}`}
                title="Toggle auto-next episode"
              >
                AUTO {autoNext ? "ON" : "OFF"}
              </button>
            )}
            {onNextEpisode && (
              <button
                onClick={onNextEpisode}
                className="rounded-full bg-black/70 hover:bg-black/90 px-2.5 py-1 text-[10px] text-white/90"
                title="Next episode"
              >
                Next →
              </button>
            )}
            {candidates.length > 1 && (
              <button
                onClick={() => goNext(true)}
                className="rounded-full bg-black/70 hover:bg-black/90 px-3 py-1 text-[10px] text-white/90"
              >
                {idx < candidates.length - 1 ? "Next server" : "Last server"}
              </button>
            )}
          </div>
          {/* Slow-load prompt — shown after SLOW_LOAD_MS on a loaded server. */}
          {slowPrompt && loaded && (
            <div className="absolute inset-x-0 bottom-12 z-30 flex justify-center">
              <div className="flex items-center gap-2 rounded-xl bg-black/85 border border-white/10 px-4 py-2.5 backdrop-blur-md">
                <span className="text-[11px] text-white/90">
                  Taking long to load on {current.label}. Switch server?
                </span>
                <button
                  onClick={() => goNext(true)}
                  className="rounded-lg bg-amber-500 hover:bg-amber-600 px-3 py-1 text-[11px] font-semibold text-black"
                >
                  Switch
                </button>
                <button
                  onClick={() => setSlowPrompt(false)}
                  className="rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1 text-[11px] text-white/90"
                >
                  Keep waiting
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MoviesEmbed({
  accent = "amber",
  searchSeed,
  searchSeedKey,
}: Props) {
  const { user } = useAuth();

  // ── UI state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<ViewMode>("catalog");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogSliders, setCatalogSliders] = useState<
    { name: string; label: string; titles: MovieItem[] }[]
  >([]);
  const [genres, setGenres] = useState<MovieGenre[]>([]);
  const [activeGenre, setActiveGenre] = useState<number | null>(null);
  const [browseSlider, setBrowseSlider] = useState("trending");
  const [browseTitles, setBrowseTitles] = useState<MovieItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // External search seed (QuickSearch/AIChatbot deep links) — runs the
  // catalog search on each new seed.
  useEffect(() => {
    const q = (searchSeed || "").trim();
    if (!q || !searchSeedKey) return;
    setSearchQuery(q);
    runSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchSeedKey]);

  const [searchResults, setSearchResults] = useState<MovieItem[]>([]);

  // ── Detail + player ───────────────────────────────────────────────────────
  const [selected, setSelected] = useState<MovieItem | null>(null);
  const [detail, setDetail] = useState<MovieDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [streamInfo, setStreamInfo] = useState<MovieStreamInfo | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [activeServerIdx, setActiveServerIdx] = useState(0);

  // ── Season selector (series / TV shows / limited series) ─────────────────
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);

  // ── AUTO NEXT episode (persisted in cloud) ────────────────────────────────
  const [autoNext, setAutoNext] = useState(true);
  // Current playing episode NUMBER (for prev/next + AUTO NEXT logic).
  const [curEpNum, setCurEpNum] = useState(1);

  // ── Embed fallback (mirror providers, after native chain exhausts) ──────
  const [useEmbedFallback, setUseEmbedFallback] = useState(false);

  // Always-current ref for the loaded detail. `play()` + `handleNativeExhausted`
  // read this instead of the `detail` state so the embed fallback keys by the
  // CORRECT tmdbId/imdbId for the title actually being played (not a stale
  // closure from a previously-viewed title — which would point the mirrors at
  // the WRONG movie/series and produce a dead player).
  const detailRef = useRef<MovieDetail | null>(null);

  // ── Trailer (in-app YouTube preview modal) ────────────────────────────────
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [activeTrailer, setActiveTrailer] = useState(0);

  // ── Cloud-synced favorites / watchlist / history ──────────────────────────
  const [favorites, setFavorites] = useState<MovieItem[]>([]);
  const [watchlist, setWatchlist] = useState<MovieItem[]>([]);
  const [history, setHistory] = useState<MovieItem[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  // ── Classics (public-domain, always playable) ────────────────────────────
  const [classics, setClassics] = useState<ClassicMovieItem[]>([]);
  const [classicsLoading, setClassicsLoading] = useState(false);
  const [selectedClassic, setSelectedClassic] =
    useState<ClassicMovieItem | null>(null);
  const [classicDetail, setClassicDetail] = useState<ClassicMovieItem | null>(
    null,
  );
  const [classicDetailLoading, setClassicDetailLoading] = useState(false);

  // 3-ref guard (anti flash-then-blank cloud-sync bug)
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);

  // ── Load catalog on mount ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const cat = await fetchMovieCatalog();
        if (cancelled) return;
        setCatalogSliders(cat.sliders);
        setGenres(cat.genres);
        if (cat.sliders.length === 0) setError("Could not load the catalog.");
      } catch {
        if (!cancelled) setError("Could not load the catalog.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load classics on mount (guaranteed-playable public-domain catalog) ────
  useEffect(() => {
    let cancelled = false;
    setClassicsLoading(true);
    void fetchClassicMovies().then((items) => {
      if (!cancelled) {
        setClassics(items);
        setClassicsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Open a classic film's detail (fetches the playable mp4 lazily) ────────
  const openClassic = (item: ClassicMovieItem) => {
    setSelectedClassic(item);
    setClassicDetail(null);
    setClassicDetailLoading(true);
    void fetchClassicDetail(item.identifier).then((d) => {
      setClassicDetail(d);
      setClassicDetailLoading(false);
    });
  };

  // ── Cloud load: favorites + watchlist + history ───────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      try {
        const [fav, wl, hist, autoNextVal] = await Promise.all([
          cloudStorageService.get<MovieItem[]>(FAVORITES_KEY),
          cloudStorageService.get<MovieItem[]>(WATCHLIST_KEY),
          cloudStorageService.get<MovieItem[]>(HISTORY_KEY),
          cloudStorageService.get<boolean>(AUTO_NEXT_KEY),
        ]);
        if (cancelled) return;
        if (Array.isArray(fav)) setFavorites(fav);
        if (Array.isArray(wl)) setWatchlist(wl);
        if (Array.isArray(hist)) setHistory(hist);
        if (typeof autoNextVal === "boolean") setAutoNext(autoNextVal);
      } catch {
        // ignore
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // ── Persist helpers (local-only modifications) ───────────────────────────
  const persist = useCallback(
    (key: string, value: MovieItem[]) => {
      if (!cloudLoadCompleteRef.current || !user?.id) return;
      localModifiedRef.current = true;
      cloudStorageService.set(key, value).catch(() => {});
    },
    [user?.id],
  );

  // ── Fetch a slider / genre browse ─────────────────────────────────────────
  const loadBrowse = useCallback(
    async (slider: string, genre?: number | null) => {
      setLoading(true);
      const data = await fetchMovieBrowse(slider, genre ?? undefined);
      setBrowseTitles(data.titles);
      setBrowseSlider(slider);
      setLoading(false);
    },
    [],
  );

  const handleGenre = (genreId: number | null) => {
    setActiveGenre(genreId);
    setView("genre");
    void loadBrowse(browseSlider, genreId);
  };

  const handleSliderBrowse = (slider: string) => {
    setActiveGenre(null);
    setView("catalog");
    void loadBrowse(slider, null);
  };

  // ── Search ────────────────────────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setView("catalog");
      setSearchResults([]);
      return;
    }
    setView("search");
    const results = await searchMovies(q);
    setSearchResults(results);
  }, []);

  // In classics view, filter the already-loaded classics list client-side.
  const filteredClassics =
    view === "classics" && searchQuery.trim()
      ? classics.filter((c) =>
          c.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
        )
      : classics;

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInput = (v: string) => {
    setSearchQuery(v);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => void runSearch(v), 450);
  };

  // ── Surprise me ───────────────────────────────────────────────────────────
  const surprise = () => {
    if (view === "classics" && classics.length > 0) {
      openClassic(classics[Math.floor(Math.random() * classics.length)]);
      return;
    }
    const pool =
      view === "search"
        ? searchResults
        : view === "genre" || browseTitles.length
          ? browseTitles
          : catalogSliders.flatMap((s) => s.titles);
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    openDetail(pick);
  };

  // ── Open detail modal ─────────────────────────────────────────────────────
  const openDetail = (item: MovieItem) => {
    setSelected(item);
    setDetail(null);
    detailRef.current = null;
    setStreamInfo(null);
    setSelectedEpisode(null);
    setTrailerOpen(false);
    setActiveTrailer(0);
    setSelectedSeason(null);
    setSeasonLoading(false);
    setStreamError(null);
    setUseEmbedFallback(false);
    setDetailLoading(true);
    void fetchMovieDetail(item.id, item.slug).then((d) => {
      setSelectedSeason(d?.loadedSeason?.number ?? null);
      // track in continue-watching history
      if (cloudLoadCompleteRef.current && user?.id) {
        setHistory((prev) => {
          const next = [item, ...prev.filter((h) => h.id !== item.id)].slice(
            0,
            HISTORY_MAX,
          );
          persist(HISTORY_KEY, next);
          return next;
        });
      }
      setDetail(d);
      detailRef.current = d;
      setDetailLoading(false);
    });
  };

  // ── Season switch — fetch that season's episodes (series/TV/limited) ─────
  const changeSeason = (seasonNum: number) => {
    if (!selected || seasonNum === selectedSeason) return;
    setSelectedSeason(seasonNum);
    setSelectedEpisode(null);
    setStreamInfo(null);
    setStreamError(null);
    setSeasonLoading(true);
    void fetchMovieDetail(selected.id, selected.slug, seasonNum).then((d) => {
      if (d) {
        setDetail(d);
        detailRef.current = d;
      }
      setSeasonLoading(false);
    });
  };

  // ── Player ────────────────────────────────────────────────────────────────
  // Go DIRECTLY to the reliable embed providers (videasy -> vidsrc.me ->
  // autoembed -> 2embed). The native vixcloud HLS path is unreliable (cycles
  // for up to 72s before falling back) and is skipped. If NO embed provider
  // resolves, fall back to the native hls.js path as a last resort.
  const play = (episodeId?: number) => {
    if (!selected) return;
    setPlayerLoading(true);
    setStreamInfo(null);
    setStreamError(null);
    setUseEmbedFallback(false);
    setActiveServerIdx(0); // Reset to first server on new play

    // Resolve the detail so the embed candidates use the correct tmdb/imdb
    // IDs. Use detailRef (always the CURRENT title), and wait if the detail
    // fetch is still in flight (user clicked Watch Now very fast).
    let d = detailRef.current;
    const resolveAndEmbed = async (): Promise<void> => {
      if (!d && selected) {
        d = await fetchMovieDetail(selected.id, selected.slug).catch(
          () => null,
        );
        if (d) {
          setDetail(d);
          detailRef.current = d;
          setSelectedSeason(d.loadedSeason?.number ?? null);
        }
      }
      if (d && (d.tmdbId || d.imdbId)) {
        setUseEmbedFallback(true);
        setPlayerLoading(false);
        return;
      }
      // No embed provider possible (no tmdb/imdb id) — try the native HLS
      // path as a last resort.
      const info = await fetchMovieStreams(selected.id, episodeId).catch(
        () => null,
      );
      if (info?.playlistUrl) {
        setStreamInfo(info);
        setPlayerLoading(false);
        return;
      }
      setStreamError(
        "This title's stream is temporarily unreachable right now. " +
          "Retry — it usually recovers quickly.",
      );
      setPlayerLoading(false);
    };
    void resolveAndEmbed();
  };

  const toggleAutoNext = () => {
    setAutoNext((prev) => {
      const next = !prev;
      if (cloudLoadCompleteRef.current && user?.id) {
        localModifiedRef.current = true;
        cloudStorageService.set<boolean>(AUTO_NEXT_KEY, next).catch(() => {});
      }
      return next;
    });
  };

  // Play an episode by its NUMBER. Returns true when a matching episode
  // exists in the loaded season.
  const playEpisodeByNumber = (epNum: number): boolean => {
    if (!selected || !detail?.loadedSeason) return false;
    const ep = (detail.loadedSeason.episodes ?? []).find(
      (e) => e.number === epNum,
    );
    if (!ep) return false;
    setSelectedEpisode(ep.id);
    setCurEpNum(ep.number);
    play(ep.id);
    return true;
  };

  // Hierarchy of episodes: go to the NEXT episode (in current season, else
  // first episode of the next season). Called by the Next button.
  const goToNextEpisode = (): boolean => {
    if (!detail) return false;
    const season = detail.loadedSeason;
    if (!season || season.episodes.length === 0) return false;
    const maxNum = season.episodes[season.episodes.length - 1]?.number ?? 0;
    if (curEpNum < maxNum) {
      return playEpisodeByNumber(curEpNum + 1);
    }
    // End of season — find the season AFTER the loaded one and play its
    // first episode.
    const seasons = detail.seasons ?? [];
    const nextSeason = seasons
      .map((s) => s.number)
      .filter((n) => n > (season.number ?? 0))
      .sort((a, b) => a - b)[0];
    if (!nextSeason) return false;
    changeSeason(nextSeason);
    return true;
  };

  // Go to the PREVIOUS episode (in current season, else last episode of the
  // previous season).
  const goToPrevEpisode = (): boolean => {
    if (!detail) return false;
    const season = detail.loadedSeason;
    if (!season || season.episodes.length === 0) return false;
    const minNum = season.episodes[0]?.number ?? 1;
    if (curEpNum > minNum) {
      return playEpisodeByNumber(curEpNum - 1);
    }
    // At the first episode of a season — go to the LAST episode of the
    // previous season.
    const seasons = detail.seasons ?? [];
    const prevSeason = seasons
      .map((s) => s.number)
      .filter((n) => n < (season.number ?? 0))
      .sort((a, b) => b - a)[0];
    if (!prevSeason) return false;
    changeSeason(prevSeason);
    return true;
  };

  /** Guaranteed-video chain when the native HLS path is exhausted. */
  const handleNativeExhausted = () => {
    const d = detailRef.current;
    if (d && (d.tmdbId || d.imdbId)) {
      setUseEmbedFallback(true);
      setStreamInfo(null);
    } else if (d && d.trailers.length > 0) {
      setActiveTrailer(0);
      setTrailerOpen(true);
    }
  };

  // Manual server rotation — MoviePlayer's internal rotation handles this
  // (its candidates already cover all bare server URLs + proxy fallbacks),
  // so we just track the active index for the UI.
  const rotateServer = (idx: number) => {
    setActiveServerIdx(idx);
  };

  // ── Favorites / watchlist toggles ─────────────────────────────────────────
  const isFavorited = (item: MovieItem) =>
    favorites.some((f) => f.id === item.id);
  const isWatchlisted = (item: MovieItem) =>
    watchlist.some((w) => w.id === item.id);

  const toggleFavorite = (item: MovieItem) => {
    if (!user?.id) return;
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === item.id);
      const next = exists
        ? prev.filter((f) => f.id !== item.id)
        : [item, ...prev].slice(0, FAVORITES_MAX);
      persist(FAVORITES_KEY, next);
      return next;
    });
  };

  const toggleWatchlist = (item: MovieItem) => {
    if (!user?.id) return;
    setWatchlist((prev) => {
      const exists = prev.some((w) => w.id === item.id);
      const next = exists
        ? prev.filter((w) => w.id !== item.id)
        : [item, ...prev].slice(0, FAVORITES_MAX);
      persist(WATCHLIST_KEY, next);
      return next;
    });
  };

  const removeHistoryItem = (item: MovieItem) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h.id !== item.id);
      persist(HISTORY_KEY, next);
      return next;
    });
  };

  // ── Current movie list to render (movies + series, type-filtered) ─────────
  const unfilteredList: MovieItem[] =
    view === "search"
      ? searchResults
      : view === "genre" || browseTitles.length
        ? browseTitles
        : catalogSliders.flatMap((s) => s.titles);
  const listToRender: MovieItem[] =
    view === "classics"
      ? [] // classics render from the `classics` array directly
      : typeFilter === "all"
        ? unfilteredList
        : unfilteredList.filter((t) => t.type === typeFilter);

  const accentBorder =
    accent === "amber"
      ? "border-amber-400/40"
      : accent === "purple"
        ? "border-purple-400/40"
        : "border-blue-400/40";

  return (
    <div className="space-y-4">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search movies & series..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-800 dark:text-gray-200 placeholder-gray-400"
          />
        </div>
        {/* Type filter: All / Movies / TV Series (series, TV shows, limited series) */}
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          {(
            [
              { id: "all", label: "All", icon: Clapperboard },
              { id: "movie", label: "Movies", icon: Film },
              { id: "tv", label: "TV Series", icon: Tv },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTypeFilter(t.id)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors ${
                typeFilter === t.id
                  ? "bg-amber-500 text-white"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={surprise}
          title="Surprise me"
          className="px-3 py-2 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30 text-xs font-medium flex items-center gap-1.5"
        >
          <Shuffle size={14} /> Surprise
        </button>
        <button
          onClick={() => setShowLibrary((v) => !v)}
          title="My library"
          className="px-3 py-2 rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-500/30 text-xs font-medium flex items-center gap-1.5"
        >
          <ListVideo size={14} /> Library ({favorites.length + watchlist.length}
          )
        </button>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {cloudLoadCompleteRef.current ? "Live sync ✓" : "Live sync…"}
        </span>
      </div>

      {/* Genre pills + slider browse */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <button
          onClick={() => handleGenre(null)}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${activeGenre === null && view === "catalog" ? "bg-amber-500 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
        >
          All
        </button>
        {genres.slice(0, 12).map((g) => (
          <button
            key={g.id}
            onClick={() => handleGenre(g.id)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${activeGenre === g.id ? "bg-amber-500 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
          >
            {g.name}
          </button>
        ))}
        <span className="mx-1 w-px h-4 bg-gray-300 dark:bg-gray-600" />
        {/* Classics pill — guaranteed-playable public-domain catalog */}
        <button
          onClick={() => {
            setView("classics");
            setActiveGenre(null);
          }}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${view === "classics" ? "bg-emerald-500 text-white" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"}`}
        >
          Classics
        </button>
        {["trending", "latest", "top10"].map((s) => (
          <button
            key={s}
            onClick={() => handleSliderBrowse(s)}
            className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 hover:bg-blue-500/25"
          >
            {s === "trending"
              ? "Trending"
              : s === "latest"
                ? "Latest"
                : "Top 10"}
          </button>
        ))}
      </div>

      {/* Library panel (favorites / watchlist / continue-watching) */}
      {showLibrary && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4">
          {/* Favorites */}
          <LibrarySection
            title="Favorites"
            icon={<Heart size={14} className="text-rose-500" />}
            items={favorites}
            onOpen={openDetail}
            onRemove={(it) => toggleFavorite(it)}
            empty="No favorites yet — tap the ♥ on a movie."
          />
          {/* Watchlist */}
          <LibrarySection
            title="Watchlist"
            icon={<Bookmark size={14} className="text-blue-500" />}
            items={watchlist}
            onOpen={openDetail}
            onRemove={(it) => toggleWatchlist(it)}
            empty="No watchlist items — tap the bookmark on a movie."
          />
          {/* Continue watching */}
          <LibrarySection
            title="Continue Watching"
            icon={<History size={14} className="text-emerald-500" />}
            items={history}
            onOpen={openDetail}
            onRemove={removeHistoryItem}
            empty="Movies you open appear here."
          />
        </div>
      )}

      {/* Movie grid */}
      {view === "classics" ? (
        classicsLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 size={24} className="animate-spin" />
            <span className="ml-2 text-sm">Loading classics…</span>
          </div>
        ) : filteredClassics.length === 0 ? (
          <div className="text-center py-12">
            <Film
              size={40}
              className="mx-auto text-gray-300 dark:text-gray-600 mb-3"
            />
            <p className="text-gray-500 text-sm">
              {searchQuery.trim()
                ? `No classics matching "${searchQuery}"`
                : "No classics found"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {filteredClassics.map((c) => (
              <ClassicCard
                key={c.id}
                movie={c}
                onOpen={() => openClassic(c)}
                accent={accentBorder}
              />
            ))}
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 size={24} className="animate-spin" />
          <span className="ml-2 text-sm">Loading movies…</span>
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <Film
            size={40}
            className="mx-auto text-gray-300 dark:text-gray-600 mb-3"
          />
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      ) : listToRender.length === 0 ? (
        <div className="text-center py-12">
          <Film
            size={40}
            className="mx-auto text-gray-300 dark:text-gray-600 mb-3"
          />
          <p className="text-gray-500 text-sm">
            {view === "search"
              ? `No movies matching "${searchQuery}"`
              : "No movies found"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
          {listToRender.map((m) => (
            <MovieCard
              key={m.id}
              movie={m}
              onOpen={() => openDetail(m)}
              onFavorite={() => toggleFavorite(m)}
              onWatchlist={() => toggleWatchlist(m)}
              favorited={isFavorited(m)}
              watchlisted={isWatchlisted(m)}
              accent={accentBorder}
            />
          ))}
        </div>
      )}

      {/* ─────────────── CLASSIC DETAIL MODAL ─────────────── */}
      {selectedClassic && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3 sm:p-6"
          onClick={() => setSelectedClassic(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto border border-gray-200 dark:border-gray-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    {selectedClassic.name}
                    {selectedClassic.year && (
                      <span className="text-xs font-normal text-gray-500">
                        ({selectedClassic.year})
                      </span>
                    )}
                  </h3>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 uppercase flex items-center gap-1 w-fit mt-1">
                    <Clapperboard size={10} /> Classic
                  </span>
                </div>
                <button
                  onClick={() => setSelectedClassic(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                >
                  <X size={18} />
                </button>
              </div>
              {classicDetailLoading ? (
                <div className="flex items-center justify-center py-10 text-gray-500">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : classicDetail?.videoUrl ? (
                <video
                  src={classicDetail.videoUrl}
                  poster={selectedClassic.poster}
                  controls
                  autoPlay
                  className="w-full rounded-xl bg-black aspect-video"
                  aria-label={selectedClassic.name}
                />
              ) : (
                <p className="text-sm text-gray-500 py-6 text-center">
                  {classicDetail ? "No playable video found." : "Loading…"}
                </p>
              )}
              {classicDetail?.plot && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 line-clamp-5">
                  {classicDetail.plot}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─────────────── DETAIL MODAL ─────────────── */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3 sm:p-6"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-auto border border-gray-200 dark:border-gray-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Backdrop */}
            {(detail?.background || selected.background || selected.cover) && (
              <div className="relative h-36 sm:h-48 w-full overflow-hidden rounded-t-2xl">
                <img
                  src={
                    detail?.background ||
                    selected.background ||
                    selected.cover ||
                    ""
                  }
                  alt={selected.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 to-transparent" />
              </div>
            )}
            <div className="p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    {selected.name}
                    {selected.year && (
                      <span className="text-xs font-normal text-gray-500">
                        ({selected.year})
                      </span>
                    )}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {selected.score && (
                      <span className="flex items-center gap-1 text-xs text-amber-500 font-medium">
                        <Star size={12} className="fill-amber-500" />
                        {selected.score}
                      </span>
                    )}
                    {detail?.quality && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium">
                        {detail.quality}
                      </span>
                    )}
                    {detail?.runtime != null && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock size={11} /> {detail.runtime} min
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 uppercase flex items-center gap-1">
                      {selected.type === "tv" ? (
                        <>
                          <Tv size={10} /> Series
                        </>
                      ) : (
                        <>
                          <Film size={10} /> Movie
                        </>
                      )}
                    </span>
                    {selected.type === "tv" && selected.seasonsCount > 0 && (
                      <span className="text-xs text-gray-500">
                        {selected.seasonsCount}{" "}
                        {selected.seasonsCount === 1 ? "season" : "seasons"}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Genres */}
              {detail && detail.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {detail.genres.map((g) => (
                    <span
                      key={g.id}
                      className="px-2 py-0.5 rounded-md text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    >
                      {g.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Plot */}
              {(detail?.plot || detailLoading) && (
                <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                  {detailLoading ? "Loading…" : detail?.plot}
                </p>
              )}

              {/* Cast / Directors */}
              {detail && (
                <div className="space-y-1 mb-4 text-xs text-gray-500 dark:text-gray-400">
                  {detail.directors.length > 0 && (
                    <p>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        Director:
                      </span>{" "}
                      {detail.directors.join(", ")}
                    </p>
                  )}
                  {detail.actors.length > 0 && (
                    <p>
                      <span className="font-semibold text-gray-700 dark:text-gray-300">
                        Cast:
                      </span>{" "}
                      {detail.actors.slice(0, 6).join(", ")}
                    </p>
                  )}
                </div>
              )}

              {/* PLAYER — native hls.js only (the vixcloud iframe is
                  frame-ancestors-locked to vixcloud.co, so it can never be
                  embedded here). */}
              {useEmbedFallback && detail ? (
                <EmbedFallbackPlayer
                  candidates={buildEmbedCandidates(
                    detail,
                    selected.type,
                    detail.loadedSeason?.number ?? selectedSeason ?? 1,
                    detail.loadedSeason?.episodes?.find(
                      (ep) => ep.id === selectedEpisode,
                    )?.number ?? 1,
                  )}
                  title={selected.name}
                  poster={selected.cover ?? selected.poster}
                  onClose={() => setUseEmbedFallback(false)}
                  onAllFailed={() => {
                    // Final guaranteed fallback: open the trailer so the
                    // user ALWAYS sees moving video, never a dead error.
                    if (detail.trailers.length > 0) {
                      setActiveTrailer(0);
                      setTrailerOpen(true);
                    } else {
                      // No trailer either — restore the Watch Now button so
                      // the user can retry the whole chain.
                      setUseEmbedFallback(false);
                      setStreamError(
                        "This title's stream is temporarily unreachable " +
                          "right now. Retry — it usually recovers quickly.",
                      );
                    }
                  }}
                  onPrevEpisode={
                    selected.type === "tv" && detail
                      ? () => {
                          goToPrevEpisode();
                        }
                      : undefined
                  }
                  onNextEpisode={
                    selected.type === "tv" && detail
                      ? () => {
                          goToNextEpisode();
                        }
                      : undefined
                  }
                  autoNext={autoNext}
                  onToggleAutoNext={
                    selected.type === "tv" && detail
                      ? toggleAutoNext
                      : undefined
                  }
                />
              ) : streamInfo ? (
                <MoviePlayer
                  streamInfo={streamInfo}
                  title={selected.name}
                  poster={selected.cover ?? selected.poster}
                  onClose={() => setStreamInfo(null)}
                  onRotateServer={rotateServer}
                  activeServerIdx={activeServerIdx}
                  serverNames={streamInfo.servers?.map((s) => s.name) ?? []}
                  onAllFailed={handleNativeExhausted}
                />
              ) : (
                <>
                  {streamError && (
                    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
                      {streamError}
                    </div>
                  )}
                  <button
                    onClick={() =>
                      play(
                        selectedEpisode ??
                          // TV series need an episode for the stream lookup —
                          // default to the first episode of the loaded season.
                          detail?.loadedSeason?.episodes?.[0]?.id ??
                          undefined,
                      )
                    }
                    disabled={playerLoading}
                    className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm flex items-center justify-center gap-2 mb-4 transition-colors"
                  >
                    {playerLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Play size={16} className="fill-white" />
                    )}
                    {playerLoading
                      ? "Loading player…"
                      : streamError
                        ? "Retry"
                        : "Watch Now"}
                  </button>
                </>
              )}

              {/* TV: season selector (all seasons, incl. latest) + episodes */}
              {selected.type === "tv" &&
                detail &&
                detail.seasons.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <label
                        htmlFor="fp-season-select"
                        className="text-xs font-semibold text-gray-700 dark:text-gray-300"
                      >
                        Season
                      </label>
                      <select
                        id="fp-season-select"
                        value={detail.loadedSeason?.number ?? ""}
                        onChange={(e) => changeSeason(Number(e.target.value))}
                        disabled={seasonLoading}
                        className="flex-1 min-w-0 text-xs rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1.5 disabled:opacity-60"
                      >
                        {detail.seasons.map((s) => (
                          <option key={s.id} value={s.number}>
                            {s.name || `Season ${s.number}`}
                            {s.number ===
                            Math.max(...detail.seasons.map((x) => x.number))
                              ? " (Latest)"
                              : ""}
                          </option>
                        ))}
                      </select>
                      {seasonLoading && (
                        <Loader2
                          size={14}
                          className="animate-spin text-amber-500"
                        />
                      )}
                    </div>
                    {detail.loadedSeason &&
                      detail.loadedSeason.episodes.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                            {detail.seasons.length === 1
                              ? "Episodes"
                              : `Season ${detail.loadedSeason.number} Episodes`}
                          </p>
                          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-auto">
                            {detail.loadedSeason.episodes.map((ep) => (
                              <button
                                key={ep.id}
                                onClick={() => {
                                  setSelectedEpisode(ep.id);
                                  play(ep.id);
                                }}
                                className={`px-2 py-1.5 rounded-lg text-left text-[11px] transition-colors ${selectedEpisode === ep.id ? "bg-amber-500 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}`}
                              >
                                <span className="font-medium">
                                  E{ep.number}
                                </span>{" "}
                                {ep.name && (
                                  <span className="opacity-80">
                                    · {ep.name}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                  </div>
                )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => toggleFavorite(selected)}
                  className={`flex-1 min-w-[120px] py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${isFavorited(selected) ? "bg-rose-500/20 text-rose-600 dark:text-rose-400" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                >
                  <Heart
                    size={13}
                    className={isFavorited(selected) ? "fill-rose-500" : ""}
                  />
                  {isFavorited(selected) ? "Favorited" : "Favorite"}
                </button>
                <button
                  onClick={() => toggleWatchlist(selected)}
                  className={`flex-1 min-w-[120px] py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${isWatchlisted(selected) ? "bg-blue-500/20 text-blue-600 dark:text-blue-400" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                >
                  {isWatchlisted(selected) ? (
                    <BookmarkCheck size={13} />
                  ) : (
                    <Bookmark size={13} />
                  )}
                  {isWatchlisted(selected) ? "Watchlisted" : "Watchlist"}
                </button>
                {detail && detail.trailers.length > 0 && (
                  <button
                    onClick={() => {
                      setActiveTrailer(0);
                      setTrailerOpen(true);
                    }}
                    className="flex-1 min-w-[120px] py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25"
                  >
                    <MonitorPlay size={13} /> Trailer
                    {detail.trailers.length > 1 && (
                      <span className="text-[10px] opacity-70">
                        ({detail.trailers.length})
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* In-app trailer preview modal (YouTube embed). The API only
                  returns validated-playable trailer ids (upstream ids that
                  are private/deleted are filtered out, with a YouTube
                  search fallback), so this always yields a working preview. */}
              {trailerOpen && detail && detail.trailers.length > 0 && (
                <div
                  className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-3 sm:p-6"
                  onClick={() => setTrailerOpen(false)}
                  role="dialog"
                  aria-label={`${selected.name} trailer`}
                >
                  <div
                    className="relative w-full max-w-3xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-semibold text-white truncate">
                        {selected.name}
                        <span className="ml-2 text-[11px] font-normal text-red-400">
                          Trailer{" "}
                          {detail.trailers.length > 1
                            ? `${activeTrailer + 1} of ${detail.trailers.length}`
                            : ""}
                        </span>
                      </p>
                      <button
                        onClick={() => setTrailerOpen(false)}
                        className="p-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20"
                        title="Close trailer"
                        aria-label="Close trailer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/10">
                      <iframe
                        key={detail.trailers[activeTrailer]}
                        src={`https://www.youtube-nocookie.com/embed/${detail.trailers[activeTrailer]}?autoplay=1&rel=0`}
                        className="absolute inset-0 w-full h-full"
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        frameBorder="0"
                        title={`${selected.name} trailer`}
                      />
                    </div>
                    {detail.trailers.length > 1 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {detail.trailers.map((t, i) => (
                          <button
                            key={t}
                            onClick={() => setActiveTrailer(i)}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${activeTrailer === i ? "bg-red-500 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"}`}
                          >
                            Trailer {i + 1}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Library section (favorites / watchlist / continue-watching) ─────────────
function LibrarySection({
  title,
  icon,
  items,
  onOpen,
  onRemove,
  empty,
}: {
  title: string;
  icon: React.ReactNode;
  items: MovieItem[];
  onOpen: (m: MovieItem) => void;
  onRemove: (m: MovieItem) => void;
  empty: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
        {icon} {title}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-gray-400">{empty}</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((m) => (
            <div
              key={m.id}
              className="relative flex-shrink-0 w-20 group cursor-pointer"
              onClick={() => onOpen(m)}
            >
              <div className="w-20 h-28 rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-700">
                {m.poster ? (
                  <img
                    src={m.poster}
                    alt={m.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Film size={18} className="text-gray-400" />
                  </div>
                )}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(m);
                }}
                className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <Trash2 size={10} />
              </button>
              <p className="mt-1 text-[10px] text-gray-600 dark:text-gray-400 line-clamp-1">
                {m.name}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Movie card ──────────────────────────────────────────────────────────────
function MovieCard({
  movie,
  onOpen,
  onFavorite,
  onWatchlist,
  favorited,
  watchlisted,
  accent,
}: {
  movie: MovieItem;
  onOpen: () => void;
  onFavorite: () => void;
  onWatchlist: () => void;
  favorited: boolean;
  watchlisted: boolean;
  accent: string;
}) {
  return (
    <div className="group relative">
      <div
        onClick={onOpen}
        className={`relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 border-2 ${accent} cursor-pointer transition-transform group-hover:scale-[1.02]`}
      >
        {movie.poster ? (
          <img
            src={movie.poster}
            alt={movie.name}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film size={28} className="text-gray-400" />
          </div>
        )}
        {/* hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
          <div className="flex items-center gap-1">
            <Play size={12} className="text-white fill-white" />
            <span className="text-white text-[10px] font-semibold">Watch</span>
          </div>
        </div>
        {/* score badge */}
        {movie.score && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] bg-black/70 text-amber-400 font-semibold flex items-center gap-1">
            <Star size={9} className="fill-amber-400" /> {movie.score}
          </span>
        )}
        {/* type badge (Series vs Movie) */}
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] bg-black/70 text-white/90 font-medium flex items-center gap-1 uppercase">
          {movie.type === "tv" ? (
            <>
              <Tv size={9} /> Series
            </>
          ) : (
            <>
              <Film size={9} /> Movie
            </>
          )}
        </span>
      </div>
      {/* action buttons */}
      <div className="absolute top-1.5 right-1.5 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFavorite();
          }}
          className="p-1 rounded-md bg-black/60 text-white hover:bg-black/80"
          title={favorited ? "Unfavorite" : "Favorite"}
        >
          <Heart
            size={11}
            className={favorited ? "fill-rose-500 text-rose-500" : ""}
          />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onWatchlist();
          }}
          className="p-1 rounded-md bg-black/60 text-white hover:bg-black/80"
          title={watchlisted ? "Remove from watchlist" : "Add to watchlist"}
        >
          {watchlisted ? (
            <BookmarkCheck size={11} className="text-blue-400" />
          ) : (
            <Bookmark size={11} />
          )}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 line-clamp-1 group-hover:text-amber-600 dark:group-hover:text-amber-400">
        {movie.name}
      </p>
      {movie.year && <p className="text-[10px] text-gray-400">{movie.year}</p>}
    </div>
  );
}

// ─── ClassicCard — public-domain classic film card ──────────────────────────
function ClassicCard({
  movie,
  onOpen,
  accent,
}: {
  movie: ClassicMovieItem;
  onOpen: () => void;
  accent: string;
}) {
  return (
    <div className="group relative">
      <div
        onClick={onOpen}
        className={`relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 border-2 ${accent} cursor-pointer transition-transform group-hover:scale-[1.02]`}
      >
        <img
          src={movie.poster}
          alt={movie.name}
          loading="lazy"
          className="w-full h-full object-cover"
        />
        {/* hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
          <div className="flex items-center gap-1">
            <Play size={12} className="text-white fill-white" />
            <span className="text-white text-[10px] font-semibold">
              Watch free
            </span>
          </div>
        </div>
        {/* Classic badge */}
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] bg-black/70 text-white/90 font-medium flex items-center gap-1 uppercase">
          <Clapperboard size={9} /> Classic
        </span>
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 line-clamp-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
        {movie.name}
      </p>
      {movie.year && <p className="text-[10px] text-gray-400">{movie.year}</p>}
    </div>
  );
}
