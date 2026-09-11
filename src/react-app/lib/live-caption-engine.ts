/**
 * live-caption-engine.ts — on-device live caption generation + translation
 * for streams that carry NO embedded subtitle tracks.
 *
 * Fully free, no API keys, no server: captures the playing media element's
 * audio (captureStream → AudioContext → 16 kHz PCM windows) and transcribes
 * it locally with OpenAI Whisper (MULTILINGUAL `whisper-tiny` — auto-detects
 * the spoken language) running in-browser via Transformers.js (WASM). Works
 * on HLS video AND live radio <audio> — any HTMLMediaElement — so EVERY
 * stream can show live captions on demand.
 *
 * TRANSLATION: when a preferred caption language differs from English, the
 * English transcript is further translated ON-DEVICE via a MarianMT/opus-mt
 * translation model (Helsinki-NLP) — so captions appear in the user's
 * preferred language even when the stream has no captions at all.
 *
 * Requirements for audio capture: the media element must serve its content
 * with CORS (crossOrigin="anonymous"); otherwise the browser mutes the
 * captured audio (captions then show a clear "unavailable" state instead of
 * garbage).
 *
 * The Whisper model (~31 MB quantized) + the translation model (~80 MB,
 * loaded ONLY when a non-English preferred language is picked) lazy-load on
 * FIRST use and are cached by the browser thereafter. Generation runs on a
 * rolling ~4 s window so captions appear continuously while the stream plays.
 */

export type CaptionCallback = (text: string, isFinal: boolean) => void;

export type CaptionStatus =
  "idle" | "loading-model" | "listening" | "unavailable" | "error";

export type CaptionStatusCallback = (
  status: CaptionStatus,
  detail?: string,
) => void;

// ---------------------------------------------------------------------------
// Lazy-loaded singleton pipelines (ASR + optional translation)
// ---------------------------------------------------------------------------
let asrPipeline: any = null;
let asrLoading: Promise<any> | null = null;

async function loadAsr(): Promise<any> {
  if (asrPipeline) return asrPipeline;
  if (asrLoading) return asrLoading;
  asrLoading = (async () => {
    const { pipeline, env } = await import("@xenova/transformers");
    // Serve model files from the HuggingFace CDN (free) — no local bundling.
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    // MULTILINGUAL whisper-tiny (not .en) — auto-detects the spoken language
    // and transcribes it to English, so non-English streams are captioned too.
    asrPipeline = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      { quantized: true },
    );
    return asrPipeline;
  })();
  try {
    return await asrLoading;
  } finally {
    asrLoading = null;
  }
}

// Translation pipeline (English -> preferred language), loaded on demand only.
let mtPipeline: any = null;
let mtLang: string | null = null;
let mtLoading: Promise<any> | null = null;

/** ISO code -> Helsinki-NLP opus-mt model id (English -> target). */
const MT_MODELS: Record<string, string> = {
  es: "Xenova/opus-mt-en-es",
  fr: "Xenova/opus-mt-en-fr",
  de: "Xenova/opus-mt-en-de",
  it: "Xenova/opus-mt-en-it",
  pt: "Xenova/opus-mt-en-pt",
  nl: "Xenova/opus-mt-en-nl",
  ru: "Xenova/opus-mt-en-ru",
  zh: "Xenova/opus-mt-en-zh",
  ja: "Xenova/opus-mt-en-jap", // Xenova uses 'jap' for Japanese
  ko: "Xenova/opus-mt-en-ko",
  ar: "Xenova/opus-mt-en-ar",
  hi: "Xenova/opus-mt-en-hi",
  sw: "Xenova/opus-mt-en-sw",
  tr: "Xenova/opus-mt-en-tr",
};

async function loadTranslator(lang: string): Promise<any> {
  if (mtPipeline && mtLang === lang) return mtPipeline;
  if (mtLoading && mtLang === lang) return mtLoading;
  const modelId = MT_MODELS[lang];
  if (!modelId) return null; // unsupported language — captions stay English
  mtLang = lang;
  mtLoading = (async () => {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    mtPipeline = await pipeline("translation", modelId, { quantized: true });
    return mtPipeline;
  })();
  try {
    return await mtLoading;
  } finally {
    mtLoading = null;
  }
}

/** Translate an English caption into the preferred language (on-device). */
async function translateCaption(
  text: string,
  targetLang: string,
): Promise<string> {
  if (!targetLang || targetLang === "en" || !text) return text;
  try {
    const translator = await loadTranslator(targetLang);
    if (!translator) return text; // unsupported — keep English
    const out = await translator(text, { max_new_tokens: 256 });
    const translated = String(out?.[0]?.translation_text ?? "").trim();
    return translated || text;
  } catch {
    return text; // translation failure is non-fatal — keep English
  }
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------

/** Downsample an arbitrary-rate Float32 buffer to 16 kHz mono PCM. */
function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16000) return input;
  const ratio = inputRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = input[Math.floor(i * ratio)];
  }
  return out;
}

/** RMS energy — used as a lightweight voice-activity gate to skip silence. */
function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// ---------------------------------------------------------------------------
// LiveCaptionEngine
// ---------------------------------------------------------------------------

export class LiveCaptionEngine {
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private buffer: Float32Array[] = [];
  private bufferedSamples = 0;
  private running = false;
  private transcribing = false;
  private statusCb: CaptionStatusCallback | null = null;
  /** Preferred caption language (ISO code). English transcripts are
   *  translated to this language on-device when it differs from "en". */
  private preferredLang: string = "en";
  /** ISO-2 country/region of the stream's channel (e.g. "us", "ke", "br").
   *  Used to set the ASR language to the language actually SPOKEN in the
   *  stream (for accuracy), which differs from the preferred DISPLAY
   *  language. */
  private streamCountry: string = "";

  /** Map a channel's ISO-2 country to the language the stream is SPOKEN in
   *  (for the ASR recognizer). Falls back to "en" for English-speaking
   *  regions. */
  private asrLangForCountry(country: string): string {
    const map: Record<string, string> = {
      us: "en-US",
      gb: "en-GB",
      ca: "en-CA",
      au: "en-AU",
      nz: "en-NZ",
      ie: "en-IE",
      ke: "en-KE",
      ng: "en-NG",
      gh: "en-GH",
      za: "en-ZA",
      tz: "sw-TZ",
      es: "es-ES",
      mx: "es-MX",
      ar: "es-AR",
      co: "es-CO",
      cl: "es-CL",
      pe: "es-PE",
      ve: "es-VE",
      br: "pt-BR",
      pt: "pt-PT",
      fr: "fr-FR",
      be: "fr-BE",
      ch: "fr-CH",
      de: "de-DE",
      at: "de-AT",
      it: "it-IT",
      nl: "nl-NL",
      ru: "ru-RU",
      cn: "zh-CN",
      tw: "zh-TW",
      jp: "ja-JP",
      kr: "ko-KR",
      in: "hi-IN",
      sa: "ar-SA",
      ae: "ar-AE",
      tr: "tr-TR",
    };
    return map[country] || "en-US";
  }
  /** Web Speech API recognizer (fast free fallback — no model download). */
  private webSpeech: any = null;
  /** Which backend is active: "webspeech" (free/instant) or "whisper" (on-device ASR). */
  private backend: "webspeech" | "whisper" | null = null;

  /** Roughly how much audio (seconds at the capture rate) per caption window. */
  private static readonly WINDOW_SECONDS = 4;
  /** Skip transcription windows quieter than this RMS (silence gate). */
  private static readonly SILENCE_RMS = 0.008;

  /**
   * Start generating live captions from a media element.
   * @param mediaEl  the <video>/<audio> element currently playing the stream
   * @param onCaption  called with each transcribed caption segment
   * @param onStatus  lifecycle updates (loading-model / listening / error…)
   */
  async start(
    mediaEl: HTMLMediaElement,
    onCaption: CaptionCallback,
    onStatus?: CaptionStatusCallback,
    preferredLang: string = "en",
    streamCountry: string = "",
  ): Promise<void> {
    this.statusCb = onStatus || null;
    this.preferredLang = preferredLang || "en";
    this.streamCountry = (streamCountry || "").toLowerCase();
    if (this.running) return;

    // Capture the element's audio output. captureStream() requires the media
    // to be CORS-enabled (crossOrigin="anonymous"); without it the captured
    // audio is silent (all zeros) — detected below via the silence gate.
    const capture =
      (mediaEl as any).captureStream?.() ||
      (mediaEl as any).mozCaptureStream?.();
    if (!capture) {
      this.statusCb?.(
        "unavailable",
        "Live caption capture is not supported in this browser.",
      );
      return;
    }
    this.stream = capture as MediaStream;
    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.statusCb?.(
        "unavailable",
        "This stream exposes no audio track to caption.",
      );
      return;
    }

    // Fallback chain: Web Speech API (instant, free, no download) FIRST,
    // Transformers.js Whisper (on-device ASR) as the fallback. If the
    // model download fails (CDN blocked / offline / large file), the app
    // still captions immediately via the browser's native recognizer.
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.backend = "webspeech";
      this.statusCb?.("listening", "Generating live captions…");
      this.startWebSpeech(SpeechRecognition, onCaption);
      this.running = true;
      return;
    }

    this.statusCb?.("loading-model", "Loading on-device caption model…");
    try {
      await loadAsr();
    } catch (err) {
      this.statusCb?.(
        "error",
        `Could not load the caption model: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    this.backend = "whisper";

    this.audioCtx = new AudioContext();
    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    // ScriptProcessorNode is deprecated but universally supported; the buffer
    // size (8192) ≈ 0.5 s at 16 kHz keeps callback cadence modest.
    this.processor = this.audioCtx.createScriptProcessor(8192, 1, 1);
    this.buffer = [];
    this.bufferedSamples = 0;
    this.running = true;

    const captureRate = this.audioCtx.sampleRate;
    const windowSamples = LiveCaptionEngine.WINDOW_SECONDS * captureRate;

    this.processor.onaudioprocess = (e) => {
      if (!this.running) return;
      const data = e.inputBuffer.getChannelData(0);
      // Copy — the underlying buffer is reused by the browser.
      this.buffer.push(new Float32Array(data));
      this.bufferedSamples += data.length;
      if (this.bufferedSamples >= windowSamples && !this.transcribing) {
        const windowBuf = this.takeWindow(windowSamples);
        if (windowBuf)
          void this.transcribeWindow(windowBuf, captureRate, onCaption);
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
    this.statusCb?.("listening", "Generating live captions…");
  }

  /** Pull exactly n samples from the rolling buffer (consumes them). */
  private takeWindow(n: number): Float32Array | null {
    if (this.bufferedSamples < n) return null;
    const out = new Float32Array(n);
    let offset = 0;
    while (offset < n && this.buffer.length > 0) {
      const head = this.buffer[0];
      const take = Math.min(head.length, n - offset);
      out.set(head.subarray(0, take), offset);
      offset += take;
      if (take === head.length) this.buffer.shift();
      else this.buffer[0] = head.subarray(take);
    }
    this.bufferedSamples -= n;
    return out;
  }

  private async transcribeWindow(
    raw: Float32Array,
    captureRate: number,
    onCaption: CaptionCallback,
  ): Promise<void> {
    this.transcribing = true;
    try {
      const pcm16k = downsampleTo16k(raw, captureRate);
      if (rms(pcm16k) < LiveCaptionEngine.SILENCE_RMS) return; // silence/silenced
      const asr = await loadAsr();
      const result = await asr(pcm16k, {
        chunk_length_s: 30,
        stride_length_s: 5,
        // Multilingual whisper auto-detects the spoken language and outputs
        // an English transcript when language is left unset.
        language: "english",
        task: "transcribe",
      });
      const text = String(result?.text ?? "").trim();
      if (!text) return;
      // Translate the English transcript to the preferred language on-device
      // (no-op when preferred is English or unsupported).
      const finalText =
        this.preferredLang && this.preferredLang !== "en"
          ? await translateCaption(text, this.preferredLang)
          : text;
      if (finalText) onCaption(finalText, true);
    } catch {
      /* transient ASR errors are non-fatal — keep listening */
    } finally {
      this.transcribing = false;
    }
  }

  /** Start the browser's native Web Speech API recognizer (instant, free,
   * no model download). Used as the primary caption path when available. */
  private startWebSpeech(
    RecognitionCtor: any,
    onCaption: CaptionCallback,
  ): void {
    const rec = new RecognitionCtor();
    rec.continuous = true;
    rec.interimResults = true;
    // ACCURACY: set the ASR language to the language SPOKEN in the stream
    // (derived from the channel's country/region), NOT the preferred
    // display language. This is what makes the transcription accurate for a
    // live stream. The preferred language is only used to TRANSLATE the
    // English transcript for display.
    rec.lang = this.asrLangForCountry(this.streamCountry);
    let lastInterim = "";
    rec.onresult = (event: any) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      const text = finalText.trim();
      if (text) {
        lastInterim = text;
        void translateCaption(text, this.preferredLang).then((translated) => {
          if (translated) onCaption(translated, true);
        });
      } else if (event.results.length > 0) {
        const interim =
          event.results[event.results.length - 1][0].transcript.trim();
        if (interim && interim !== lastInterim) {
          lastInterim = interim;
          onCaption(interim, false);
        }
      }
    };
    rec.onerror = (event: any) => {
      // non-speech / no-speech errors are transient — the recognizer auto-
      // restarts via onend.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.statusCb?.("error", `Caption recognition error: ${event.error}`);
      }
    };
    rec.onend = () => {
      if (this.running && this.backend === "webspeech") {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    this.webSpeech = rec;
    try {
      rec.start();
    } catch (err) {
      this.statusCb?.(
        "error",
        `Could not start live captions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Stop captioning and release all audio resources. */
  stop(): void {
    this.running = false;
    this.backend = null;
    if (this.webSpeech) {
      try {
        this.webSpeech.stop();
      } catch {
        /* already stopped */
      }
      this.webSpeech = null;
    }
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.processor = null;
    this.source = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.stream = null;
    this.buffer = [];
    this.bufferedSamples = 0;
  }

  /** Whether the engine is currently capturing + transcribing. */
  isActive(): boolean {
    return this.running;
  }

  /** Pre-warm the Whisper model in the background (e.g. on player mount) so
   * the first caption toggle is instant. Fire-and-forget. */
  static preload(): void {
    void loadAsr().catch(() => {});
  }
}

export const liveCaptionEngine = new LiveCaptionEngine();
