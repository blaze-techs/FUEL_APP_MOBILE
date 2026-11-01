/**
 * LiveCaptionOverlay — the caption display shared by every player.
 *
 * One component so Live TV, Live Radio and Movies render captions identically:
 * a bottom-centre YouTube-style caption block with the language the engine
 * locked onto, plus the loading / listening / unavailable / error states. The
 * language badge is the part that matters for trust — it tells the user what
 * the transcriber decided, so a wrong language is visible rather than looking
 * like a bad transcript.
 */

import { Loader2 } from "lucide-react";
import type { CaptionStatus } from "@/react-app/lib/live-caption-engine";
import type { CaptionLanguageState } from "@/react-app/hooks/useLiveCaptions";

export interface LiveCaptionOverlayProps {
  status: CaptionStatus;
  text: string;
  detail: string;
  language: CaptionLanguageState;
}

export function LiveCaptionOverlay({
  status,
  text,
  detail,
  language,
}: LiveCaptionOverlayProps) {
  return (
    <div className="absolute bottom-4 left-0 right-0 flex flex-col items-center gap-1.5 pointer-events-none z-20 px-4">
      {status === "loading-model" && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm">
          <Loader2 size={12} className="animate-spin text-purple-400" />
          <span className="text-[10px] text-gray-200">
            Loading on-device caption model (first use downloads ~31 MB)…
          </span>
        </div>
      )}
      {status === "listening" && text && (
        <div className="max-w-[90%] px-4 py-2 rounded-lg bg-black/70 backdrop-blur-sm text-center">
          <p className="text-sm md:text-base font-medium text-white leading-snug">
            {text}
          </p>
          <span className="block mt-1 text-[8px] uppercase tracking-wider text-purple-300/80">
            AI live captions
            {language.label && (
              <>
                {" · "}
                {language.source === "detected" ? "" : "assumed "}
                {language.label}
              </>
            )}
          </span>
        </div>
      )}
      {status === "listening" && !text && (
        <div className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm">
          <span className="text-[10px] text-gray-300">
            Listening — captions appear as speech is detected…
          </span>
        </div>
      )}
      {status === "unavailable" && (
        <div className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm">
          <span className="text-[10px] text-amber-300">
            {detail || "Live captions are not available for this stream."}
          </span>
        </div>
      )}
      {status === "error" && (
        <div className="px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur-sm">
          <span className="text-[10px] text-red-300">
            {detail || "Caption generation failed."}
          </span>
        </div>
      )}
    </div>
  );
}
