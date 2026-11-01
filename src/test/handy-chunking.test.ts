/**
 * Tests for the Handy-derived long-form chunking + text joining.
 *
 * The cut planner is the part that decides whether a caption lands in a pause
 * or mid-word, and `joinTranscripts` is what keeps CJK captions from coming out
 * spaced between every word — neither is visible from a passing glance, so both
 * are pinned here.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_CHUNK_SAMPLES,
  MIN_CHUNK_SAMPLES,
  TARGET_SECONDS,
  agreedLanguage,
  cutCandidates,
  isUnspaced,
  joinTranscripts,
  planCuts,
  planCutsForProbs,
  sliceAtCuts,
  speechSegments,
} from "@/react-app/lib/handy-chunking";
import { WHISPER_SAMPLE_RATE as RATE } from "@/react-app/lib/handy-vad";

const FRAME = 512;
const seconds = (s: number) => Math.round(s * RATE);

/** Frame probabilities: speech everywhere except the given pauses. */
function probsWithPauses(totalSeconds: number, pauses: [number, number][]) {
  const frames = Math.floor(seconds(totalSeconds) / FRAME);
  return Array.from({ length: frames }, (_, i) => {
    const at = (i * FRAME) / RATE;
    return pauses.some(([s, e]) => at >= s && at < e) ? 0 : 1;
  });
}

describe("speechSegments (Silero's get_speech_timestamps, as Handy applies it)", () => {
  it("finds one segment per speech run, with the pause between them", () => {
    const probs = probsWithPauses(10, [[4, 5]]);
    const segs = speechSegments(probs, FRAME, seconds(10));
    expect(segs.length).toBe(2);
    expect(segs[0].end).toBeLessThanOrEqual(seconds(5));
    expect(segs[1].start).toBeGreaterThanOrEqual(seconds(4));
  });

  it("drops a speech run shorter than 250 ms", () => {
    // A 100 ms blip between long silences must not become a segment.
    const probs = [0, 0, 1, 0, 0, 0, 0, 0];
    const segs = speechSegments(probs, FRAME, probs.length * FRAME);
    expect(segs.length).toBe(0);
  });

  it("ignores a silence shorter than 100 ms (no cut inside a word)", () => {
    // A single unvoiced frame is far below MIN_SILENCE_SAMPLES.
    const probs = new Array(40).fill(1);
    probs[20] = 0;
    const segs = speechSegments(probs, FRAME, probs.length * FRAME);
    expect(segs.length).toBe(1);
  });

  it("pads the outer edges of the first and last segment", () => {
    const probs = new Array(40).fill(1);
    const samples = probs.length * FRAME;
    const segs = speechSegments(probs, FRAME, samples);
    // 30 ms of speech pad = 480 samples at 16 kHz.
    expect(segs[0].start).toBe(0); // clamped at the start
    expect(segs[0].end).toBe(samples);
  });
});

describe("planCuts (Handy's greedy pause-aware planner)", () => {
  it("never cuts audio of 40 s or less", () => {
    const probs = probsWithPauses(35, [
      [10, 11],
      [20, 21],
    ]);
    const samples = seconds(35);
    expect(planCutsForProbs(probs, FRAME, samples)).toEqual([]);
  });

  it("cuts long audio at a pause, not at a fixed interval", () => {
    // 90 s with a clear pause at 30 s: the cut should land in that pause.
    const probs = probsWithPauses(90, [
      [29, 31],
      [59, 61],
    ]);
    const samples = seconds(90);
    const cuts = planCutsForProbs(probs, FRAME, samples);
    expect(cuts.length).toBeGreaterThanOrEqual(1);
    for (const cut of cuts) {
      const at = cut / RATE;
      // Every cut sits inside one of the declared pauses.
      const inPause = [
        [29, 31],
        [59, 61],
      ].some(([s, e]) => at >= s && at <= e);
      expect(inPause).toBe(true);
    }
  });

  it("prefers a pause near the 30 s target", () => {
    // Pauses at 10 s and 30 s: the planner should choose ~30 s.
    const probs = probsWithPauses(90, [
      [9, 11],
      [29, 31],
    ]);
    const cuts = planCutsForProbs(probs, FRAME, seconds(90));
    expect(cuts.length).toBeGreaterThan(0);
    expect(cuts[0] / RATE).toBeGreaterThan(20);
    expect(TARGET_SECONDS).toBe(30);
  });

  it("falls back to a hard cut when there is no pause at all", () => {
    const probs = new Array(Math.floor(seconds(120) / FRAME)).fill(1);
    const cuts = planCutsForProbs(probs, FRAME, seconds(120));
    expect(cuts.length).toBeGreaterThanOrEqual(2);
    // The first hard cut is at MAX_CHUNK_SAMPLES (40 s).
    expect(cuts[0]).toBe(MAX_CHUNK_SAMPLES);
  });

  it("never leaves a chunk shorter than the 5 s minimum", () => {
    const probs = probsWithPauses(95, [
      [38, 39],
      [78, 79],
    ]);
    const samples = seconds(95);
    const cuts = planCutsForProbs(probs, FRAME, samples);
    const bounds = [0, ...cuts, samples];
    for (let i = 0; i < bounds.length - 1; i++) {
      expect(bounds[i + 1] - bounds[i]).toBeGreaterThanOrEqual(
        MIN_CHUNK_SAMPLES,
      );
    }
  });

  it("returns candidates in order, each in the middle of a pause", () => {
    const segs = speechSegments(
      probsWithPauses(60, [[20, 24]]),
      FRAME,
      seconds(60),
    );
    const cands = cutCandidates(segs, seconds(60));
    expect(cands.length).toBeGreaterThan(0);
    const cuts = cands.map((c) => c.cut);
    expect([...cuts].sort((a, b) => a - b)).toEqual(cuts);
    // The pause is 4 s long, so its gap is reported as ~4 s.
    expect(cands[0].gapSeconds).toBeGreaterThan(3);
  });
});

describe("sliceAtCuts", () => {
  it("splits audio at the given offsets and keeps every sample", () => {
    const audio = new Float32Array(100);
    for (let i = 0; i < audio.length; i++) audio[i] = i;
    const chunks = sliceAtCuts(audio, [30, 60]);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.length)).toEqual([30, 30, 40]);
    // No sample is lost or duplicated.
    expect(chunks[0][0]).toBe(0);
    expect(chunks[1][0]).toBe(30);
    expect(chunks[2][0]).toBe(60);
  });

  it("returns the whole buffer when there are no cuts", () => {
    const audio = new Float32Array(10);
    const chunks = sliceAtCuts(audio, []);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(10);
  });
});

describe("isUnspaced / joinTranscripts (Handy's unspaced-script rule)", () => {
  it("recognizes the scripts Handy lists as written without spaces", () => {
    expect(isUnspaced("中")).toBe(true); // Han
    expect(isUnspaced("あ")).toBe(true); // Hiragana
    expect(isUnspaced("ア")).toBe(true); // Katakana
    expect(isUnspaced("ก")).toBe(true); // Thai
    expect(isUnspaced("ກ")).toBe(true); // Lao
    expect(isUnspaced("ក")).toBe(true); // Khmer
    expect(isUnspaced("က")).toBe(true); // Myanmar
    expect(isUnspaced("、")).toBe(true); // CJK punctuation (U+3000–303F)
    expect(isUnspaced("ａ")).toBe(true); // fullwidth forms (U+FF00–FFEF)
  });

  it("does NOT treat Hangul as unspaced — Korean separates words with spaces", () => {
    // Handy's regex deliberately omits Hangul: Korean is written with spaces,
    // so joining two Korean chunks must still insert one.
    expect(isUnspaced("한")).toBe(false);
    expect(joinTranscripts(["안녕", "하세요"])).toBe("안녕 하세요");
  });

  it("leaves Latin, accented and Cyrillic characters spaced", () => {
    expect(isUnspaced("a")).toBe(false);
    expect(isUnspaced("é")).toBe(false);
    expect(isUnspaced("Д")).toBe(false);
  });

  it("joins Latin chunks with a single space", () => {
    expect(joinTranscripts(["hello", "world"])).toBe("hello world");
  });

  it("does NOT insert a space between two CJK chunks", () => {
    // The whole point: Chinese captions must not come out spaced per word.
    expect(joinTranscripts(["你好", "世界"])).toBe("你好世界");
  });

  it("does not insert a space when only one side is unspaced-adjacent", () => {
    // Handy's rule is `!unspaced(last) && !unspaced(first)` — a space needs
    // BOTH sides spaced.
    expect(joinTranscripts(["hello", "世界"])).toBe("hello世界");
    expect(joinTranscripts(["世界", "hello"])).toBe("世界hello");
  });

  it("trims each chunk and skips empties", () => {
    expect(joinTranscripts(["  a  ", "", "   ", "b"])).toBe("a b");
  });

  it("returns an empty string for no chunks", () => {
    expect(joinTranscripts([])).toBe("");
    expect(joinTranscripts(["", "  "])).toBe("");
  });

  it("handles a single chunk unchanged", () => {
    expect(joinTranscripts(["only one"])).toBe("only one");
  });
});

describe("agreedLanguage (Handy's agreed_language)", () => {
  it("returns the language when every chunk agrees", () => {
    expect(agreedLanguage(["fr", "fr", "fr"])).toBe("fr");
  });

  it("returns null when chunks disagree, rather than guessing", () => {
    expect(agreedLanguage(["fr", "en"])).toBeNull();
  });

  it("returns null when the first chunk reported nothing", () => {
    expect(agreedLanguage([null, "fr"])).toBeNull();
    expect(agreedLanguage([undefined, "fr"])).toBeNull();
  });

  it("treats a single chunk as agreement with itself", () => {
    expect(agreedLanguage(["de"])).toBe("de");
  });
});
