/**
 * Deterministic unit tests for the live caption engine's pure logic:
 * - Whisper language selection from stream country (accuracy — captions
 *   transcribe the language actually SPOKEN in the stream).
 * - Silence gate (RMS) — quiet windows are skipped instead of emitting
 *   garbage captions.
 * - Downsampling preserves waveform shape (captured audio → 16 kHz PCM).
 */
import { describe, it, expect } from "vitest";
import {
  LiveCaptionEngine,
  rms,
  downsampleTo16k,
} from "@/react-app/lib/live-caption-engine";

describe("LiveCaptionEngine language selection (accuracy)", () => {
  it("maps English-speaking countries to english", () => {
    expect(LiveCaptionEngine.whisperLangForCountry("us")).toBe("english");
    expect(LiveCaptionEngine.whisperLangForCountry("GB")).toBe("english");
    expect(LiveCaptionEngine.whisperLangForCountry("ke")).toBe("english");
    expect(LiveCaptionEngine.whisperLangForCountry("Au")).toBe("english");
  });

  it("maps non-English stream countries to the language SPOKEN there", () => {
    expect(LiveCaptionEngine.whisperLangForCountry("br")).toBe("portuguese");
    expect(LiveCaptionEngine.whisperLangForCountry("fr")).toBe("french");
    expect(LiveCaptionEngine.whisperLangForCountry("de")).toBe("german");
    expect(LiveCaptionEngine.whisperLangForCountry("jp")).toBe("japanese");
    expect(LiveCaptionEngine.whisperLangForCountry("kr")).toBe("korean");
    expect(LiveCaptionEngine.whisperLangForCountry("cn")).toBe("chinese");
    expect(LiveCaptionEngine.whisperLangForCountry("in")).toBe("hindi");
    expect(LiveCaptionEngine.whisperLangForCountry("sa")).toBe("arabic");
    expect(LiveCaptionEngine.whisperLangForCountry("tr")).toBe("turkish");
    expect(LiveCaptionEngine.whisperLangForCountry("es")).toBe("spanish");
    expect(LiveCaptionEngine.whisperLangForCountry("mx")).toBe("spanish");
  });

  it("returns empty (auto-detect) for unmapped countries — never a wrong hint", () => {
    expect(LiveCaptionEngine.whisperLangForCountry("zz")).toBe("");
    expect(LiveCaptionEngine.whisperLangForCountry("")).toBe("");
    expect(LiveCaptionEngine.whisperLangForCountry("xx")).toBe("");
  });

  it("case-insensitive + whitespace-robust", () => {
    expect(LiveCaptionEngine.whisperLangForCountry("  BR  ")).toBe(
      "portuguese",
    );
  });
});

describe("LiveCaptionEngine silence gate (RMS)", () => {
  it("silence (all zeros) has RMS 0 — below the gate, so silence is skipped", () => {
    expect(rms(new Float32Array(16000))).toBe(0);
  });

  it("speech-like energy has nonzero RMS — passes the gate", () => {
    const buf = new Float32Array(16000);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.05 * Math.sin(i * 0.1);
    expect(rms(buf)).toBeGreaterThan(0.008); // SILENCE_RMS
  });
});

describe("LiveCaptionEngine downsampling (capture → 16 kHz PCM)", () => {
  it("passes 16 kHz input through unchanged", () => {
    const src = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(src, 16000)).toBe(src);
  });

  it("downsamples 48 kHz to 16 kHz preserving approximate shapes", () => {
    const src = new Float32Array(4800);
    for (let i = 0; i < src.length; i++) {
      src[i] = Math.sin(i / 100);
    }
    const out = downsampleTo16k(src, 48000);
    expect(out.length).toBe(1600);
    // First output sample ~ input[0], ~3rd ~ input[3] (3x ratio = 48000/16000)
    expect(out[0]).toBeCloseTo(src[0], 5);
    expect(out[3]).toBeCloseTo(src[9], 5);
  });
});
