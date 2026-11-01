/**
 * Tests for the caption engine's pure logic and its Handy-derived wiring.
 *
 * The engine's capture path needs a real media element and WASM, so what is
 * pinned here is everything that decides WHICH language and WHICH audio reach
 * the model: the PCM helpers, the audio-LID token probe, and the translation
 * direction table.
 */
import { describe, it, expect } from "vitest";
import {
  canTranslate,
  downsampleTo16k,
  rms,
} from "@/react-app/lib/live-caption-engine";
import {
  detectAudioLanguage,
  type TokenizerLike,
  type WhisperModelLike,
} from "@/react-app/lib/handy-language-id";

describe("downsampleTo16k (capture → the 16 kHz the model expects)", () => {
  it("passes 16 kHz input through unchanged (same buffer, no copy)", () => {
    const src = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(src, 16000)).toBe(src);
  });

  it("downsamples 48 kHz to 16 kHz, preserving the waveform's shape", () => {
    const src = new Float32Array(4800);
    for (let i = 0; i < src.length; i++) src[i] = Math.sin(i / 100);
    const out = downsampleTo16k(src, 48000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBeCloseTo(src[0], 5);
    expect(out[3]).toBeCloseTo(src[9], 5); // 3x ratio
  });

  it("handles a 44.1 kHz capture rate", () => {
    const out = downsampleTo16k(new Float32Array(44100), 44100);
    expect(out.length).toBe(16000);
  });
});

describe("rms (the silence gate)", () => {
  it("is 0 for digital silence, so silent windows are skipped", () => {
    expect(rms(new Float32Array(16000))).toBe(0);
  });

  it("is non-zero for speech-like energy, so real audio is transcribed", () => {
    const buf = new Float32Array(16000);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.05 * Math.sin(i * 0.1);
    expect(rms(buf)).toBeGreaterThan(0.008); // the engine's gate
  });

  it("is 0 (not NaN) for an empty buffer", () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe("canTranslate (the direction table must be honest)", () => {
  it("says yes for a direction the app ships", () => {
    expect(canTranslate("en", "es")).toBe(true);
    expect(canTranslate("es", "en")).toBe(true);
    expect(canTranslate("en", "fr")).toBe(true);
  });

  it("says yes when source and target match — no translation needed", () => {
    expect(canTranslate("en", "en")).toBe(true);
    expect(canTranslate("fr", "fr")).toBe(true);
  });

  it("says yes when a side is unknown, so the UI does not block on it", () => {
    expect(canTranslate("", "en")).toBe(true);
    expect(canTranslate("en", "")).toBe(true);
  });

  it("says NO for a direction the app does not ship", () => {
    // opus-mt is not pairwise-complete. Claiming otherwise would show the user
    // a language option that silently returns the source text.
    expect(canTranslate("ja", "ko")).toBe(false);
    expect(canTranslate("sw", "ja")).toBe(false);
  });

  it("normalizes names/tags before looking the direction up", () => {
    expect(canTranslate("english", "spanish")).toBe(true);
    expect(canTranslate("pt-BR", "en")).toBe(true);
  });
});

describe("detectAudioLanguage (Whisper's own LID, Handy's primary evidence)", () => {
  /** A tokenizer that names a fixed set of tokens like Whisper's do. */
  const tokenizer = (names: Record<number, string>): TokenizerLike => ({
    decode: (tokens: number[]) => names[tokens[0]] ?? "",
  });

  const model = (tokens: number[]): WhisperModelLike => ({
    generate: async () => [tokens],
  });

  it("reads the language name out of the token after the start token", () => {
    const tok = tokenizer({
      50258: "<|startoftranscript|>",
      50265: "<|english|>",
    });
    return detectAudioLanguage(model([50258, 50265]), tok, {}).then((c) => {
      expect(c).toEqual([{ code: "en", probability: 1 }]);
    });
  });

  it("normalizes a language name to an ISO code", async () => {
    const tok = tokenizer({
      1: "<|startoftranscript|>",
      2: "<|french|>",
    });
    expect(await detectAudioLanguage(model([1, 2]), tok, {})).toEqual([
      { code: "fr", probability: 1 },
    ]);
  });

  it("ignores the non-language special tokens", async () => {
    // `<|transcribe|>` / `<|notimestamps|>` / timestamps are not languages, and
    // reading one as a language would caption the stream wrongly.
    const tok = tokenizer({
      1: "<|startoftranscript|>",
      2: "<|transcribe|>",
      3: "<|notimestamps|>",
    });
    expect(await detectAudioLanguage(model([1, 2, 3]), tok, {})).toEqual([]);
  });

  it("returns [] when the token layout is unexpected, rather than guessing", async () => {
    const tok = tokenizer({ 1: "hello", 2: "world" });
    expect(await detectAudioLanguage(model([1, 2]), tok, {})).toEqual([]);
  });

  it("returns [] when the model or tokenizer is missing", async () => {
    const tok = tokenizer({ 1: "<|english|>" });
    expect(await detectAudioLanguage(null, tok, {})).toEqual([]);
    expect(await detectAudioLanguage(model([1]), null, {})).toEqual([]);
    expect(await detectAudioLanguage(undefined, undefined, {})).toEqual([]);
  });

  it("returns [] when generate throws, instead of failing the caption", async () => {
    const failing: WhisperModelLike = {
      generate: async () => {
        throw new Error("onnx blew up");
      },
    };
    const tok = tokenizer({ 1: "<|english|>" });
    expect(await detectAudioLanguage(failing, tok, {})).toEqual([]);
  });

  it("accepts the { sequences: [[...]] } shape as well as a bare array", async () => {
    const tok = tokenizer({ 1: "<|startoftranscript|>", 2: "<|german|>" });
    const wrapped: WhisperModelLike = {
      generate: async () => ({ sequences: [[1, 2]] }),
    };
    expect(await detectAudioLanguage(wrapped, tok, {})).toEqual([
      { code: "de", probability: 1 },
    ]);
  });
});
