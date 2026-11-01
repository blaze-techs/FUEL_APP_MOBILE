/**
 * live-caption-engine.ts — on-device live caption generation, language
 * auto-detection and translation for any playing stream.
 *
 * Works on EVERY media surface the app plays: Movies (HLS), Live TV (HLS +
 * YouTube embeds) and Live Radio (`<audio>`), because it captures the
 * element's own audio track rather than depending on embedded subtitles.
 *
 * ARCHITECTURE — a browser port of cjpais/Handy's offline speech pipeline:
 *
 *   captureStream → 16 kHz mono PCM → SmoothedVad (onset/pre-roll/hangover)
 *     → utterance → long-form chunk planner (if > 40 s)
 *     → Whisper (multilingual, transformers.js/WASM) → joinTranscripts
 *     → confidence-gated language ID → optional on-device translation
 *
 * The pieces come from `handy-vad.ts`, `handy-chunking.ts` and
 * `handy-language-id.ts`; read those for the provenance of each rule. The
 * headline behaviour those give us:
 *
 *  - Silence never reaches the model. Handy gates on VAD because a model fed
 *    silence invents text; the same gate is what stops captions flickering
 *    hallucinated filler between sentences.
 *  - Utterances are cut at PAUSES, not on a fixed timer, and a 450 ms
 *    pre-roll means the first syllable of a sentence survives.
 *  - The spoken language is DETECTED (not assumed from the channel's country)
 *    and the detection is then used as a hint so later captions are both
 *    faster and more accurate.
 *  - Translation is a separate, optional stage, so transcription accuracy and
 *    display language never fight each other.
 *
 * Requirements for audio capture: the media element must serve its content
 * with CORS (`crossOrigin="anonymous"`); otherwise the browser mutes the
 * captured audio and captions report a clear "unavailable" state instead of
 * emitting garbage.
 *
 * Models lazy-load on first use and are browser-cached: Whisper tiny
 * (~31 MB) for transcription, plus a translation model (~80 MB) only when a
 * non-English display language is chosen.
 */

import {
  EnergyVad,
  SmoothedVad,
  SILERO_FRAME_SAMPLES,
  WHISPER_SAMPLE_RATE,
  buildSmoothedVad,
} from "./handy-vad";
import { joinTranscripts, MAX_CHUNK_SAMPLES } from "./handy-chunking";
import {
  detectAudioLanguage,
  languageLabel,
  normalizeLanguageCode,
  resolveCaptionLanguage,
  type LanguageCandidate,
  type TokenizerLike,
  type WhisperModelLike,
} from "./handy-language-id";

export type CaptionCallback = (text: string, isFinal: boolean) => void;

export type CaptionStatus =
  "idle" | "loading-model" | "listening" | "unavailable" | "error";

export type CaptionStatusCallback = (
  status: CaptionStatus,
  detail?: string,
) => void;

/** Reported whenever the engine changes its mind about the spoken language. */
export type LanguageCallback = (info: {
  /** ISO 639-1 code, or "" when nothing could be determined. */
  code: string;
  /** Display label for the badge, e.g. "French". */
  label: string;
  /** How the answer was reached. */
  source: "detected" | "hinted" | "country" | "none";
}) => void;

export interface LiveCaptionOptions {
  /** Display language. "auto" (the default) means: detect, and caption in
   *  whatever is spoken. Any other value forces that language. */
  preferredLang?: string;
  /** The channel's ISO-2 country — a PREFERENCE for detection, never an answer. */
  streamCountry?: string;
  /** Called when the detected/hinted language changes. */
  onLanguage?: LanguageCallback;
  /** Longest single utterance before it is cut and captioned mid-speech, so a
   *  continuous speaker still gets captions on the go. Seconds. */
  maxUtteranceSeconds?: number;
  /** Shortest utterance worth transcribing (noise bursts are dropped). */
  minUtteranceSeconds?: number;
}

interface AsrPipeline {
  (
    audio: Float32Array,
    options: Record<string, unknown>,
  ): Promise<{ text?: string }>;
  /** Whisper exposes its model + tokenizer, which is what runs the audio LID. */
  model?: WhisperModelLike;
  tokenizer?: TokenizerLike;
  processor?: {
    (audio: Float32Array): Promise<{ input_features?: unknown }>;
  };
}

// ---------------------------------------------------------------------------
// Lazy-loaded singleton pipelines (ASR + optional translation)
// ---------------------------------------------------------------------------
let asrPipeline: AsrPipeline | null = null;
let asrLoading: Promise<AsrPipeline> | null = null;

async function loadAsr(): Promise<AsrPipeline> {
  if (asrPipeline) return asrPipeline;
  if (asrLoading) return asrLoading;
  asrLoading = (async () => {
    const { env } = await import("@xenova/transformers");
    // Serve model + wasm files from the HuggingFace CDN (free) — no local
    // bundling. The site CSP allows huggingface.co / cdn-lfs.huggingface.co.
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.remoteHost = "https://huggingface.co/";
    // Single-thread WASM: avoids the SharedArrayBuffer requirement
    // (cross-origin isolation), so the model runs in EVERY browser without
    // COOP/COEP headers — no silent WASM init failure.
    env.backends.onnx.wasm.numThreads = 1;
    // MULTILINGUAL whisper-tiny (not .en) — it transcribes whatever language
    // it hears, which is what makes detection possible.
    // NOTE: constructed class-by-class (not the named "automatic-speech-
    // recognition" string) so the bundler keeps the Whisper classes alive —
    // the string-dispatch form can fail with "Unsupported model type" after
    // Vite tree-shakes the class registrations.
    asrPipeline = await buildAsrPipeline("Xenova/whisper-tiny");
    return asrPipeline;
  })();
  try {
    return await asrLoading;
  } finally {
    asrLoading = null;
  }
}

/** Explicit class-based construction of the ASR pipeline (tree-shake-proof). */
async function buildAsrPipeline(modelId: string): Promise<AsrPipeline> {
  const {
    AutoModelForSpeechSeq2Seq,
    AutoProcessor,
    AutoTokenizer,
    AutomaticSpeechRecognitionPipeline,
  } = await import("@xenova/transformers");
  const [model, processor, tokenizer] = await Promise.all([
    AutoModelForSpeechSeq2Seq.from_pretrained(modelId, { quantized: true }),
    AutoProcessor.from_pretrained(modelId),
    AutoTokenizer.from_pretrained(modelId),
  ]);
  return new AutomaticSpeechRecognitionPipeline({
    task: "automatic-speech-recognition",
    model,
    tokenizer,
    processor,
  }) as unknown as AsrPipeline;
}

interface TranslationPipelineLike {
  (
    text: string,
    options: Record<string, unknown>,
  ): Promise<Array<{ translation_text?: string }>>;
}

// Translation pipeline, loaded on demand only. Keyed by "src>dst" so the
// direction is explicit — Handy never translates; this is the one stage with
// no upstream counterpart, and it must not silently claim the wrong direction.
let mtPipeline: TranslationPipelineLike | null = null;
let mtKey: string | null = null;
let mtLoading: Promise<TranslationPipelineLike | null> | null = null;

/** Xenova opus-mt models, keyed "src>dst". Only directions that exist. */
const MT_MODELS: Record<string, string> = {
  "en>es": "Xenova/opus-mt-en-es",
  "en>fr": "Xenova/opus-mt-en-fr",
  "en>de": "Xenova/opus-mt-en-de",
  "en>it": "Xenova/opus-mt-en-it",
  "en>pt": "Xenova/opus-mt-en-pt",
  "en>nl": "Xenova/opus-mt-en-nl",
  "en>ru": "Xenova/opus-mt-en-ru",
  "en>zh": "Xenova/opus-mt-en-zh",
  "en>ja": "Xenova/opus-mt-en-jap",
  "en>ko": "Xenova/opus-mt-en-ko",
  "en>ar": "Xenova/opus-mt-en-ar",
  "en>hi": "Xenova/opus-mt-en-hi",
  "en>sw": "Xenova/opus-mt-en-sw",
  "en>tr": "Xenova/opus-mt-en-tr",
  "es>en": "Xenova/opus-mt-es-en",
  "fr>en": "Xenova/opus-mt-fr-en",
  "de>en": "Xenova/opus-mt-de-en",
  "it>en": "Xenova/opus-mt-it-en",
  "pt>en": "Xenova/opus-mt-pt-en",
  "nl>en": "Xenova/opus-mt-nl-en",
  "ru>en": "Xenova/opus-mt-ru-en",
  "zh>en": "Xenova/opus-mt-zh-en",
};

/** Whether a translation direction is available (so the UI can be honest). */
export function canTranslate(from: string, to: string): boolean {
  const src = normalizeLanguageCode(from) || "";
  const dst = normalizeLanguageCode(to) || "";
  if (!src || !dst || src === dst) return true;
  return Boolean(MT_MODELS[`${src}>${dst}`]);
}

async function loadTranslator(
  key: string,
): Promise<TranslationPipelineLike | null> {
  if (mtPipeline && mtKey === key) return mtPipeline;
  if (mtLoading && mtKey === key) return mtLoading;
  const modelId = MT_MODELS[key];
  if (!modelId) return null; // unsupported direction — captions stay as spoken
  mtKey = key;
  mtLoading = (async () => {
    const { env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    env.remoteHost = "https://huggingface.co/";
    env.backends.onnx.wasm.numThreads = 1;
    mtPipeline = await buildMtPipeline(modelId);
    return mtPipeline;
  })();
  try {
    return await mtLoading;
  } finally {
    mtLoading = null;
  }
}

/** Explicit class-based construction of the translation pipeline. */
async function buildMtPipeline(
  modelId: string,
): Promise<TranslationPipelineLike> {
  const { AutoModelForSeq2SeqLM, AutoTokenizer, TranslationPipeline } =
    await import("@xenova/transformers");
  const [model, tokenizer] = await Promise.all([
    AutoModelForSeq2SeqLM.from_pretrained(modelId, { quantized: true }),
    AutoTokenizer.from_pretrained(modelId),
  ]);
  return new TranslationPipeline({
    task: "translation",
    model,
    tokenizer,
  }) as unknown as TranslationPipelineLike;
}

/** Translate a caption from the spoken language to the display language. */
async function translateCaption(
  text: string,
  fromLang: string,
  toLang: string,
): Promise<string> {
  const src = normalizeLanguageCode(fromLang) || "";
  const dst = normalizeLanguageCode(toLang) || "";
  if (!text || !dst || src === dst) return text;
  try {
    const translator = await loadTranslator(`${src}>${dst}`);
    if (!translator) return text; // direction unavailable — keep as spoken
    const out = await translator(text, { max_new_tokens: 256 });
    const translated = String(out?.[0]?.translation_text ?? "").trim();
    return translated || text;
  } catch {
    return text; // translation failure is non-fatal — keep the transcript
  }
}

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------

/** Downsample an arbitrary-rate Float32 buffer to 16 kHz mono PCM. */
export function downsampleTo16k(
  input: Float32Array,
  inputRate: number,
): Float32Array {
  if (inputRate === WHISPER_SAMPLE_RATE) return input;
  const ratio = inputRate / WHISPER_SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = input[Math.floor(i * ratio)];
  }
  return out;
}

/** RMS energy — the silence gate and the fallback detector both use it. */
export function rms(buf: Float32Array): number {
  return EnergyVad.rms(buf);
}

/** Append `src` onto `dst`, returning the combined buffer. */
function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ---------------------------------------------------------------------------
// LiveCaptionEngine
// ---------------------------------------------------------------------------

export class LiveCaptionEngine {
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private running = false;

  /** Handy's smoothed detector, driving utterance boundaries. */
  private vad: SmoothedVad | null = null;
  /** Sub-frame remainder between ScriptProcessor callbacks. */
  private pending: Float32Array = new Float32Array(0);
  /** Samples of the utterance currently being collected. */
  private utterance: Float32Array = new Float32Array(0);
  /** Utterances closed but not yet transcribed (bounded). */
  private queue: Float32Array[] = [];
  private transcribing = false;

  private statusCb: CaptionStatusCallback | null = null;
  private languageCb: LanguageCallback | null = null;
  private onCaption: CaptionCallback | null = null;

  private preferredLang = "auto";
  private streamCountry = "";
  /** The language the model is currently transcribing in. "" = let it
   *  auto-detect (the first utterance), then it becomes the hint. */
  private activeLang = "";
  private detectedLang = "";
  private maxUtteranceSamples = 12 * WHISPER_SAMPLE_RATE;
  private minUtteranceSamples = Math.round(0.35 * WHISPER_SAMPLE_RATE);

  /** Handy's streaming hangover (1650 ms) keeps a sentence together across a
   *  breath; it is the single most visible difference from a fixed window. */
  private static readonly FRAME_SAMPLES = SILERO_FRAME_SAMPLES;

  /**
   * Start generating live captions from a media element.
   *
   * @param mediaEl      the <video>/<audio> element currently playing
   * @param onCaption    each caption segment (`isFinal` false = interim)
   * @param onStatus     lifecycle updates (loading-model / listening / error…)
   * @param preferredLang  display language, or "auto" to detect
   * @param streamCountry  the channel's ISO-2 country (a detection preference)
   * @param onLanguage   notified when the detected language changes
   */
  async start(
    mediaEl: HTMLMediaElement,
    onCaption: CaptionCallback,
    onStatus?: CaptionStatusCallback,
    preferredLang: string = "auto",
    streamCountry: string = "",
    onLanguage?: LanguageCallback,
  ): Promise<void> {
    this.statusCb = onStatus || null;
    this.languageCb = onLanguage || null;
    this.onCaption = onCaption;
    this.preferredLang = preferredLang || "auto";
    this.streamCountry = (streamCountry || "").toLowerCase();
    if (this.running) return;

    // Capture the element's audio output. captureStream() requires the media
    // element to be CORS-enabled (crossOrigin="anonymous"), which the player
    // sets from FIRST load so the captured audio is real (not the mute that
    // non-CORS media yields). Streams flow through the same-origin
    // /api/hls-proxy, so CORS never blocks them.
    const capture: MediaStream | undefined =
      (
        mediaEl as unknown as { captureStream?: () => MediaStream }
      ).captureStream?.() ||
      (
        mediaEl as unknown as { mozCaptureStream?: () => MediaStream }
      ).mozCaptureStream?.();
    if (!capture) {
      this.statusCb?.(
        "unavailable",
        "Live caption capture is not supported in this browser.",
      );
      return;
    }
    this.stream = capture;

    // The audio track can momentarily be empty while the element loads. Wait
    // briefly (up to ~4 s) for the track to appear before giving up so a
    // captions toggle during buffering still works.
    if (capture.getAudioTracks().length === 0) {
      const appeared = await this.waitForAudioTrack(capture, 4000);
      if (!appeared) {
        this.statusCb?.(
          "unavailable",
          "This stream exposes no audio track to caption. Wait for playback to start, then toggle again.",
        );
        return;
      }
    }

    this.statusCb?.("loading-model", "Loading on-device caption model…");
    try {
      await loadAsr();
    } catch (err) {
      this.statusCb?.(
        "error",
        `Could not load the caption model: ${
          err instanceof Error ? err.message : String(err)
        }. Check your connection and try again.`,
      );
      return;
    }

    this.audioCtx = new AudioContext();
    this.source = this.audioCtx.createMediaStreamSource(capture);
    // ScriptProcessorNode is deprecated but universally supported. 4096
    // samples at 48 kHz ≈ 85 ms, which is fine-grained enough for the VAD's
    // 60 ms onset without a flood of callbacks.
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
    this.pending = new Float32Array(0);
    this.utterance = new Float32Array(0);
    this.queue = [];
    // Handy's streaming profile: long hangover so a sentence survives a pause.
    this.vad = buildSmoothedVad({
      frameSamples: LiveCaptionEngine.FRAME_SAMPLES,
      streaming: true,
    });
    this.running = true;

    const captureRate = this.audioCtx.sampleRate;
    this.processor.onaudioprocess = (e) => {
      if (!this.running) return;
      const data = e.inputBuffer.getChannelData(0);
      // Copy — the underlying buffer is reused by the browser.
      const pcm16k = downsampleTo16k(new Float32Array(data), captureRate);
      this.consume(pcm16k);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);
    this.statusCb?.("listening", "Generating live captions…");
  }

  /** Poll for the media element's audio track to appear. */
  private async waitForAudioTrack(
    capture: MediaStream,
    timeoutMs: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let waited = 0;
      const iv = setInterval(() => {
        waited += 250;
        if (capture.getAudioTracks().length > 0) {
          clearInterval(iv);
          resolve(true);
        } else if (waited >= timeoutMs) {
          clearInterval(iv);
          resolve(false);
        }
      }, 250);
    });
  }

  /**
   * Feed freshly captured 16 kHz PCM through the VAD, slicing it into whole
   * detector frames. Speech frames extend the current utterance; the frame
   * that CLOSES an utterance (Handy's hangover exhausted) releases it for
   * transcription.
   */
  private consume(pcm16k: Float32Array): void {
    const vad = this.vad;
    if (!vad) return;
    const frameLen = vad.frameSamples();
    this.pending = concat(this.pending, pcm16k);

    while (this.pending.length >= frameLen) {
      const frame = this.pending.subarray(0, frameLen);
      this.pending = this.pending.subarray(frameLen);

      const wasInSpeech = vad.isInSpeech;
      const result = vad.pushFrame(frame);

      if (result.kind === "speech") {
        this.utterance = concat(this.utterance, result.samples);
        // Cut a very long continuous utterance so captions keep flowing
        // instead of waiting for a pause that may never come.
        if (this.utterance.length >= this.maxUtteranceSamples) {
          this.releaseUtterance();
        }
      } else if (wasInSpeech) {
        // The hangover just ran out: the utterance is complete.
        this.releaseUtterance();
      }
    }
  }

  /** Queue the collected utterance for transcription and start a new one. */
  private releaseUtterance(): void {
    const utt = this.utterance;
    this.utterance = new Float32Array(0);
    if (utt.length < this.minUtteranceSamples) return; // noise burst
    // Bound the queue: captions are only useful if they keep up. Dropping the
    // OLDEST is right — a late caption is worse than a missing one.
    if (this.queue.length >= 3) this.queue.shift();
    this.queue.push(utt);
    void this.drain();
  }

  /** Transcribe queued utterances one at a time, in order. */
  private async drain(): Promise<void> {
    if (this.transcribing) return;
    this.transcribing = true;
    try {
      while (this.queue.length > 0) {
        const utt = this.queue.shift() as Float32Array;
        await this.transcribe(utt);
      }
    } finally {
      this.transcribing = false;
    }
  }

  /**
   * Transcribe one utterance and emit its caption.
   *
   * Handy's long-form rule applies: audio of 40 s or less is never cut, so a
   * normal utterance is a single model run. Anything longer is planned into
   * pause-aligned chunks and the pieces are joined with `joinTranscripts`,
   * which is what keeps CJK captions free of stray spaces.
   */
  private async transcribe(utt: Float32Array): Promise<void> {
    const onCaption = this.onCaption;
    if (!onCaption) return;
    try {
      if (rms(utt) < 0.008) return; // silence/silenced capture — skip
      const asr = await loadAsr();

      // AUDIO language ID — Handy's primary evidence, and the only thing that
      // can tell Latin-script languages apart. Run once per stream, on the
      // first utterance, BEFORE the transcript is used (the transcript is a
      // much weaker signal: "Bonjour" and "Hello" are indistinguishable to a
      // script check, which is why that path fails closed).
      if (!this.activeLang && !this.detectedLang) {
        await this.detectFromAudio(utt, asr);
      }

      const text =
        utt.length > MAX_CHUNK_SAMPLES
          ? await this.transcribeLong(utt, asr)
          : await this.runAsr(utt, asr);
      if (!text) return;

      // Fall back to transcript/script evidence when the audio probe had
      // nothing to say. Once a language is known it becomes the ASR hint.
      this.updateLanguage(text);

      const displayLang = this.displayLanguage();
      const spoken = this.activeLang || this.detectedLang;
      const finalText =
        displayLang && spoken && displayLang !== spoken
          ? await translateCaption(text, spoken, displayLang)
          : text;
      if (finalText) onCaption(finalText, true);
    } catch {
      /* transient ASR errors are non-fatal — keep listening */
    }
  }

  /**
   * Run Whisper's audio LID on this utterance and adopt the answer.
   *
   * Only the FIRST utterance of a stream is probed, which is deliberate: the
   * probe costs an extra model run, the spoken language of a channel does not
   * change mid-programme, and re-probing per utterance would double the
   * compute for no benefit. A silent/ambiguous probe leaves the language
   * undetermined and the next utterance tries again.
   */
  private async detectFromAudio(
    utt: Float32Array,
    asr: AsrPipeline,
  ): Promise<void> {
    if (!asr.model || !asr.tokenizer || !asr.processor) return;
    try {
      const processed = await asr.processor(utt);
      const candidates: LanguageCandidate[] = await detectAudioLanguage(
        asr.model,
        asr.tokenizer,
        processed?.input_features,
      );
      if (candidates.length === 0) return;
      const resolved = resolveCaptionLanguage({
        audioCandidates: candidates,
        country: this.streamCountry,
      });
      if (resolved.code) {
        this.setDetected(
          resolved.code,
          resolved.source === "country" ? "country" : "detected",
        );
      }
    } catch {
      /* the probe is best-effort — transcript evidence still applies */
    }
  }

  /** One model run for an utterance within the model's window. */
  private async runAsr(utt: Float32Array, asr: AsrPipeline): Promise<string> {
    const result = await asr(utt, {
      // Hint the language once it is known; the first utterance is left
      // unhinted so Whisper transcribes whatever it actually hears.
      task: "transcribe",
      ...(this.activeLang ? { language: this.activeLang } : {}),
    });
    return String(result?.text ?? "").trim();
  }

  /**
   * Transcribe an over-long utterance by cutting it at pauses. The planner is
   * Handy's; the probabilities come from a cheap energy pass over the audio,
   * which is enough because the cut only has to land inside a pause.
   */
  private async transcribeLong(
    utt: Float32Array,
    asr: AsrPipeline,
  ): Promise<string> {
    const frameLen = LiveCaptionEngine.FRAME_SAMPLES;
    const detector = new EnergyVad(frameLen);
    const probs: number[] = [];
    for (let i = 0; i + frameLen <= utt.length; i += frameLen) {
      probs.push(detector.isVoice(utt.subarray(i, i + frameLen)) ? 1 : 0);
    }
    const { planCutsForProbs, sliceAtCuts } = await import("./handy-chunking");
    const cuts = planCutsForProbs(probs, frameLen, utt.length);
    const chunks = sliceAtCuts(utt, cuts);
    const texts: string[] = [];
    for (const chunk of chunks) {
      if (chunk.length < Math.round(0.2 * WHISPER_SAMPLE_RATE)) continue;
      texts.push(await this.runAsr(chunk, asr));
    }
    return joinTranscripts(texts).trim();
  }

  /**
   * Update the detected language from a transcript. Detection is deliberately
   * conservative (Handy's `is_reliable() && confidence >= 0.9` posture) and
   * the country only CONSTRAINS the candidate set — a stream from France that
   * is audibly in English still reports English.
   */
  private updateLanguage(text: string): void {
    const explicit = Boolean(
      this.preferredLang && this.preferredLang !== "auto",
    );
    if (explicit) {
      const iso = normalizeLanguageCode(this.preferredLang) || "";
      if (iso && iso !== this.activeLang) {
        this.activeLang = iso;
        this.detectedLang = iso;
        this.languageCb?.({
          code: iso,
          label: languageLabel(iso),
          source: "hinted",
        });
      }
      return;
    }

    // Once a language is established, a short later utterance must not flip
    // it — a single "OK" is not evidence of a language change.
    if (this.detectedLang) {
      const confirm = resolveCaptionLanguage({
        transcript: text,
        country: this.streamCountry,
      });
      if (
        confirm.code &&
        confirm.code !== this.detectedLang &&
        confirm.confidence >= 0.9
      ) {
        this.setDetected(confirm.code, "detected");
      }
      return;
    }

    const identified = resolveCaptionLanguage({
      transcript: text,
      country: this.streamCountry,
    });
    if (!identified.code) return;
    this.setDetected(
      identified.code,
      identified.source === "country" ? "country" : "detected",
    );
  }

  private setDetected(code: string, source: "detected" | "country"): void {
    this.detectedLang = code;
    // Hint the ASR with what we now believe is spoken.
    this.activeLang = code;
    this.languageCb?.({ code, label: languageLabel(code), source });
  }

  /** The language captions should be DISPLAYED in ("" = as spoken). */
  private displayLanguage(): string {
    if (this.preferredLang && this.preferredLang !== "auto") {
      return normalizeLanguageCode(this.preferredLang) || "";
    }
    return ""; // auto: show what is spoken, no translation
  }

  /** Stop captioning and release all audio resources. */
  stop(): void {
    this.running = false;
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
    this.vad = null;
    this.pending = new Float32Array(0);
    this.utterance = new Float32Array(0);
    this.queue = [];
    this.transcribing = false;
    this.activeLang = "";
    this.detectedLang = "";
  }

  /** Whether the engine is currently capturing + transcribing. */
  isActive(): boolean {
    return this.running;
  }

  /** The language currently being transcribed in ("" while undetermined). */
  currentLanguage(): string {
    return this.activeLang || this.detectedLang;
  }

  /** Pre-warm the Whisper model in the background (e.g. on player mount) so
   * the first caption toggle is instant. Fire-and-forget. */
  static preload(): void {
    void loadAsr().catch(() => {});
  }
}

export const liveCaptionEngine = new LiveCaptionEngine();
