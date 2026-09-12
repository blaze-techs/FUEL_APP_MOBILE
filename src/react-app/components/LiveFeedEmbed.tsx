import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  LIVE_FEED_CATEGORIES,
  LIVE_FEED_FAVORITES_KEY,
  LIVE_FEED_HISTORY_KEY,
  HISTORY_MAX,
  getRandomLiveFeedCombo,
  saveReminders,
  loadReminders,
  nextReminderTime,
  formatMinuteOfDay,
  getSubCategory,
  filterChannelsByKeywords,
  searchChannels,
  fetchLiveChannels,
  fetchIptvChannels,
  mergeChannelsWithIptv,
  mapToIptvCategory,
  getCuratedGoodChannels,
  resolveChannelFetchParams,
  trackChannelPlay,
  type LiveCategory,
  type LiveChannel,
  type LiveFeedCategory,
  type LiveFeedFavorite,
  type LiveFeedHistoryEntry,
  type LiveFeedReminder,
  type ReminderRecurrence,
} from "@/react-app/services/LiveStreamService";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";
import { useAuth } from "@/react-app/context/AuthContext";
import {
  usePopupShield,
  PopupShieldBadge,
} from "@/react-app/components/ui/PopupShieldBadge";
import { ALL_COUNTRIES } from "@/react-app/lib/world-country-utils";

// O(1) country-code → readable-name lookup (the per-card ALL_COUNTRIES.find
// on a 218-entry array is a hot path once the grid renders dozens of cards).
const COUNTRY_NAME_MAP: ReadonlyMap<string, string> = new Map(
  ALL_COUNTRIES.map((c) => [c.code, c.name]),
);
const countryName = (code?: string): string =>
  (code ? COUNTRY_NAME_MAP.get(code) : undefined) ??
  (code ? code.toUpperCase() : "");
import {
  SUBTITLE_LANGUAGES,
  detectPreferredSubtitleLang,
  findSubtitleTrackIndex,
} from "@/react-app/lib/subtitle-languages";
import {
  liveCaptionEngine,
  type CaptionStatus,
} from "@/react-app/lib/live-caption-engine";
import Hls from "hls.js";
import {
  Tv,
  Radio,
  Grid3x3,
  Maximize2,
  Minimize2,
  Heart,
  Shuffle,
  Clock,
  X,
  Sparkles,
  Layers,
  Tag,
  Bell,
  Calendar,
  Trash2,
  Loader2,
  Monitor,
  Play,
  Search,
  PictureInPicture2,
  SkipForward,
  RotateCcw,
  Globe,
  Signal,
} from "lucide-react";

interface LiveFeedEmbedProps {
  /** Initial category (default: "tv") */
  defaultCategory?: LiveCategory;
  /** Initial sub-category id (within the default category) */
  defaultSubCategory?: string;
  /** Initial country code (ISO-2, lowercased). Empty = all countries */
  defaultCountry?: string;
  /** Whether to show the category switcher (multi-category mode) */
  showCategorySwitcher?: boolean;
  /** Whether to show the sub-category switcher (2nd-level taxonomy) */
  showSubCategorySwitcher?: boolean;
  /** Whether to show the feature toolbar (favorites, surprise, fullscreen) */
  showFeatureToolbar?: boolean;
  /** Restrict to a single family ("video" | "audio") — hides the other */
  family?: "video" | "audio";
  /** Visual accent color for the active category badge */
  accent?: "blue" | "purple";
  /** Compact mode: shorter player height */
  compact?: boolean;
}

/**
 * LiveFeedEmbed — FULL NATIVE live-channel browser + player.
 *
 * A complete native replicate of a global live-TV/radio guide, powered
 * server-side by the reverse-engineered live-channel API (via the
 * same-origin /api/live-channels + /api/iptv-channels proxies). ZERO
 * upstream attribution — no iframe to the provider's site, no branding,
 * no links. Every pixel is native FuelPro UI.
 *
 * FEATURES (favorites/history/reminders cloud-synced cross-device):
 *  - 2-LEVEL taxonomy: category (Movies/News/Sports/Music/Kids/Docs...) +
 *    sub-category (Movies → Action/Adventure/Horror/Family/Historical/
 *    Real-Life/Animation/Western/Romance/Sci-Fi/Crime/Fantasy/Musical/War/
 *    Bollywood/Classics/Comedy/Drama; Sports → Football/Basketball/
 *    Motorsport/Fight/Esports/...; etc.)
 *  - Genre keyword sub-classification within broad upstream categories
 *  - Country filter (195 countries) + Show All (global)
 *  - NATIVE PLAYER: HLS via hls.js (direct URL first, CORS-proxy fallback),
 *    YouTube iframe for YouTube channels, <audio> for radio
 *  - QUALITY SELECTOR: pick the stream rendition (1080p/720p/540p/360p/Auto)
 *    — defaults to the HIGHEST available resolution (1080p+ preference)
 *  - Picture-in-Picture, fullscreen, retry, next-channel
 *  - Native channel grid (logo/name/country/badges) with load-more paging
 *  - Favorites, Surprise Me, Recently Watched, channel-play analytics
 *  - EPG / WATCH REMINDERS (schedule what to watch when)
 */

/** ISO weekdays Mon(1)..Sun(7) labels. */
const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Grid page size for the "Load more" pager. */
const GRID_PAGE = 48;

/** Format a ms-epoch timestamp as a relative "in Xm" / "in Xh" / "X ago" string. */
function formatRelativeTime(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  const mins = Math.round(abs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return past ? `${mins}m ago` : `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return past ? `${hours}h ago` : `in ${hours}h`;
  const days = Math.round(hours / 24);
  return past ? `${days}d ago` : `in ${days}d`;
}

/** Extract a YouTube video id from any YouTube URL form (or a raw 11-char id). */
function extractYouTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|live\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{11}$/.test(url.trim()) ? url.trim() : null;
}

/** Build the CORS-proxy URL for an HLS resource (same-origin on both hosts).
 * Uses the ABSOLUTE origin (window.location.origin) instead of a relative
 * path — the relative form silently stalls hls.js's manifest fetch in some
 * contexts. */
function hlsProxyUrl(url: string, ua?: string, ref?: string): string {
  const origin = window.location.origin;
  let out = `${origin}/api/hls-proxy?url=${encodeURIComponent(url)}`;
  if (ua) out += `&ua=${encodeURIComponent(ua)}`;
  if (ref) out += `&ref=${encodeURIComponent(ref)}`;
  return out;
}

/** A selectable HLS quality level (one rendition of the master playlist). */
interface QualityLevel {
  /** hls.js level index */
  index: number;
  /** Vertical resolution (e.g. 1080, 720). 0 when unknown. */
  height: number;
  /** Peak bandwidth in bps (used as a fallback label). */
  bitrate: number;
}

/** Label for a quality level: "1080p", "720p", or a bitrate fallback. */
function qualityLabel(l: QualityLevel): string {
  if (l.height > 0) return `${l.height}p`;
  if (l.bitrate > 0) return `${Math.round(l.bitrate / 1000)}k`;
  return `Level ${l.index + 1}`;
}

// ===========================================================================
// ChannelPlayer — the NATIVE player. HLS via hls.js with a quality selector
// (defaults to the HIGHEST rendition → 1080p+), YouTube iframe for YouTube
// channels, <audio> for radio. PiP + retry + next-channel built in.
// ===========================================================================
function ChannelPlayer({
  channel,
  isAudio,
  accent,
  onNext,
  onToggleFullscreen,
  isFullscreen,
  onCaptionFallback,
}: {
  channel: LiveChannel;
  isAudio: boolean;
  accent: "blue" | "purple";
  onNext: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  /** Called when subtitles are toggled ON but the stream carries no embedded
   * tracks — lets the parent auto-advance to a captioned channel. */
  onCaptionFallback?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);
  const ytPlayerRef = useRef<{
    destroy: () => void;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [pipActive, setPipActive] = useState(false);
  const [buffering, setBuffering] = useState(true);

  // Popup Blocker Pro lifecycle: the strict popup shield engages while a
  // channel is playing (ads/popups can't fire) and releases the moment the
  // player unmounts (user leaves the channel / switches tabs).
  usePopupShield(isAudio ? "live-radio" : "live-tv", true);

  // ─── SUBTITLES / CC ──
  // Preferred subtitle language: persisted to cloud (cross-device), auto-detected
  // from the browser locale / station country on first run.
  const [subtitleLang, setSubtitleLang] = useState<string>(() => {
    const cached = cloudStorageService.getCached<string>(
      "live_feed_subtitle_lang",
    );
    return cached || detectPreferredSubtitleLang(channel.country);
  });
  const [subtitleTracks, setSubtitleTracks] = useState<
    { index: number; label: string; lang: string }[]
  >([]);
  const [activeSubtitleIdx, setActiveSubtitleIdx] = useState(-1); // -1 = off
  const activeSubtitleIdxRef = useRef(-1);
  activeSubtitleIdxRef.current = activeSubtitleIdx;
  const [showCcMenu, setShowCcMenu] = useState(false);
  const subtitleLangRef = useRef(subtitleLang);
  subtitleLangRef.current = subtitleLang;

  // ─── LIVE AI CAPTIONS (generated on-device for streams with no embedded tracks) ──
  const [liveCaptionsOn, setLiveCaptionsOn] = useState(false);
  const [liveCaptionText, setLiveCaptionText] = useState<string>("");
  const [liveCaptionStatus, setLiveCaptionStatus] =
    useState<CaptionStatus>("idle");
  const [liveCaptionDetail, setLiveCaptionDetail] = useState<string>("");
  const liveCaptionTextRef = useRef<string>("");
  liveCaptionTextRef.current = liveCaptionText;

  const ytId = useMemo(
    () =>
      (channel.youtube_urls?.length ?? 0) > 0
        ? extractYouTubeId(channel.youtube_urls[0])
        : null,
    [channel],
  );
  const streamUrl = channel.stream_urls?.[0] || "";
  const countryName = channel.country
    ? ALL_COUNTRIES.find((c) => c.code === channel.country)?.name ||
      channel.country.toUpperCase()
    : "";

  // HLS / direct playback wiring (skip when rendering a YouTube iframe)
  useEffect(() => {
    if (ytId || !streamUrl) return;
    let destroyed = false;
    // PRIMARY loader for ~HLS (~.m3u8) sources is the same-origin
    // /api/hls-proxy (CSP-compliant + defeats CORS). Direct fallback on fatal.
    // ICECAST/MP3 and other non-HLS streams (mostly RADIO) must bypass hsl.js —
    // feeding a non-HLS URL into hls.js guaranteed no playback (root cause of
    // the radio dead-stream bug).
    const isHlsSource = /\.m3u8(\?|#|$)/i.test(streamUrl);
    let retriedDirectly = false;
    const mediaEl: HTMLVideoElement | HTMLAudioElement | null = isAudio
      ? audioRef.current
      : videoRef.current;
    if (!mediaEl) return;
    setError(null);
    setLevels([]);
    setCurrentLevel(-1);
    setBuffering(true);

    if (!isHlsSource) {
      // Native direct stream — unblocks MP3/icecast radio. ALSO routes through
      // the same-origin proxy so the strict CSP (`media-src 'self' blob:`)
      // can allow the media element to connect (CSP still blocks arbitrary
      // external hosts even on <audio>/<video>).
      mediaEl.src = hlsProxyUrl(streamUrl, channel.userAgent, channel.referrer);
      mediaEl.play().catch(() => {
        /* autoplay blocked */
      });
      setBuffering(false);
      return;
    }

    const handleFatal = (
      Hls: typeof import("hls.js").default,
      hls: import("hls.js").default,
      data: { type?: string; fatal?: boolean },
    ) => {
      if (!data.fatal) return;
      if (!retriedDirectly) {
        // Retry once via the direct URL (proxy may have failed for another
        // reason e.g. upstream needs unusual headers).
        retriedDirectly = true;
        try {
          hls.destroy();
        } catch {
          /* */
        }
        attachHls(Hls, streamUrl);
        return;
      }
      if (!destroyed) {
        setBuffering(false);
        // AUTO-ADVANCE: don't dead-end on a dead upstream stream. Give the
        // parent a chance to move to the next playable channel (curated
        // known-good channels are always available). The error only shows if
        // there is genuinely nothing else to play.
        if (onCaptionFallback) {
          onCaptionFallback();
        } else {
          setError(
            "This station's stream is currently unreachable. Try another station.",
          );
        }
      }
    };

    const attachHls = (Hls: typeof import("hls.js").default, url: string) => {
      const hls = new Hls({
        // Fetch on the main thread — reliable across all contexts.
        enableWorker: false,
        lowLatencyMode: true,
        capLevelToPlayerSize: false,
        abrEwmaDefaultEstimate: 10_000_000,
        manifestLoadingTimeOut: 15000,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 30000,
      });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(mediaEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (destroyed) return;
        const lv: QualityLevel[] = hls.levels
          .map((l, i) => ({
            index: i,
            height: l.height || 0,
            bitrate: l.bitrate || 0,
          }))
          .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
        setLevels(lv);
        const best = lv[0];
        if (best) {
          hls.currentLevel = best.index;
          setCurrentLevel(best.index);
        }
        mediaEl.play().catch(() => {
          /* autoplay blocked — user presses play */
        });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        if (!destroyed) setCurrentLevel(data.level);
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (!destroyed) setBuffering(false);
      });
      // Subtitle tracks: list them + auto-select the track matching the
      // preferred language (browser locale / station country).
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
        if (destroyed) return;
        const tracks = (data.subtitleTracks || []).map(
          (t: { name?: string; lang?: string }, i: number) => ({
            index: i,
            label: t.name || t.lang || `Track ${i + 1}`,
            lang: (t.lang || "").toLowerCase(),
          }),
        );
        setSubtitleTracks(tracks);
        if (tracks.length > 0 && activeSubtitleIdxRef.current < 0) {
          const match = findSubtitleTrackIndex(
            data.subtitleTracks as { lang?: string; name?: string }[],
            subtitleLangRef.current,
          );
          if (match >= 0) {
            hls.subtitleTrack = match;
            hls.subtitleDisplay = true;
            setActiveSubtitleIdx(match);
          }
        }
      });
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => {
        if (!destroyed) setActiveSubtitleIdx(data.id);
      });
      hls.on(Hls.Events.ERROR, (_e, data) => handleFatal(Hls, hls, data));
    };

    if (Hls.isSupported()) {
      // Same-origin proxy FIRST (CSP-compliant), direct fallback on fatal.
      attachHls(
        Hls,
        hlsProxyUrl(streamUrl, channel.userAgent, channel.referrer),
      );
    } else {
      // Safari native HLS / non-HLS direct stream (mp3/aac/icecast etc.)
      mediaEl.src = hlsProxyUrl(streamUrl, channel.userAgent, channel.referrer);
      mediaEl.play().catch(() => {
        /* autoplay blocked */
      });
      setBuffering(false);
    }

    return () => {
      destroyed = true;
      try {
        hlsRef.current?.destroy();
      } catch {
        /* */
      }
      hlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.nanoid, retryKey]);

  // Track PiP state changes (e.g. user closes the PiP window directly)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [ytId, isAudio]);

  const applyQuality = (idx: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = idx; // -1 = Auto (adaptive)
    setCurrentLevel(idx);
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      /* PiP unsupported */
    }
  };

  // ─── Subtitle selection ──
  // Apply a subtitle track by index (-1 = off). HLS only.
  const applySubtitleTrack = (idx: number) => {
    const hls = hlsRef.current;
    setActiveSubtitleIdx(idx);
    if (!hls) return;
    if (idx < 0) {
      hls.subtitleDisplay = false;
      hls.subtitleTrack = -1;
    } else {
      hls.subtitleTrack = idx;
      hls.subtitleDisplay = true;
    }
  };

  // ─── LIVE AI CAPTION ENGINE controls ───────────────────────────────────
  // Start the on-device caption engine on the currently-playing media element.
  // Works for HLS video AND live radio <audio> — ANY stream can be captioned.
  const startLiveCaptions = useCallback(() => {
    const mediaEl: HTMLMediaElement | null = isAudio
      ? audioRef.current
      : videoRef.current;
    if (!mediaEl) {
      setLiveCaptionStatus("unavailable");
      setLiveCaptionDetail(
        "No playing media to caption yet — press play first.",
      );
      return;
    }
    // Ensure cross-origin audio capture works (HLS CDNs send CORS *).
    if (!mediaEl.crossOrigin) mediaEl.crossOrigin = "anonymous";
    setLiveCaptionStatus("loading-model");
    setLiveCaptionDetail("");
    liveCaptionEngine.start(
      mediaEl,
      (text) => {
        setLiveCaptionText(text);
      },
      (status, detail) => {
        setLiveCaptionStatus(status);
        setLiveCaptionDetail(detail || "");
      },
      // Pass the user's preferred language so non-English transcripts are
      // translated on-device before display.
      subtitleLangRef.current,
      // Pass the channel's country so the ASR language matches the language
      // SPOKEN in the stream (accuracy), not just the display language.
      channel.country || "",
    );
  }, [isAudio]);

  const stopLiveCaptions = useCallback(() => {
    liveCaptionEngine.stop();
    setLiveCaptionStatus("idle");
    setLiveCaptionText("");
    setLiveCaptionDetail("");
  }, []);

  const toggleLiveCaptions = useCallback(() => {
    setLiveCaptionsOn((prev) => {
      const next = !prev;
      if (next) {
        // Turn off any embedded track first — AI captions replace it.
        if (hlsRef.current) {
          hlsRef.current.subtitleDisplay = false;
          hlsRef.current.subtitleTrack = -1;
        }
        setActiveSubtitleIdx(-1);
        startLiveCaptions();
      } else {
        stopLiveCaptions();
      }
      return next;
    });
  }, [startLiveCaptions, stopLiveCaptions]);

  // Stop the engine when the channel changes or the player unmounts.
  useEffect(() => {
    return () => {
      liveCaptionEngine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.nanoid]);

  // Change the PREFERRED language: persist to cloud (cross-device) and, if the
  // current stream carries a matching track, switch to it immediately.
  const applySubtitleLang = (lang: string) => {
    setSubtitleLang(lang);
    subtitleLangRef.current = lang;
    cloudStorageService.set("live_feed_subtitle_lang", lang).catch(() => {});
    if (subtitleTracks.length > 0) {
      const match = findSubtitleTrackIndex(subtitleTracks, lang);
      if (match >= 0) {
        applySubtitleTrack(match);
        return;
      }
    }
    // No embedded track for this stream — generate live AI captions in the
    // preferred language (works on ANY stream: HLS video AND radio). If the
    // player isn't playing yet, surface the AI CC button state instead.
    if (!liveCaptionsOn) {
      // Auto-start the AI caption engine so the preferred language activates
      // immediately (no dead-end "no subtitle tracks" state).
      setLiveCaptionsOn(true);
      if (hlsRef.current) {
        hlsRef.current.subtitleDisplay = false;
        hlsRef.current.subtitleTrack = -1;
      }
      setActiveSubtitleIdx(-1);
      startLiveCaptions();
    } else if (!liveCaptionEngine.isActive()) {
      startLiveCaptions();
    }
    // If the player has no media yet (not playing), the status callback will
    // show "press play first" — never a dead end. No channel auto-advance
    // here: AI captions generate on ANY stream, so the preferred language
    // never needs to throw the user to a different channel.
  };

  // ─── YOUTUBE IFRAME API — error detection + auto-advance ─────────────
  // The plain <iframe> embed cannot report playback errors (cross-origin).
  // Using the official IFrame API lets us detect "Video unavailable" /
  // embedding-disabled / region-blocked errors and auto-advance to the next
  // playable channel instead of dead-ending on a black screen.
  useEffect(() => {
    if (!ytId) return;
    let destroyed = false;
    let player: { destroy: () => void } | null = null;

    const initPlayer = () => {
      if (destroyed) return;
      // Wait for the YouTube IFrame API to be ready.
      const YT = (
        window as unknown as {
          YT?: {
            Player: new (
              el: HTMLElement,
              opts: {
                videoId: string;
                playerVars?: Record<string, string | number>;
                events?: {
                  onReady?: (e: { target: { playVideo: () => void } }) => void;
                  onError?: (e: { data: number }) => void;
                };
              },
            ) => { destroy: () => void };
            PlayerState?: { ENDED: number };
          };
        }
      ).YT;
      if (!YT?.Player) {
        // API not loaded yet — retry shortly.
        setTimeout(initPlayer, 300);
        return;
      }
      const container = document.getElementById(`yt-player-${channel.nanoid}`);
      if (!container) return;
      player = new YT.Player(container, {
        videoId: ytId,
        playerVars: {
          autoplay: 1,
          mute: 1,
          rel: 0,
          cc_load_policy: 1,
          cc_lang_pref: subtitleLangRef.current,
          playsinline: 1,
          enablejsapi: 1,
        },
        events: {
          onReady: (e) => {
            e.target.playVideo();
          },
          onError: (e) => {
            // Error codes: 2=invalid param, 5=HTML5 error, 100=not found,
            // 101/150=embedding disabled/region blocked.
            if (!destroyed) {
              setError(
                "This station's stream is currently unavailable. Trying next channel…",
              );
              // Auto-advance to the next playable channel.
              if (onCaptionFallback) {
                onCaptionFallback();
              } else {
                onNext();
              }
            }
          },
        },
      });
      ytPlayerRef.current = player;
    };

    initPlayer();
    return () => {
      destroyed = true;
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          /* */
        }
        ytPlayerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytId, channel.nanoid, retryKey]);

  const kindBadge = ytId ? "YouTube" : isAudio ? "Radio" : "HLS";
  const maxHeight = levels[0]?.height || 0;
  const accentText =
    accent === "purple"
      ? "text-purple-600 dark:text-purple-400"
      : "text-blue-600 dark:text-blue-400";

  return (
    <div className="absolute inset-0 bg-black flex flex-col">
      {/* Player header: name + badges + quality + PiP + next */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          <Play size={12} className="text-green-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-white truncate">
            {channel.name}
          </span>
          {countryName && (
            <span className="text-[10px] text-gray-400 flex-shrink-0 hidden sm:inline">
              {countryName}
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 flex-shrink-0">
            {kindBadge}
          </span>
          {maxHeight >= 720 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex-shrink-0">
              {maxHeight >= 1080 ? "FULL HD" : "HD"}
            </span>
          )}
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30 flex items-center gap-1 flex-shrink-0">
            <span className="w-1 h-1 bg-green-400 rounded-full animate-pulse" />
            LIVE
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Quality selector — HLS only, 2+ renditions */}
          {!ytId && !isAudio && levels.length > 1 && (
            <select
              value={currentLevel}
              onChange={(e) => applyQuality(Number(e.target.value))}
              title="Stream quality"
              aria-label="Stream quality"
              className="text-[10px] bg-gray-800 border border-gray-700 rounded-lg px-1.5 py-1 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={-1}>Auto</option>
              {levels.map((l) => (
                <option key={l.index} value={l.index}>
                  {qualityLabel(l)}
                </option>
              ))}
            </select>
          )}
          {/* Ad & popup shield badge — visible while the player is open;
              shows how many popups/ads were blocked. */}
          <PopupShieldBadge />
          {/* PiP — native video only */}
          {!ytId && !isAudio && (
            <button
              onClick={togglePip}
              title={
                pipActive ? "Exit picture-in-picture" : "Picture-in-picture"
              }
              aria-label="Picture-in-picture"
              className={`p-1.5 rounded-lg transition-colors ${
                pipActive
                  ? "bg-blue-500 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
            >
              <PictureInPicture2 size={12} />
            </button>
          )}
          {/* AI Live Captions — generates subtitles ON-DEVICE for ANY stream
              (HLS video AND live radio), even with zero embedded tracks.
              Hidden for YouTube embeds (captions handled by the iframe). */}
          {!ytId && (
            <button
              onClick={toggleLiveCaptions}
              title={
                liveCaptionsOn
                  ? "Stop live AI captions"
                  : "Generate live captions (on-device AI, works on any stream)"
              }
              aria-label="Live AI captions"
              aria-pressed={liveCaptionsOn}
              className={`p-1.5 rounded-lg transition-colors font-bold text-[10px] flex items-center gap-1 ${
                liveCaptionsOn
                  ? "bg-purple-500 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
              }`}
            >
              <span className="relative flex items-center">
                AI
                {liveCaptionsOn && (
                  <span className="absolute -top-1 -right-1.5 w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                )}
              </span>
            </button>
          )}
          {/* Subtitles / CC — HLS video AND live radio. On radio the menu
              shows the preferred-language picker + AI caption toggle (no
              embedded tracks on audio streams). */}
          {!ytId && (
            <div className="relative">
              <button
                onClick={() => setShowCcMenu((v) => !v)}
                title="Subtitles / Closed captions"
                aria-label="Subtitles"
                className={`p-1.5 rounded-lg transition-colors font-bold text-[10px] ${
                  activeSubtitleIdx >= 0 || liveCaptionsOn
                    ? "bg-blue-500 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
                }`}
              >
                CC
              </button>
              {showCcMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-30 max-h-72 overflow-y-auto">
                  {/* Stream tracks (from the HLS manifest) — video only */}
                  {!isAudio && subtitleTracks.length > 0 && (
                    <>
                      <p className="px-3 pt-2 text-[9px] uppercase tracking-wide text-gray-500">
                        This stream
                      </p>
                      <button
                        onClick={() => {
                          applySubtitleTrack(-1);
                          setShowCcMenu(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 ${
                          activeSubtitleIdx < 0
                            ? "text-blue-400 font-semibold"
                            : "text-gray-200"
                        }`}
                      >
                        Off
                      </button>
                      {subtitleTracks.map((t) => (
                        <button
                          key={t.index}
                          onClick={() => {
                            applySubtitleTrack(t.index);
                            setShowCcMenu(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 ${
                            activeSubtitleIdx === t.index
                              ? "text-blue-400 font-semibold"
                              : "text-gray-200"
                          }`}
                        >
                          {t.label}
                          {t.lang && (
                            <span className="text-gray-500 ml-1">
                              ({t.lang})
                            </span>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                  {/* No-track hint — shown when there are no embedded tracks
                      (always on radio, sometimes on video). */}
                  {(isAudio || subtitleTracks.length === 0) && (
                    <p className="px-3 py-1.5 text-[10px] text-gray-500">
                      {isAudio
                        ? "This station has no embedded subtitles. Pick a preferred language below — AI live captions will generate them on-device."
                        : "This stream has no embedded subtitles. Pick a preferred language below — it will auto-activate on any stream or channel that carries captions (including YouTube)."}
                    </p>
                  )}
                  {/* Preferred language (auto-selects on streams that carry it) */}
                  <p className="px-3 pt-2 text-[9px] uppercase tracking-wide text-gray-500 border-t border-gray-800 mt-1">
                    Preferred language (auto-select)
                  </p>
                  {SUBTITLE_LANGUAGES.map((l) => (
                    <button
                      key={l.label}
                      onClick={() => applySubtitleLang(l.codes[0])}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-800 ${
                        subtitleLang === l.codes[0]
                          ? "text-blue-400 font-semibold"
                          : "text-gray-200"
                      }`}
                    >
                      {l.label}{" "}
                      <span className="text-gray-500">{l.native}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={onNext}
            title="Next channel"
            aria-label="Next channel"
            className="p-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors fp-icon-only"
          >
            <SkipForward size={12} />
          </button>
          {/* Fullscreen toggle on the player itself (big + always visible on
              touch devices — the header toolbar icon is easy to miss on a
              phone). */}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
        </div>
      </div>
      {/* Player body */}
      <div className="flex-1 relative bg-black">
        {ytId ? (
          <div
            id={`yt-player-${channel.nanoid}`}
            className="absolute inset-0 w-full h-full"
          />
        ) : isAudio ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 bg-gradient-to-br from-gray-900 via-gray-950 to-black">
            <div className="w-20 h-20 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
              <Radio size={36} className="text-purple-400" />
            </div>
            <p className="text-sm font-semibold text-white text-center">
              {channel.name}
            </p>
            {countryName && (
              <p className="text-[11px] text-gray-400 -mt-2">{countryName}</p>
            )}
            <audio
              key={`${channel.nanoid}-${retryKey}`}
              ref={audioRef}
              controls
              autoPlay
              crossOrigin="anonymous"
              className="w-full max-w-md"
            />
          </div>
        ) : (
          <>
            <video
              key={`${channel.nanoid}-${retryKey}`}
              ref={videoRef}
              controls
              autoPlay
              muted
              playsInline
              crossOrigin="anonymous"
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
            {buffering && !error && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <Loader2 size={28} className={`animate-spin ${accentText}`} />
              </div>
            )}
          </>
        )}
        {/* LIVE AI CAPTION OVERLAY — shows generated captions on top of the
            video (bottom-center, YouTube-style). Renders whenever AI captions
            are ON, for HLS video AND radio. */}
        {!ytId && liveCaptionsOn && (
          <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-1.5 pointer-events-none z-20 px-4">
            {liveCaptionStatus === "loading-model" && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm">
                <Loader2 size={12} className="animate-spin text-purple-400" />
                <span className="text-[10px] text-gray-200">
                  Loading on-device caption model (first use downloads ~31 MB)…
                </span>
              </div>
            )}
            {liveCaptionStatus === "listening" && liveCaptionText && (
              <div className="max-w-[90%] px-4 py-2 rounded-lg bg-black/70 backdrop-blur-sm text-center">
                <p className="text-sm md:text-base font-medium text-white leading-snug">
                  {liveCaptionText}
                </p>
                <span className="block mt-1 text-[8px] uppercase tracking-wider text-purple-300/80">
                  AI live captions
                </span>
              </div>
            )}
            {liveCaptionStatus === "listening" && !liveCaptionText && (
              <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm">
                <span className="text-[10px] text-gray-300">
                  Listening — captions appear as speech is detected…
                </span>
              </div>
            )}
            {liveCaptionStatus === "unavailable" && (
              <div className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm">
                <span className="text-[10px] text-amber-300">
                  {liveCaptionDetail ||
                    "Live captions are not available for this stream."}
                </span>
              </div>
            )}
            {liveCaptionStatus === "error" && (
              <div className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm">
                <span className="text-[10px] text-red-300">
                  {liveCaptionDetail || "Caption generation failed."}
                </span>
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 p-4">
            <div className="text-center space-y-3">
              <p className="text-xs text-gray-300 max-w-xs">{error}</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 flex items-center gap-1"
                >
                  <RotateCcw size={11} /> Retry
                </button>
                <button
                  onClick={onNext}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 flex items-center gap-1"
                >
                  <SkipForward size={11} /> Next channel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// ChannelCard — a native grid card for one channel/station.
// ===========================================================================
function ChannelCard({
  channel,
  isActive,
  isAudio,
  onSelect,
}: {
  channel: LiveChannel;
  isActive: boolean;
  isAudio: boolean;
  onSelect: () => void;
}) {
  const [logoError, setLogoError] = useState(false);
  const isYt = (channel.youtube_urls?.length ?? 0) > 0;
  const countryLabel = countryName(channel.country);
  const initials = channel.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <button
      onClick={onSelect}
      title={`Play ${channel.name}`}
      className={`group relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border text-center transition-all ${
        isActive
          ? "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500/40"
          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md"
      }`}
    >
      {/* Logo / initials tile */}
      <div
        className={`w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0 ${
          isAudio
            ? "bg-purple-100 dark:bg-purple-900/40"
            : "bg-blue-100 dark:bg-blue-900/40"
        }`}
      >
        {channel.logo && !logoError ? (
          <img
            src={channel.logo}
            alt={channel.name ? `${channel.name} logo` : "Channel logo"}
            loading="lazy"
            onError={() => setLogoError(true)}
            className="w-full h-full object-contain"
          />
        ) : initials ? (
          <span
            className={`text-sm font-bold ${
              isAudio
                ? "text-purple-600 dark:text-purple-300"
                : "text-blue-600 dark:text-blue-300"
            }`}
          >
            {initials}
          </span>
        ) : isAudio ? (
          <Radio size={18} className="text-purple-600 dark:text-purple-300" />
        ) : (
          <Tv size={18} className="text-blue-600 dark:text-blue-300" />
        )}
      </div>
      {/* Name */}
      <span className="text-[10px] font-medium text-gray-800 dark:text-gray-200 leading-tight line-clamp-2 w-full">
        {channel.name}
      </span>
      {/* Meta row */}
      <span className="flex items-center gap-1 flex-wrap justify-center">
        {countryLabel && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 uppercase">
            {channel.country}
          </span>
        )}
        {isYt && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400">
            YT
          </span>
        )}
        {channel.isGeoBlocked && (
          <span className="text-[8px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
            GEO
          </span>
        )}
      </span>
      {/* Active indicator */}
      {isActive && (
        <span className="absolute top-1 right-1 flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded bg-green-500 text-white">
          <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
          ON
        </span>
      )}
    </button>
  );
}

// ===========================================================================
// LiveFeedEmbed — main component.
// ===========================================================================
export default function LiveFeedEmbed({
  defaultCategory = "tv",
  defaultSubCategory,
  defaultCountry = "",
  showCategorySwitcher = true,
  showSubCategorySwitcher = true,
  showFeatureToolbar = true,
  family,
  accent = "blue",
  compact = false,
}: LiveFeedEmbedProps) {
  const { user } = useAuth();
  const [category, setCategory] = useState<LiveCategory>(defaultCategory);
  const [subCategoryId, setSubCategoryId] = useState<string>(
    defaultSubCategory || "all",
  );
  const [country, setCountry] = useState<string>(defaultCountry);
  const [showAll, setShowAll] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFavoritesPanel, setShowFavoritesPanel] = useState(false);
  const [favorites, setFavorites] = useState<LiveFeedFavorite[]>([]);
  const [history, setHistory] = useState<LiveFeedHistoryEntry[]>([]);
  const [isFavorited, setIsFavorited] = useState(false);

  // EPG / Watch Reminders — cloud-backed, cross-device
  const [reminders, setReminders] = useState<LiveFeedReminder[]>([]);
  const [showRemindersPanel, setShowRemindersPanel] = useState(false);
  const [reminderForm, setReminderForm] = useState<{
    label: string;
    time: string;
    recurrence: ReminderRecurrence;
    weekday: number;
  }>({
    label: "",
    time: "20:00",
    recurrence: "once",
    weekday: 1,
  });
  const [showReminderModal, setShowReminderModal] = useState(false);

  // ─── NATIVE CHANNEL BROWSER ─────────────────────────────────────────────
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [activeChannel, setActiveChannel] = useState<LiveChannel | null>(null);
  const [channelSearch, setChannelSearch] = useState("");
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  /** Set when a genre keyword filter matched 0 channels (fell back to base). */
  const [keywordFilterMissed, setKeywordFilterMissed] = useState(false);

  // ─── Search debounce ───────────────────────────────────────────────────
  // The catalog can be ~13k channels (full iptv-org index.m3u). Filtering on
  // every keystroke would re-scan the whole array synchronously and jank the
  // UI, so the actual query is debounced 150ms; the input stays instant.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(channelSearch), 150);
    return () => clearTimeout(t);
  }, [channelSearch]);

  // Cloud load guard
  const cloudLoadCompleteRef = useRef(false);

  useEffect(() => {
    setCountry(defaultCountry);
  }, [defaultCountry]);

  const availableCategories = useMemo<LiveFeedCategory[]>(() => {
    if (family === "video")
      return LIVE_FEED_CATEGORIES.filter((c) => c.family === "video");
    if (family === "audio")
      return LIVE_FEED_CATEGORIES.filter((c) => c.family === "audio");
    return LIVE_FEED_CATEGORIES;
  }, [family]);

  const activeCat = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
  const isRadio = activeCat?.family === "audio";
  const activeSubCategory = useMemo(
    () => getSubCategory(category, subCategoryId),
    [category, subCategoryId],
  );

  // ─── FETCH CHANNELS for the active combo ────────────────────────────────
  // Base list from the live-channel API (via the same-origin proxy), merged
  // with the public-domain catalog (adds logos). Genre keyword sub-categories
  // filter the merged list client-side; a 0-match filter falls back to the
  // base list with a notice (never a dead end). Only playable stations are
  // listed (never show dead streams).
  useEffect(() => {
    let cancelled = false;
    setChannelSearch("");
    setGridLimit(GRID_PAGE);
    setChannelsLoading(true);
    setKeywordFilterMissed(false);
    (async () => {
      try {
        const subDef = getSubCategory(category, subCategoryId);
        const keywords = subDef?.keywords;
        const params = resolveChannelFetchParams(
          category,
          subCategoryId,
          country,
          showAll,
        );
        const results = await Promise.all(
          params.map((p) => fetchLiveChannels(p.mode, p.type, p.id)),
        );
        if (cancelled) return;
        // Normalize: the API omits array keys when empty — always materialize
        // both arrays so downstream code can never crash on missing keys.
        const seen = new Set<string>();
        let list = results
          .flat()
          .map((ch) => ({
            ...ch,
            stream_urls: ch.stream_urls ?? [],
            youtube_urls: ch.youtube_urls ?? [],
            languages: ch.languages ?? [],
          }))
          .filter(
            (ch) =>
              ch &&
              ((ch.stream_urls?.length ?? 0) > 0 ||
                (ch.youtube_urls?.length ?? 0) > 0),
          )
          .filter((ch) => {
            if (seen.has(ch.nanoid)) return false;
            seen.add(ch.nanoid);
            return true;
          });

        const catDef = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
        const isAudio = catDef?.family === "audio";

        // First paint FAST: if this isn't a pure category search, apply genre
        // keywords + curated + sorting on the BASE list and render it before
        // pulling in the heavy full iptv-org catalog (a 3.4MB / ~13k-channel
        // payload). The full index.m3u catalog merges in right after, so
        // search still covers every channel (VLC parity) — just not BEFORE
        // the first frame.
        const finish = (base: LiveChannel[]) => {
          // Genre keyword sub-classification (Movies → Action/Horror/...).
          if (keywords && keywords.length > 0) {
            const filtered = filterChannelsByKeywords(base, keywords);
            if (filtered.length > 0) {
              base = filtered;
              setKeywordFilterMissed(false);
            } else {
              setKeywordFilterMissed(true);
            }
          }

          // Prepend curated known-good channels (guaranteed-playable) so the
          // player always has a reliable auto-select target. For keyword subs
          // they only survive if they match the genre (else they'd pollute).
          const curated = getCuratedGoodChannels(!!isAudio, category);
          const seenIds = new Set(base.map((c) => c.nanoid));
          const curatedUnique = curated.filter((c) => !seenIds.has(c.nanoid));
          base = [...curatedUnique, ...base];

          // Sort: YouTube-backed first (most reliable playback), then alpha.
          list = [...base].sort((a, b) => {
            const ay = (a.youtube_urls?.length ?? 0) > 0 ? 0 : 1;
            const by = (b.youtube_urls?.length ?? 0) > 0 ? 0 : 1;
            if (ay !== by) return ay - by;
            return a.name.localeCompare(b.name);
          });

          setChannels(list);
          // Auto-select: keep the current channel if still present, else first.
          setActiveChannel((prev) =>
            prev && list.some((c) => c.nanoid === prev.nanoid)
              ? prev
              : (list[0] ?? null),
          );
        };

        finish(list);
        // Base list is on screen — drop the skeleton so the user sees
        // channels immediately; the full catalog merges in below.
        if (!cancelled) setChannelsLoading(false);

        // Merge the public-domain catalog (adds logos + extra channels) for
        // the video family only (it has no radio mode).
        // NOTE: fetch the FULL ~13k global iptv-org catalog (the ACTUAL index.m3u
        // master playlist VLC opens, via fmt=m3u) — NOT a per-country capped
        // slice. A per-country/limit slice silently drops any channel outside
        // the current country (e.g. "Zee One" is a UK channel — it would never
        // appear on the default US view, so searching "zee one" found nothing,
        // even though VLC finds it the instant a global playlist is loaded).
        // The client-side country label + search then operate over the whole
        // catalog exactly like the playlist.
        if (!isAudio) {
          try {
            const iptvCat = mapToIptvCategory(category);
            const iptv = await fetchIptvChannels("", iptvCat || "", 13500);
            if (!cancelled && iptv.length > 0) {
              const merged = mergeChannelsWithIptv(list, iptv);
              finish(merged);
            }
          } catch {
            /* iptv merge is best-effort */
          }
        }
        if (cancelled) return;
      } catch {
        if (!cancelled) {
          setChannels([]);
          setActiveChannel(null);
        }
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, subCategoryId, country, showAll]);

  // Search-filtered + paged channel list (matches name, country, alt names —
  // the same coverage VLC has over a network playlist). Debounced so typing
  // never re-scans the full catalog on every keystroke.
  const filteredChannels = useMemo(
    () => searchChannels(channels, debouncedSearch),
    [channels, debouncedSearch],
  );

  const visibleChannels = useMemo(
    () => filteredChannels.slice(0, gridLimit),
    [filteredChannels, gridLimit],
  );

  // ─── CHANNEL-PLAY ANALYTICS (cloud-backed popularity) ───────────────────
  useEffect(() => {
    if (!activeChannel || !user?.id) return;
    trackChannelPlay(activeChannel, category).catch(() => {});
  }, [activeChannel, category, user?.id]);

  // ─── CLOUD LOAD: favorites + history + reminders ──────────────────────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      try {
        const [favData, histData, remData] = await Promise.all([
          cloudStorageService.get<LiveFeedFavorite[]>(LIVE_FEED_FAVORITES_KEY),
          cloudStorageService.get<LiveFeedHistoryEntry[]>(
            LIVE_FEED_HISTORY_KEY,
          ),
          loadReminders(),
        ]);
        if (!cancelled) {
          if (Array.isArray(favData)) setFavorites(favData);
          if (Array.isArray(histData)) setHistory(histData);
          setReminders(remData);
        }
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

  // ─── HISTORY TRACKING (debounced) ──────────────────────────────────────
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!cloudLoadCompleteRef.current || !user?.id) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      const catDef = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
      if (!catDef) return;
      const subDef = catDef.subCategories.find((s) => s.id === subCategoryId);
      const countryName =
        ALL_COUNTRIES.find((c) => c.code === country)?.name || undefined;
      const entry: LiveFeedHistoryEntry = {
        category,
        categoryLabel: catDef.label,
        subCategoryId: subDef?.id,
        subCategoryLabel: subDef?.label,
        country,
        countryName,
        viewedAt: Date.now(),
      };
      setHistory((prev) => {
        const filtered = prev.filter(
          (h) =>
            !(
              h.category === entry.category &&
              h.subCategoryId === entry.subCategoryId &&
              h.country === entry.country
            ),
        );
        const next = [entry, ...filtered].slice(0, HISTORY_MAX);
        cloudStorageService.set(LIVE_FEED_HISTORY_KEY, next).catch(() => {});
        return next;
      });
    }, 3000);
    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [category, subCategoryId, country, user?.id]);

  // ─── FAVORITED? (current combo is in favorites) ───────────────────────
  useEffect(() => {
    const exists = favorites.some(
      (f) =>
        f.category === category &&
        f.subCategoryId === subCategoryId &&
        f.country === country,
    );
    setIsFavorited(exists);
  }, [favorites, category, subCategoryId, country]);

  // ─── HANDLERS ──────────────────────────────────────────────────────────
  const handleCategoryChange = (newCat: LiveCategory) => {
    setCategory(newCat);
    const newCatDef = LIVE_FEED_CATEGORIES.find((c) => c.id === newCat);
    const hasAll = newCatDef?.subCategories.some((s) => s.id === "all");
    setSubCategoryId(hasAll ? "all" : newCatDef?.subCategories[0]?.id || "all");
  };

  const toggleFavorite = () => {
    if (!cloudLoadCompleteRef.current || !user?.id) return;
    const catDef = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
    if (!catDef) return;
    const subDef = catDef.subCategories.find((s) => s.id === subCategoryId);
    const countryName =
      ALL_COUNTRIES.find((c) => c.code === country)?.name || undefined;
    const favId = `${category}-${subDef?.id || "all"}-${country || "all"}`;
    setFavorites((prev) => {
      const exists = prev.find(
        (f) =>
          f.category === category &&
          f.subCategoryId === subDef?.id &&
          f.country === country,
      );
      let next: LiveFeedFavorite[];
      if (exists) {
        next = prev.filter((f) => f.id !== exists.id);
      } else {
        next = [
          {
            id: favId,
            category,
            categoryLabel: catDef.label,
            subCategoryId: subDef?.id,
            subCategoryLabel: subDef?.label,
            country,
            countryName,
            createdAt: Date.now(),
          },
          ...prev,
        ];
      }
      cloudStorageService.set(LIVE_FEED_FAVORITES_KEY, next).catch(() => {});
      return next;
    });
  };

  const surpriseMe = () => {
    const { category: randCat, subCategory: randSub } =
      getRandomLiveFeedCombo();
    if (family === "video" || family === "audio") {
      const catDef = LIVE_FEED_CATEGORIES.find((c) => c.id === randCat);
      if (catDef && catDef.family !== family) {
        const familyCats = LIVE_FEED_CATEGORIES.filter(
          (c) => c.family === family && c.id !== "tv" && c.id !== "radio",
        );
        if (familyCats.length > 0) {
          const fc = familyCats[Math.floor(Math.random() * familyCats.length)];
          const fSubs = fc.subCategories.filter((s) => s.id !== "all");
          const fSub =
            fSubs.length > 0
              ? fSubs[Math.floor(Math.random() * fSubs.length)]
              : fc.subCategories[0];
          setCategory(fc.id);
          setSubCategoryId(fSub.id);
          return;
        }
      }
    }
    setCategory(randCat);
    setSubCategoryId(randSub.id);
  };

  const loadFavorite = (fav: LiveFeedFavorite) => {
    setCategory(fav.category);
    setSubCategoryId(fav.subCategoryId || "all");
    setCountry(fav.country);
    setShowAll(false);
    setShowFavoritesPanel(false);
  };

  const selectChannel = useCallback((ch: LiveChannel) => {
    setActiveChannel(ch);
  }, []);

  const nextChannel = useCallback(() => {
    if (!activeChannel || filteredChannels.length === 0) return;
    const idx = filteredChannels.findIndex(
      (c) => c.nanoid === activeChannel.nanoid,
    );
    const next = filteredChannels[(idx + 1) % filteredChannels.length];
    if (next) setActiveChannel(next);
  }, [activeChannel, filteredChannels]);

  // When the user enables subtitles on a stream with NO embedded tracks,
  // auto-advance to a channel that DOES carry captions (YouTube embeds always
  // can via cc_load_policy; HLS channels with a subtitle track). This keeps
  // the CC toggle from landing on a dead "no subtitles" state.
  const advanceToCaptionedChannel = useCallback(() => {
    if (!activeChannel || filteredChannels.length === 0) return;
    const start = filteredChannels.findIndex(
      (c) => c.nanoid === activeChannel.nanoid,
    );
    for (let i = 1; i < filteredChannels.length; i++) {
      const cand = filteredChannels[(start + i) % filteredChannels.length];
      const hasYt = (cand.youtube_urls?.length || 0) > 0;
      // HLS channels may carry embedded subtitle tracks — try them too.
      if (hasYt || (cand.stream_urls?.length || 0) > 0) {
        setActiveChannel(cand);
        return;
      }
    }
  }, [activeChannel, filteredChannels]);

  // ─── EPG / REMINDERS CRUD ───────────────────────────────────────────────
  const openReminderModal = () => {
    setReminderForm({
      label: "",
      time: "20:00",
      recurrence: "once",
      weekday: 1,
    });
    setShowReminderModal(true);
  };

  const closeReminderModal = () => setShowReminderModal(false);

  const saveReminderFromModal = () => {
    const [hhStr, mmStr] = reminderForm.time.split(":");
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr, 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59)
      return;
    const catDef = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
    if (!catDef) return;
    const subDef = catDef.subCategories.find((s) => s.id === subCategoryId);
    const countryName =
      ALL_COUNTRIES.find((c) => c.code === country)?.name || undefined;
    const reminder: LiveFeedReminder = {
      id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelId: `${category}-${subDef?.id || "all"}-${country || "all"}`,
      channelName: `${catDef.label}${subDef ? " · " + subDef.label : ""}${
        countryName ? " · " + countryName : ""
      }`,
      country,
      category,
      label:
        reminderForm.label.trim() ||
        `${catDef.label}${subDef ? " · " + subDef.label : ""} reminder`,
      minuteOfDay: hh * 60 + mm,
      recurrence: reminderForm.recurrence,
      weekday: reminderForm.weekday,
      createdAt: Date.now(),
    };
    setReminders((prev) => {
      const next = [...prev, reminder].sort(
        (a, b) => a.minuteOfDay - b.minuteOfDay,
      );
      saveReminders(next).catch(() => {});
      return next;
    });
    setShowReminderModal(false);
    setShowRemindersPanel(true);
  };

  const deleteReminder = (id: string) => {
    setReminders((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveReminders(next).catch(() => {});
      return next;
    });
  };

  // ─── FULLSCREEN ─────────────────────────────────────────────────────────
  // Fullscreen the WHOLE Live TV/Radio panel (player + grid + filters), not
  // just the player container — so the user can switch channels while in
  // fullscreen. Uses the native Fullscreen API (works in browser + app).
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
      return;
    }
    const el = rootRef.current || playerContainerRef.current;
    if (!el) return;
    el.requestFullscreen?.().catch(() => {
      // Fallback for older browsers
      const anyEl = el as unknown as Record<string, () => void>;
      (
        anyEl.webkitRequestFullscreen ||
        anyEl.mozRequestFullScreen ||
        anyEl.msRequestFullscreen
      )?.call(el);
    });
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const accentBg =
    accent === "purple" ? "bg-purple-500 text-white" : "bg-blue-500 text-white";

  // ─── RESPONSIVE PLAYER HEIGHT ────────────────────────────────────────────
  // Fixed pixel heights break across devices: 480px is way too tall on a
  // 375px phone and a thin strip on a 1920px TV. Use a true 16:9 aspect ratio
  // so the player scales with the container width (phone → TV), clamped to a
  // sensible min/max. Radio uses a shorter 4:3-ish box (audio has no video).
  // Fullscreen always fills the viewport.
  const aspectBox = isRadio ? "pb-[60%] sm:pb-[45%]" : "pb-[56.25%]";
  const playerHeightStyle: React.CSSProperties = isFullscreen
    ? { height: "100%" }
    : compact
      ? {}
      : { minHeight: 260, maxHeight: 560 };

  // ─── RENDER ─────────────────────────────────────────────────────────────
  const embedContent = (
    <>
      {/* Header: category + country filter + feature toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex items-center gap-2 min-w-0">
          {isRadio ? (
            <Radio
              size={16}
              className="text-purple-600 dark:text-purple-400 flex-shrink-0"
            />
          ) : (
            <Tv
              size={16}
              className="text-blue-600 dark:text-blue-400 flex-shrink-0"
            />
          )}
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {activeCat?.label || "Live Channels"}
          </h3>
          <span className="text-[10px] bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            LIVE
          </span>
          {channels.length > 0 && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 hidden sm:inline">
              {channels.length} {isRadio ? "stations" : "channels"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showFeatureToolbar && (
            <>
              <button
                onClick={surpriseMe}
                title="Surprise me with a random channel"
                className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0 ${
                  accent === "purple"
                    ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60"
                    : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60"
                }`}
              >
                <Shuffle size={10} /> Surprise
              </button>
              <button
                onClick={toggleFavorite}
                title={
                  isFavorited ? "Remove from favorites" : "Add to favorites"
                }
                className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0 ${
                  isFavorited
                    ? "bg-red-500 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                <Heart
                  size={10}
                  className={isFavorited ? "fill-current" : ""}
                />
                {favorites.length > 0 ? favorites.length : ""}
              </button>
              {favorites.length > 0 && (
                <button
                  onClick={() => setShowFavoritesPanel((v) => !v)}
                  title="View favorites & history"
                  className="text-[10px] px-2 py-1 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <Clock size={10} /> Recent
                </button>
              )}
              <button
                onClick={() => {
                  setShowRemindersPanel((v) => !v);
                  setShowFavoritesPanel(false);
                }}
                title="Watch reminders & schedule"
                className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0 ${
                  showRemindersPanel
                    ? "bg-amber-500 text-white"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                <Bell size={10} /> Reminders
                {reminders.length > 0 && (
                  <span className="ml-0.5">{reminders.length}</span>
                )}
              </button>
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                aria-label={
                  isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
                }
                className={`text-[10px] px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0 font-medium ${
                  isFullscreen
                    ? "bg-blue-600 text-white"
                    : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60"
                }`}
              >
                {isFullscreen ? (
                  <Minimize2 size={12} />
                ) : (
                  <Maximize2 size={12} />
                )}
                <span className="hidden xs:inline">
                  {isFullscreen ? "Exit" : "Fullscreen"}
                </span>
              </button>
            </>
          )}
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setShowAll(false);
            }}
            className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[140px]"
            aria-label="Select country"
          >
            <option value="">🌍 All Countries</option>
            {ALL_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowAll((v) => !v)}
            className={`text-[10px] px-2 py-1 rounded-lg transition-colors flex items-center gap-1 flex-shrink-0 ${
              showAll
                ? accentBg
                : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
            title="Show channels from all countries"
          >
            <Grid3x3 size={10} /> {showAll ? "Global" : "Show All"}
          </button>
        </div>
      </div>

      {/* Dropdown filters: Category + Sub-category + Station search */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-200 dark:border-gray-700">
        {showCategorySwitcher && availableCategories.length > 1 && (
          <label className="flex items-center gap-1.5 flex-shrink-0">
            <Layers size={12} className="text-gray-400 flex-shrink-0" />
            <select
              value={category}
              onChange={(e) =>
                handleCategoryChange(e.target.value as LiveCategory)
              }
              className="text-xs font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 pr-7 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
              aria-label="Select category"
            >
              {availableCategories.map((cat) => (
                <option key={cat.id} value={cat.id} title={cat.description}>
                  {cat.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {showSubCategorySwitcher &&
          activeCat &&
          activeCat.subCategories.length > 1 && (
            <label className="flex items-center gap-1.5 flex-shrink-0">
              <Tag size={12} className="text-gray-400 flex-shrink-0" />
              <select
                value={subCategoryId}
                onChange={(e) => setSubCategoryId(e.target.value)}
                className="text-xs font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 pr-7 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                aria-label="Select sub-category"
              >
                {activeCat.subCategories.map((sub) => (
                  <option key={sub.id} value={sub.id} title={sub.description}>
                    {sub.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        {/* Station search — filters the grid (10+ items rule) */}
        <label className="flex items-center gap-1 flex-shrink-0 relative">
          <Search
            size={11}
            className="absolute left-1.5 text-gray-400 pointer-events-none"
          />
          <input
            type="text"
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            placeholder={
              channelsLoading
                ? "Loading…"
                : `Search ${channels.length} ${isRadio ? "stations" : "channels"}…`
            }
            className="text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-6 pr-2 py-1 w-40 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Search channels"
          />
        </label>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto flex-shrink-0">
          {showAll
            ? "Global"
            : country
              ? countryName(country)
              : "All countries"}
        </span>
      </div>

      {/* Genre pills — native sub-category quick navigation */}
      {showSubCategorySwitcher &&
        activeCat &&
        activeCat.subCategories.length > 1 && (
          <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto bg-gray-50/30 dark:bg-gray-900/20 border-b border-gray-200 dark:border-gray-700">
            {activeCat.subCategories.map((sub) => (
              <button
                key={sub.id}
                onClick={() => setSubCategoryId(sub.id)}
                title={sub.description}
                className={`text-[10px] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors flex-shrink-0 ${
                  subCategoryId === sub.id
                    ? accentBg
                    : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500"
                }`}
              >
                {sub.label}
              </button>
            ))}
          </div>
        )}

      {/* Keyword-filter fallback notice */}
      {keywordFilterMissed && activeSubCategory && (
        <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            No {activeSubCategory.label} {isRadio ? "stations" : "channels"}{" "}
            live right now — showing all {activeCat?.label}.
          </p>
        </div>
      )}

      {/* Favorites + History panel */}
      {showFavoritesPanel && (
        <div className="px-3 py-3 bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-200 dark:border-gray-700 space-y-3">
          {favorites.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1">
                <Heart size={11} className="text-red-500" /> Favorites
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {favorites.map((fav) => (
                  <button
                    key={fav.id}
                    onClick={() => loadFavorite(fav)}
                    className="text-[10px] px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                  >
                    {fav.categoryLabel}
                    {fav.subCategoryLabel ? ` · ${fav.subCategoryLabel}` : ""}
                    {fav.countryName ? ` · ${fav.countryName}` : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1">
                <Clock size={11} className="text-blue-500" /> Recently Watched
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {history.slice(0, 8).map((h, idx) => (
                  <button
                    key={`${h.category}-${h.subCategoryId}-${h.country}-${idx}`}
                    onClick={() =>
                      loadFavorite({
                        id: `hist-${idx}`,
                        category: h.category,
                        categoryLabel: h.categoryLabel,
                        subCategoryId: h.subCategoryId,
                        subCategoryLabel: h.subCategoryLabel,
                        country: h.country,
                        countryName: h.countryName,
                        createdAt: 0,
                      })
                    }
                    className="text-[10px] px-2 py-1 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                  >
                    {h.categoryLabel}
                    {h.subCategoryLabel ? ` · ${h.subCategoryLabel}` : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
          {favorites.length === 0 && history.length === 0 && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center py-2">
              No favorites or history yet. Use the ♥ button to bookmark
              channels, or browse to build your history.
            </p>
          )}
        </div>
      )}

      {/* Reminders panel */}
      {showRemindersPanel && (
        <div className="px-3 py-3 bg-gray-50/50 dark:bg-gray-900/30 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
              <Bell size={11} className="text-amber-500" /> Watch Reminders
            </h4>
            <button
              onClick={openReminderModal}
              className="text-[10px] px-2 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1"
            >
              <Calendar size={10} /> New
            </button>
          </div>
          {reminders.length > 0 ? (
            <div className="space-y-1 max-h-[260px] overflow-y-auto">
              {reminders.map((r) => {
                const next = nextReminderTime(r);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                        {r.label}
                      </p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400">
                        {formatMinuteOfDay(r.minuteOfDay)} ·{" "}
                        {r.recurrence === "once"
                          ? "Once"
                          : r.recurrence === "daily"
                            ? "Daily"
                            : `Weekly (${WEEKDAYS[(r.weekday || 1) - 1]})`}{" "}
                        · {next ? formatRelativeTime(next) : "—"}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteReminder(r.id)}
                      className="text-gray-400 hover:text-red-500 p-1"
                      title="Delete reminder"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center py-2">
              No reminders set. Click "New" to schedule a watch reminder.
            </p>
          )}
        </div>
      )}

      {/* Reminder modal */}
      {showReminderModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 max-w-md w-full">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Bell size={14} className="text-amber-500" /> Set Watch Reminder
              </h3>
              <button
                onClick={closeReminderModal}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300 block mb-1">
                  Label
                </label>
                <input
                  type="text"
                  value={reminderForm.label}
                  onChange={(e) =>
                    setReminderForm((f) => ({ ...f, label: e.target.value }))
                  }
                  placeholder="e.g. Evening News"
                  className="w-full text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300 block mb-1">
                  Time
                </label>
                <input
                  type="time"
                  value={reminderForm.time}
                  onChange={(e) =>
                    setReminderForm((f) => ({ ...f, time: e.target.value }))
                  }
                  className="w-full text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300 block mb-1">
                  Repeat
                </label>
                <select
                  value={reminderForm.recurrence}
                  onChange={(e) =>
                    setReminderForm((f) => ({
                      ...f,
                      recurrence: e.target.value as ReminderRecurrence,
                    }))
                  }
                  className="w-full text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="once">Once</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                </select>
              </div>
              {reminderForm.recurrence === "weekly" && (
                <div>
                  <label className="text-[11px] font-medium text-gray-600 dark:text-gray-300 block mb-1">
                    Day of week
                  </label>
                  <select
                    value={reminderForm.weekday}
                    onChange={(e) =>
                      setReminderForm((f) => ({
                        ...f,
                        weekday: parseInt(e.target.value, 10),
                      }))
                    }
                    className="w-full text-xs px-2 py-1.5 rounded-lg bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {WEEKDAYS.map((label, idx) => (
                      <option key={idx} value={idx + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={closeReminderModal}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={saveReminderFromModal}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 flex items-center gap-1"
              >
                <Bell size={11} /> Set Reminder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NATIVE PLAYER — plays the active channel (responsive 16:9; radio uses
          a shorter box). Scales with container width on every device:
          phone → tablet → laptop → TV. */}
      <div
        ref={playerContainerRef}
        className={`relative w-full bg-black overflow-hidden ${isFullscreen ? "h-full" : ""}`}
        style={playerHeightStyle}
      >
        {/* Aspect-ratio spacer keeps the box 16:9 (or shorter for radio) when
            NOT in fullscreen — the inner player fills it absolutely. */}
        {!isFullscreen && <div className={`${aspectBox} w-full`} />}
        {channelsLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-20 bg-black">
            <div className="text-center">
              <Loader2
                size={32}
                className="text-blue-500 animate-spin mx-auto mb-2"
              />
              <p className="text-xs text-gray-400">Loading live channels…</p>
            </div>
          </div>
        )}
        {!channelsLoading && !activeChannel && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-black">
            <div className="text-center space-y-2 px-4">
              <Monitor size={28} className="text-gray-600 mx-auto" />
              <p className="text-xs text-gray-400">
                No live {isRadio ? "stations" : "channels"} found for this
                selection. Try another category, sub-category, or country.
              </p>
            </div>
          </div>
        )}
        {!channelsLoading && activeChannel && (
          <ChannelPlayer
            key={activeChannel.nanoid}
            channel={activeChannel}
            isAudio={!!isRadio}
            accent={accent}
            onNext={nextChannel}
            onToggleFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
            onCaptionFallback={advanceToCaptionedChannel}
          />
        )}
      </div>

      {/* NATIVE CHANNEL GRID */}
      <div className="px-3 py-3 bg-gray-50/30 dark:bg-gray-900/20 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <Signal size={11} className="text-green-500" />
            {isRadio ? "All Stations" : "All Channels"}
            {filteredChannels.length > 0 && (
              <span className="text-gray-400 dark:text-gray-500 font-normal">
                ({filteredChannels.length})
              </span>
            )}
          </h4>
          {channelSearch && (
            <button
              onClick={() => setChannelSearch("")}
              className="text-[10px] text-blue-500 hover:text-blue-600"
            >
              Clear search
            </button>
          )}
        </div>
        {channelsLoading ? (
          <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-xl bg-gray-200 dark:bg-gray-700/50 animate-pulse"
              />
            ))}
          </div>
        ) : visibleChannels.length > 0 ? (
          <>
            {/* Channel grid adapts to the device aspect ratio:
                phone 2-col → small phone 3-col → tablet 4-col →
                laptop 6-col → desktop 8-col → TV/4K 10-col. */}
            <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
              {visibleChannels.map((ch) => (
                <ChannelCard
                  key={ch.nanoid}
                  channel={ch}
                  isActive={activeChannel?.nanoid === ch.nanoid}
                  isAudio={!!isRadio}
                  onSelect={() => selectChannel(ch)}
                />
              ))}
            </div>
            {filteredChannels.length > gridLimit && (
              <div className="flex justify-center mt-3">
                <button
                  onClick={() => setGridLimit((l) => l + GRID_PAGE)}
                  className="text-xs px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                >
                  Load more ({filteredChannels.length - gridLimit} remaining)
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 text-center py-4">
            {channelSearch
              ? `No ${isRadio ? "stations" : "channels"} match "${channelSearch}".`
              : `No live ${isRadio ? "stations" : "channels"} available for this selection.`}
          </p>
        )}
      </div>

      {/* Footer — active combo label (+ active channel) */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50/50 dark:bg-gray-900/30 border-t border-gray-200 dark:border-gray-700">
        <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
          <Sparkles size={10} className="inline mr-1 text-blue-400" />
          {activeCat?.label}
          {activeSubCategory && activeSubCategory.id !== "all"
            ? ` · ${activeSubCategory.label}`
            : ""}
          {showAll
            ? " · Global"
            : country
              ? ` · ${countryName(country)}`
              : " · All countries"}
          {activeChannel ? ` · ▶ ${activeChannel.name}` : ""}
        </span>
        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 flex items-center gap-1">
          <Globe size={9} />
          Live sync{cloudLoadCompleteRef.current ? " ✓" : "…"}
        </span>
      </div>
    </>
  );

  if (isFullscreen) {
    // Fullscreen mode: player fills the viewport top-to-bottom; the channel
    // grid + filters scroll beneath it so the user can switch channels while
    // staying in fullscreen. Exit via the X button (top-right) OR the browser
    // Esc key (fullscreenchange listener resets isFullscreen).
    return (
      <div ref={rootRef} className="fixed inset-0 z-50 bg-black flex flex-col">
        <div className="flex items-center justify-between p-2 bg-gray-900 border-b border-gray-800">
          <div className="flex items-center gap-2 text-white min-w-0">
            <Sparkles size={14} className="text-blue-400 flex-shrink-0" />
            <span className="text-xs font-semibold truncate">
              {isRadio ? "Live Radio" : "Live TV"} — Fullscreen
              {activeChannel ? ` · ${activeChannel.name}` : ""}
            </span>
          </div>
          <button
            onClick={() => setIsFullscreen(false)}
            aria-label="Exit fullscreen"
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
          {embedContent}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
    >
      {embedContent}
    </div>
  );
}
