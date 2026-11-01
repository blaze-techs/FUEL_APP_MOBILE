/**
 * handy-vad.ts — browser port of Handy's voice-activity layer.
 *
 * Reverse-engineered from cjpais/Handy (`src-tauri/src/audio_toolkit/vad/`).
 * Handy gates transcription on speech so silence never reaches the model; the
 * same idea is what makes live captions readable instead of a stream of
 * hallucinated filler. Three pieces are ported here:
 *
 *  1. `framesForDurationMs` — Handy's `frames_for_duration_ms`, which rounds
 *     UP so an alternate backend never shortens the onset, pre-roll or
 *     hangover tail.
 *  2. `SmoothedVad` — Handy's `SmoothedVad` state machine verbatim: a pre-roll
 *     buffer so the first syllable isn't clipped, an onset counter so a single
 *     stray frame doesn't start an utterance, and a hangover tail so a pause
 *     mid-sentence doesn't end one.
 *  3. `EnergyVad` — a dependency-free boolean detector. Handy uses Silero's
 *     ONNX model; a browser cannot ship the GGUF, so this stands in as the
 *     default and `loadSileroVad()` upgrades to the real ONNX model when it is
 *     reachable. Both satisfy the same `VoiceActivityDetector` contract, which
 *     is why the smoothing above is backend-agnostic.
 *
 * Handy's own timings are the defaults: 450 ms pre-roll, 450 ms hangover for a
 * finished recording, 1650 ms hangover while streaming, 60 ms onset.
 */

/** Handy: `audio_toolkit::constants::WHISPER_SAMPLE_RATE`. */
export const WHISPER_SAMPLE_RATE = 16000;

/** Handy: `vad::VAD_PREFILL_MS` — audio kept before speech is confirmed. */
export const VAD_PREFILL_MS = 450;
/** Handy: `vad::VAD_OFFLINE_HANGOVER_MS` — tail kept for a finished clip. */
export const VAD_OFFLINE_HANGOVER_MS = 450;
/** Handy: `vad::VAD_STREAMING_HANGOVER_MS` — tail kept while still recording. */
export const VAD_STREAMING_HANGOVER_MS = 1650;
/** Handy: `vad::VAD_ONSET_MS` — consecutive voiced frames needed to start. */
export const VAD_ONSET_MS = 60;

/** Silero v5 wants 512 samples per prediction at 16 kHz. */
export const SILERO_FRAME_SAMPLES = 512;

/**
 * Handy's `frames_for_duration_ms`: whole detector frames covering
 * `durationMs`, rounded up so a longer frame size never SHORTENS the window.
 */
export function framesForDurationMs(
  durationMs: number,
  frameSamples: number,
): number {
  if (frameSamples <= 0) throw new Error("VAD frame size must be non-zero");
  const numerator = durationMs * WHISPER_SAMPLE_RATE;
  const denominator = frameSamples * 1000;
  return Math.ceil(numerator / denominator);
}

/** Handy's `VadFrame`: speech (possibly aggregated) or non-speech. */
export type VadFrame =
  { kind: "speech"; samples: Float32Array } | { kind: "noise" };

/** The contract both detectors and the smoothing wrapper satisfy. */
export interface VoiceActivityDetector {
  /** Feed one backend-sized frame; get a keep/drop decision. */
  pushFrame(frame: Float32Array): VadFrame;
  /** Samples per prediction (mono 16 kHz). */
  frameSamples(): number;
  reset(): void;
}

// ---------------------------------------------------------------------------
// EnergyVad — dependency-free boolean detector
// ---------------------------------------------------------------------------

export interface EnergyVadOptions {
  /** Absolute RMS floor below which a frame is never speech. */
  floor?: number;
  /** Multiplier over the tracked noise floor for a frame to count as speech. */
  ratio?: number;
  /** Frames of silence before the noise floor is allowed to decay. */
  decayAfter?: number;
}

/**
 * A boolean VAD based on frame energy relative to a slowly-tracked noise
 * floor. This is the same role Silero plays in Handy — the `SmoothedVad`
 * wrapper above it is what actually shapes the utterance, so a simpler
 * detector changes accuracy, not structure.
 *
 * The floor tracks upward immediately (so a loud room raises the bar) and
 * downward only after `decayAfter` quiet frames (so a single quiet frame in
 * speech does not collapse it and let noise through).
 */
export class EnergyVad implements VoiceActivityDetector {
  private readonly frameLen: number;
  private readonly floor: number;
  private readonly ratio: number;
  private readonly decayAfter: number;
  private noiseFloor: number;
  private quietFrames = 0;

  constructor(
    frameSamples = SILERO_FRAME_SAMPLES,
    opts: EnergyVadOptions = {},
  ) {
    if (frameSamples <= 0) throw new Error("VAD frame size must be non-zero");
    this.frameLen = frameSamples;
    this.floor = opts.floor ?? 0.004;
    this.ratio = opts.ratio ?? 2.5;
    this.decayAfter = opts.decayAfter ?? 20;
    this.noiseFloor = this.floor;
  }

  frameSamples(): number {
    return this.frameLen;
  }

  /** Raw energy of a frame (exposed for the silence gate and for tests). */
  static rms(buf: Float32Array): number {
    if (buf.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  isVoice(frame: Float32Array): boolean {
    const energy = EnergyVad.rms(frame);
    const threshold = Math.max(this.floor, this.noiseFloor * this.ratio);
    if (energy >= threshold) {
      // Speech: let the floor follow the room upward but never above the
      // frame itself, or the next frame would be judged against speech.
      this.noiseFloor = Math.min(energy, this.noiseFloor * 1.05);
      this.quietFrames = 0;
      return true;
    }
    this.quietFrames++;
    if (this.quietFrames >= this.decayAfter) {
      this.noiseFloor = Math.max(this.floor, this.noiseFloor * 0.95);
    }
    return false;
  }

  pushFrame(frame: Float32Array): VadFrame {
    return this.isVoice(frame)
      ? { kind: "speech", samples: frame }
      : { kind: "noise" };
  }

  reset(): void {
    this.noiseFloor = this.floor;
    this.quietFrames = 0;
  }
}

// ---------------------------------------------------------------------------
// SmoothedVad — Handy's state machine, ported verbatim
// ---------------------------------------------------------------------------

interface BufferedFrame {
  samples: Float32Array;
  emitted: boolean;
}

/**
 * Handy's `SmoothedVad`. Wraps a boolean detector and shapes its output into
 * utterances:
 *
 * - **prefill** — every incoming frame is buffered so that when speech is
 *   confirmed the run-up is emitted with it (the first syllable survives).
 * - **onset** — speech only begins after `onsetFrames` consecutive voiced
 *   frames, so one stray loud frame does not open an utterance.
 * - **hangover** — once speaking, `hangoverFrames` of silence are still
 *   emitted, so a pause between words does not split an utterance.
 *
 * The counters behave exactly as Handy's match arms do, including resetting
 * the onset counter on silence rather than letting partial runs accumulate.
 */
export class SmoothedVad implements VoiceActivityDetector {
  private readonly inner: VoiceActivityDetector;
  private readonly prefillFrames: number;
  private readonly onsetFrames: number;
  private hangoverFrames: number;

  private frameBuffer: BufferedFrame[] = [];
  private onsetCounter = 0;
  private hangoverCounter = 0;
  private inSpeech = false;
  private tempOut: Float32Array = new Float32Array(0);

  constructor(
    inner: VoiceActivityDetector,
    prefillFrames: number,
    hangoverFrames: number,
    onsetFrames: number,
  ) {
    this.inner = inner;
    this.prefillFrames = Math.max(0, prefillFrames);
    this.hangoverFrames = Math.max(0, hangoverFrames);
    this.onsetFrames = Math.max(1, onsetFrames);
  }

  frameSamples(): number {
    return this.inner.frameSamples();
  }

  /** Handy's `set_hangover_frames`: the tail can change mid-stream (a live
   *  decode uses a longer tail than a finished clip). */
  setHangoverFrames(frames: number): void {
    this.hangoverFrames = Math.max(0, frames);
  }

  /** Whether an utterance is currently open (Handy's `in_speech`). */
  get isInSpeech(): boolean {
    return this.inSpeech;
  }

  private markLastEmitted(): void {
    const last = this.frameBuffer[this.frameBuffer.length - 1];
    if (last) last.emitted = true;
  }

  pushFrame(frame: Float32Array): VadFrame {
    // 1. Buffer every incoming frame for possible pre-roll.
    this.frameBuffer.push({ samples: frame, emitted: false });
    while (this.frameBuffer.length > this.prefillFrames + 1) {
      this.frameBuffer.shift();
    }

    // 2. Delegate to the wrapped boolean detector.
    const isVoice = this.inner.pushFrame(frame).kind === "speech";

    if (!this.inSpeech && isVoice) {
      // Potential start of speech — accumulate onset frames.
      this.onsetCounter++;
      if (this.onsetCounter >= this.onsetFrames) {
        this.inSpeech = true;
        this.hangoverCounter = this.hangoverFrames;
        this.onsetCounter = 0;
        // Emit prefill + the current frame as one utterance head.
        const parts: Float32Array[] = [];
        let total = 0;
        for (const buffered of this.frameBuffer) {
          if (buffered.emitted) continue;
          parts.push(buffered.samples);
          total += buffered.samples.length;
          buffered.emitted = true;
        }
        const out = new Float32Array(total);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.length;
        }
        this.tempOut = out;
        return { kind: "speech", samples: out };
      }
      return { kind: "noise" };
    }

    if (this.inSpeech && isVoice) {
      // Ongoing speech — refresh the tail.
      this.hangoverCounter = this.hangoverFrames;
      this.markLastEmitted();
      return { kind: "speech", samples: frame };
    }

    if (this.inSpeech && !isVoice) {
      // End of speech, or a pause inside it.
      if (this.hangoverCounter > 0) {
        this.hangoverCounter--;
        this.markLastEmitted();
        return { kind: "speech", samples: frame };
      }
      this.inSpeech = false;
      return { kind: "noise" };
    }

    // Silence, or a broken onset sequence.
    this.onsetCounter = 0;
    return { kind: "noise" };
  }

  reset(): void {
    this.inner.reset();
    this.frameBuffer = [];
    this.onsetCounter = 0;
    this.hangoverCounter = 0;
    this.inSpeech = false;
    this.tempOut = new Float32Array(0);
  }
}

// ---------------------------------------------------------------------------
// Silero ONNX upgrade (optional)
// ---------------------------------------------------------------------------

/** The slice of an onnxruntime-web session this module needs. */
export interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** The slice of the ort runtime this module needs (the `Tensor` constructor). */
export interface OrtRuntimeLike {
  Tensor: new (
    type: string,
    data: ArrayLike<number> | BigInt64Array,
    dims: number[],
  ) => unknown;
}

export interface SileroVadOptions {
  /** 512 for Silero v5 at 16 kHz. */
  frameSamples?: number;
  /** Speech probability above which a frame is voiced (Handy default 0.5). */
  threshold?: number;
}

/**
 * Silero VAD over ONNX Runtime Web — the browser analogue of Handy's
 * `SileroVad`. Callers pass the already-loaded `ort` runtime and session, so
 * the ~10 MB runtime is only fetched when captions are actually enabled.
 *
 * `pushFrame` cannot await the model, so this exposes `scoreFrame` (async) and
 * keeps `pushFrame` for shape compatibility with `SmoothedVad`. Wrap it in an
 * `AsyncVadScorer` when driving it from the capture loop.
 */
export interface SileroVad extends VoiceActivityDetector {
  /** Speech probability for one frame (0–1). */
  scoreFrame(frame: Float32Array): Promise<number>;
}

export function createSileroVad(
  ort: OrtRuntimeLike,
  session: OrtSessionLike,
  opts: SileroVadOptions = {},
): SileroVad {
  const frameSamples = opts.frameSamples ?? SILERO_FRAME_SAMPLES;
  const threshold = opts.threshold ?? 0.5;
  const { Tensor } = ort;
  const emptyState = () =>
    new Tensor("float32", new Float32Array(2 * 1 * 128), [2, 1, 128]);
  // Silero v5 state is a [2, batch, 128] Float32 tensor. The model is
  // stateful across calls, which is why it must be reset per stream.
  let state = emptyState();
  const sr = new Tensor(
    "int64",
    BigInt64Array.from([BigInt(WHISPER_SAMPLE_RATE)]),
    [1],
  );
  let lastVoice = false;

  const scoreFrame = async (frame: Float32Array): Promise<number> => {
    const input = new Tensor("float32", frame, [1, frame.length]);
    const out = await session.run({ input, state, sr });
    const next = out.stateN ?? out.state;
    if (next) state = next;
    const data = (out.output as { data?: Float32Array } | undefined)?.data;
    const prob = data && data.length > 0 ? Number(data[0]) : 0;
    lastVoice = prob > threshold;
    return prob;
  };

  return {
    frameSamples: () => frameSamples,
    scoreFrame,
    reset() {
      state = emptyState();
      lastVoice = false;
    },
    pushFrame(frame: Float32Array): VadFrame {
      // The model is async; the last scored frame's verdict is the best
      // synchronous answer available. Callers that need a per-frame decision
      // use `scoreFrame` (see `scoreFrames` below).
      return lastVoice && frame.length === frameSamples
        ? { kind: "speech", samples: frame }
        : { kind: "noise" };
    },
  };
}

/**
 * Score every frame of `audio` with a Silero detector and return the verdicts
 * in order — Handy's `SpeechScorer::score` contract. Used by the long-form
 * chunk planner and by language detection.
 */
export async function scoreFrames(
  vad: SileroVad,
  audio: Float32Array,
): Promise<boolean[]> {
  const n = vad.frameSamples();
  const out: boolean[] = [];
  for (let i = 0; i + n <= audio.length; i += n) {
    const prob = await vad.scoreFrame(audio.subarray(i, i + n));
    out.push(prob > 0.5);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Convenience: build the detector Handy would use
// ---------------------------------------------------------------------------

export interface BuildVadOptions {
  /** Frame size in samples; 512 matches Silero and keeps callback cadence modest. */
  frameSamples?: number;
  /** `true` while a stream is still playing (Handy's streaming hangover). */
  streaming?: boolean;
  /** Override the pre-roll; defaults to Handy's 450 ms. */
  prefillMs?: number;
  /** Override the tail; defaults to Handy's streaming/offline value. */
  hangoverMs?: number;
  /** Override the onset; defaults to Handy's 60 ms. */
  onsetMs?: number;
  /** Detector to wrap; defaults to a new `EnergyVad`. */
  detector?: VoiceActivityDetector;
}

/**
 * Build the smoothed detector with Handy's default timings. `streaming: true`
 * selects the 1650 ms hangover, which is what keeps a live caption from
 * breaking at every breath.
 */
export function buildSmoothedVad(opts: BuildVadOptions = {}): SmoothedVad {
  const frameSamples = opts.frameSamples ?? SILERO_FRAME_SAMPLES;
  const detector = opts.detector ?? new EnergyVad(frameSamples);
  const prefillMs = opts.prefillMs ?? VAD_PREFILL_MS;
  const hangoverMs =
    opts.hangoverMs ??
    (opts.streaming ? VAD_STREAMING_HANGOVER_MS : VAD_OFFLINE_HANGOVER_MS);
  const onsetMs = opts.onsetMs ?? VAD_ONSET_MS;
  return new SmoothedVad(
    detector,
    framesForDurationMs(prefillMs, frameSamples),
    framesForDurationMs(hangoverMs, frameSamples),
    framesForDurationMs(onsetMs, frameSamples),
  );
}
