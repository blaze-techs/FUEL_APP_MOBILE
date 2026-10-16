/**
 * Player Settings — the Reezn "Preferences" surface.
 *
 * Every option here maps onto a preference the app ALREADY honours, so there is
 * never a second source of truth:
 *   - "Auto next episode" is the same `movie_auto_next` key MoviesEmbed reads
 *     and writes for its AUTO ON/OFF control.
 *   - "Preferred caption language" is the same `live_feed_subtitle_lang` key
 *     the Live TV / Live Radio caption engine uses to pick and translate
 *     subtitles.
 *   - "Autoplay live streams" is the same `live_feed_autoplay` key LiveFeedEmbed
 *     uses to decide whether a selected channel starts playing immediately.
 *
 * Changing a value here therefore takes effect in the Movies, Live TV and Live
 * Radio sub-tabs immediately, on every device (cloud-scoped per account).
 */
import { useEffect, useState } from "react";
import {
  Captions,
  Cloud,
  Gauge,
  MonitorPlay,
  PlayCircle,
  RefreshCw,
  Server,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/react-app/context/AuthContext";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import {
  SUBTITLE_LANGUAGES,
  detectPreferredSubtitleLang,
} from "@/react-app/lib/subtitle-languages";
import { toastSuccess } from "@/react-app/lib/toast";

/** Keys shared with the players — do not rename without updating them. */
const AUTO_NEXT_KEY = "movie_auto_next";
const CAPTION_LANG_KEY = "live_feed_subtitle_lang";
const AUTOPLAY_KEY = "live_feed_autoplay";
const DATA_SAVER_KEY = "movie_data_saver";

interface ToggleRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className="w-full flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-left hover:border-amber-400/60 transition-colors"
    >
      <span className="mt-0.5 text-amber-600 dark:text-amber-400">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
          {title}
        </span>
        <span className="block text-[11px] text-gray-500 dark:text-gray-400">
          {description}
        </span>
      </span>
      <span
        className={`shrink-0 mt-1 h-5 w-9 rounded-full transition-colors ${checked ? "bg-amber-500" : "bg-gray-300 dark:bg-gray-600"}`}
      >
        <span
          className={`block h-4 w-4 mt-0.5 rounded-full bg-white transition-transform ${checked ? "translate-x-4.5 ml-4" : "ml-0.5"}`}
        />
      </span>
    </button>
  );
}

export default function PlayerSettingsPanel() {
  const { user } = useAuth();
  const [autoNext, setAutoNext] = useState(true);
  const [autoplay, setAutoplay] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [captionLang, setCaptionLang] = useState("en");
  const [loaded, setLoaded] = useState(false);

  // Load the SHARED keys so this panel always shows the players' real values.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const [an, ap, ds, lang] = await Promise.all([
          cloudStorageService.get<boolean>(AUTO_NEXT_KEY),
          cloudStorageService.get<boolean>(AUTOPLAY_KEY),
          cloudStorageService.get<boolean>(DATA_SAVER_KEY),
          cloudStorageService.get<string>(CAPTION_LANG_KEY),
        ]);
        if (cancelled) return;
        if (typeof an === "boolean") setAutoNext(an);
        if (typeof ap === "boolean") setAutoplay(ap);
        if (typeof ds === "boolean") setDataSaver(ds);
        setCaptionLang(
          typeof lang === "string" && lang
            ? lang
            : detectPreferredSubtitleLang(),
        );
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const save = <T,>(key: string, value: T, label: string) => {
    void cloudStorageService.set(key, value).catch(() => {});
    toastSuccess(label);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
        <MonitorPlay
          size={20}
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Player Settings
          </h3>
          <p className="text-[11px] text-gray-600 dark:text-gray-300">
            These controls drive the Movies, Live TV and Live Radio players.
            They are stored on your account, so they follow you to every device.
          </p>
        </div>
        <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
          <Cloud size={11} /> {loaded ? "Synced" : "Loading…"}
        </span>
      </div>

      <div className="space-y-2">
        <ToggleRow
          icon={<SkipForward size={16} />}
          title="Auto next episode"
          description="Play the next episode automatically when one finishes (series only)."
          checked={autoNext}
          onChange={(next) => {
            setAutoNext(next);
            save(AUTO_NEXT_KEY, next, `Auto next ${next ? "on" : "off"}`);
          }}
        />
        <ToggleRow
          icon={<PlayCircle size={16} />}
          title="Autoplay live streams"
          description="Start playing a live channel as soon as you pick it."
          checked={autoplay}
          onChange={(next) => {
            setAutoplay(next);
            save(AUTOPLAY_KEY, next, `Autoplay ${next ? "on" : "off"}`);
          }}
        />
        <ToggleRow
          icon={<Gauge size={16} />}
          title="Data saver"
          description="Prefer lower-quality renditions when a stream offers a choice."
          checked={dataSaver}
          onChange={(next) => {
            setDataSaver(next);
            save(DATA_SAVER_KEY, next, `Data saver ${next ? "on" : "off"}`);
          }}
        />
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
          <Captions size={16} className="text-amber-600 dark:text-amber-400" />
          Preferred caption language
        </label>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          Used by the Movies and Live TV / Live Radio players. On streams with
          embedded subtitles the matching track is selected; otherwise live
          captions are translated on-device into this language.
        </p>
        <select
          value={captionLang}
          onChange={(e) => {
            setCaptionLang(e.target.value);
            save(
              CAPTION_LANG_KEY,
              e.target.value,
              `Caption language: ${e.target.value}`,
            );
          }}
          className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100"
        >
          {SUBTITLE_LANGUAGES.map((l) => (
            <option key={l.codes[0]} value={l.codes[0]}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InfoCard
          icon={<Server size={16} />}
          title="Stream sources"
          body="Each title is tried against the primary stream servers first, then same-origin relays, then verified mirror embeds. A failing source is skipped automatically."
        />
        <InfoCard
          icon={<Sparkles size={16} />}
          title="Ad-free playback"
          body="Players run behind the in-app popup and redirect shield, so embedded providers cannot open tabs or hijack the page."
        />
        <InfoCard
          icon={<RefreshCw size={16} />}
          title="Resume where you left off"
          body="Titles you open are recorded in Continue Watching, newest first, and stay in sync across your devices."
        />
        <InfoCard
          icon={<MonitorPlay size={16} />}
          title="Picture in picture"
          body="Supported streams can be popped out with the player's PiP control while you keep using the app."
        />
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
        <span className="text-amber-600 dark:text-amber-400">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        {body}
      </p>
    </div>
  );
}
