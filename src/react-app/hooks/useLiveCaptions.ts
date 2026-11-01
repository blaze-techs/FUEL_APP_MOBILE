/**
 * useLiveCaptions — the one caption lifecycle shared by every media surface.
 *
 * Live TV, Live Radio and Movies all play through this hook, so "captions work
 * on any stream" is a single code path rather than three that drift. It owns
 * the on-device engine's start/stop, the status + language state the UI
 * renders, and the preferred-language choice (cloud-synced so it follows the
 * user across devices).
 *
 * The heavy lifting is in `live-caption-engine.ts`; this hook is deliberately
 * thin so the only thing that can differ between surfaces is which element is
 * being captioned.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  liveCaptionEngine,
  type CaptionStatus,
} from "@/react-app/lib/live-caption-engine";
import { cloudStorageService } from "@/react-app/lib/cloud-storage-service";

export interface CaptionLanguageState {
  code: string;
  label: string;
  source: "detected" | "hinted" | "country" | "none";
}

const EMPTY_LANGUAGE: CaptionLanguageState = {
  code: "",
  label: "",
  source: "none",
};

export const CAPTION_LANG_KEY = "live_feed_subtitle_lang";

export interface UseLiveCaptionsOptions {
  /** The element to caption. A ref so the hook re-reads it on each start. */
  mediaRef: React.RefObject<HTMLMediaElement | null>;
  /** The stream's ISO-2 country — a PREFERENCE for language detection. */
  country?: string;
  /** Identity of the current stream. Changing it stops the engine, so a
   *  channel/episode switch never keeps captioning the previous audio. */
  streamKey?: string;
}

export interface UseLiveCaptionsResult {
  on: boolean;
  status: CaptionStatus;
  detail: string;
  text: string;
  language: CaptionLanguageState;
  /** Display language: "auto" (detect) or an ISO code. */
  preferredLang: string;
  /** Whether the current stream is the kind the engine can capture. */
  toggle: () => void;
  start: () => void;
  stop: () => void;
  setPreferredLang: (lang: string) => void;
}

export function useLiveCaptions(
  opts: UseLiveCaptionsOptions,
): UseLiveCaptionsResult {
  const { mediaRef, country, streamKey } = opts;
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<CaptionStatus>("idle");
  const [detail, setDetail] = useState("");
  const [text, setText] = useState("");
  const [language, setLanguage] =
    useState<CaptionLanguageState>(EMPTY_LANGUAGE);
  // Default to AUTO: detect the spoken language and caption in it. That is the
  // whole point of the on-device pipeline; a specific code forces translation.
  const [preferredLang, setPreferredLangState] = useState<string>(() => {
    const cached = cloudStorageService.getCached<string>(CAPTION_LANG_KEY);
    return cached || "auto";
  });

  // Refs so the engine callbacks never capture a stale render.
  const preferredRef = useRef(preferredLang);
  preferredRef.current = preferredLang;
  const countryRef = useRef(country);
  countryRef.current = country;

  const start = useCallback(() => {
    const el = mediaRef.current;
    if (!el) {
      setStatus("unavailable");
      setDetail("No playing media to caption yet — press play first.");
      return;
    }
    // captureStream() only yields real audio when the element is CORS-enabled;
    // without it the browser hands back silence and captions would be empty.
    if (!el.crossOrigin) el.crossOrigin = "anonymous";
    setStatus("loading-model");
    setDetail("");
    void liveCaptionEngine.start(
      el,
      (t) => setText(t),
      (s, d) => {
        setStatus(s);
        setDetail(d || "");
      },
      preferredRef.current,
      countryRef.current || "",
      (info) => setLanguage(info),
    );
  }, [mediaRef]);

  const stop = useCallback(() => {
    liveCaptionEngine.stop();
    setStatus("idle");
    setText("");
    setDetail("");
    setLanguage(EMPTY_LANGUAGE);
  }, []);

  const toggle = useCallback(() => {
    setOn((prev) => {
      const next = !prev;
      if (next) start();
      else stop();
      return next;
    });
  }, [start, stop]);

  const setPreferredLang = useCallback(
    (lang: string) => {
      setPreferredLangState(lang);
      preferredRef.current = lang;
      cloudStorageService.set(CAPTION_LANG_KEY, lang).catch(() => {});
      // Apply immediately to a running engine rather than waiting for a
      // restart: changing the display language should not require re-toggling.
      if (on) {
        stop();
        start();
      }
    },
    [on, start, stop],
  );

  // A stream change invalidates the audio, so the engine must stop. Leaving it
  // running would caption the PREVIOUS channel's audio over the new picture.
  useEffect(() => {
    return () => {
      liveCaptionEngine.stop();
    };
  }, [streamKey]);

  useEffect(() => {
    if (on) {
      setOn(false);
      stop();
    }
    // Only react to the stream identity changing; `on`/`stop` are read at that
    // moment on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

  return {
    on,
    status,
    detail,
    text,
    language,
    preferredLang,
    toggle,
    start,
    stop,
    setPreferredLang,
  };
}
