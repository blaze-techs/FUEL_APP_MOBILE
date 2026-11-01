/**
 * Tests for the Handy-derived VAD layer.
 *
 * These pin Handy's own numbers and state transitions, because a drift in any
 * of them is invisible at runtime — captions would still appear, just clipped
 * at the start of sentences or split at every breath.
 */
import { describe, it, expect } from "vitest";
import {
  EnergyVad,
  SmoothedVad,
  VAD_OFFLINE_HANGOVER_MS,
  VAD_ONSET_MS,
  VAD_PREFILL_MS,
  VAD_STREAMING_HANGOVER_MS,
  WHISPER_SAMPLE_RATE,
  buildSmoothedVad,
  framesForDurationMs,
  type VoiceActivityDetector,
  type VadFrame,
} from "@/react-app/lib/handy-vad";

/** A detector whose verdict is scripted, so the smoothing is what is tested. */
class ScriptedVad implements VoiceActivityDetector {
  private i = 0;
  constructor(
    private readonly verdicts: boolean[],
    private readonly frameLen: number,
  ) {}
  frameSamples() {
    return this.frameLen;
  }
  pushFrame(frame: Float32Array): VadFrame {
    const voice = this.verdicts[this.i++] ?? false;
    return voice ? { kind: "speech", samples: frame } : { kind: "noise" };
  }
  reset() {
    this.i = 0;
  }
}

const frame = (n = 4) => new Float32Array(n).fill(0.1);

describe("framesForDurationMs (Handy's frames_for_duration_ms)", () => {
  it("reproduces Handy's own test vectors at 512 samples", () => {
    // These exact numbers are asserted in Handy's `vad::tests`.
    expect(framesForDurationMs(VAD_PREFILL_MS, 512)).toBe(15);
    expect(framesForDurationMs(VAD_OFFLINE_HANGOVER_MS, 512)).toBe(15);
    expect(framesForDurationMs(VAD_STREAMING_HANGOVER_MS, 512)).toBe(52);
    expect(framesForDurationMs(VAD_ONSET_MS, 512)).toBe(2);
  });

  it("rounds UP for a smaller frame size, so a window is never shortened", () => {
    // Handy: "rounding up so an alternate backend never shortens Handy's
    // onset, pre-roll, or hangover tail."
    expect(framesForDurationMs(VAD_PREFILL_MS, 256)).toBe(29);
    expect(framesForDurationMs(VAD_OFFLINE_HANGOVER_MS, 256)).toBe(29);
    expect(framesForDurationMs(VAD_STREAMING_HANGOVER_MS, 256)).toBe(104);
    expect(framesForDurationMs(VAD_ONSET_MS, 256)).toBe(4);
  });

  it("rejects a zero frame size rather than dividing by zero", () => {
    expect(() => framesForDurationMs(100, 0)).toThrow();
  });

  it("uses the 16 kHz sample rate Handy declares", () => {
    expect(WHISPER_SAMPLE_RATE).toBe(16000);
  });
});

describe("SmoothedVad — Handy's onset / prefill / hangover state machine", () => {
  it("does not start speech on a single voiced frame (onset needs 2)", () => {
    const vad = new SmoothedVad(new ScriptedVad([true, false], 4), 0, 0, 2);
    expect(vad.pushFrame(frame()).kind).toBe("noise");
    expect(vad.isInSpeech).toBe(false);
  });

  it("starts speech once the onset count is reached", () => {
    const vad = new SmoothedVad(new ScriptedVad([true, true], 4), 0, 0, 2);
    vad.pushFrame(frame());
    expect(vad.pushFrame(frame()).kind).toBe("speech");
    expect(vad.isInSpeech).toBe(true);
  });

  it("emits the PRE-ROLL with the first speech frame, so the first syllable survives", () => {
    // 2 frames of pre-roll, onset 1: the two buffered frames plus the
    // triggering frame must all come out together.
    const vad = new SmoothedVad(
      new ScriptedVad([false, false, true], 4),
      2,
      0,
      1,
    );
    vad.pushFrame(frame(4));
    vad.pushFrame(frame(4));
    const out = vad.pushFrame(frame(4));
    expect(out.kind).toBe("speech");
    if (out.kind === "speech") {
      // 2 prefill frames + the current frame = 12 samples of 4.
      expect(out.samples.length).toBe(12);
    }
  });

  it("keeps emitting through the hangover tail, then stops", () => {
    // onset 1, hangover 2: silence after speech is emitted twice, then noise.
    const vad = new SmoothedVad(
      new ScriptedVad([true, false, false, false, false], 4),
      0,
      2,
      1,
    );
    expect(vad.pushFrame(frame()).kind).toBe("speech"); // speech starts
    expect(vad.pushFrame(frame()).kind).toBe("speech"); // hangover 2 -> 1
    expect(vad.pushFrame(frame()).kind).toBe("speech"); // hangover 1 -> 0
    expect(vad.pushFrame(frame()).kind).toBe("noise"); // tail exhausted
    expect(vad.isInSpeech).toBe(false);
  });

  it("resets the onset counter on silence rather than accumulating a partial run", () => {
    // Handy's `(false, false)` arm resets `onset_counter`. A broken run must
    // not count toward the next one.
    const vad = new SmoothedVad(
      new ScriptedVad([true, false, true, false, false], 4),
      0,
      0,
      3,
    );
    expect(vad.pushFrame(frame()).kind).toBe("noise"); // onset 1
    expect(vad.pushFrame(frame()).kind).toBe("noise"); // reset
    expect(vad.pushFrame(frame()).kind).toBe("noise"); // onset 1 again
    expect(vad.pushFrame(frame()).kind).toBe("noise"); // reset
    expect(vad.isInSpeech).toBe(false);
  });

  it("setHangoverFrames changes the tail mid-stream (Handy's streaming profile)", () => {
    // onset 1, tail 3: the voiced frame plus THREE silent frames are emitted,
    // and only the fourth silent frame closes the utterance.
    const vad = new SmoothedVad(
      new ScriptedVad([true, false, false, false, false], 4),
      0,
      0,
      1,
    );
    vad.setHangoverFrames(3);
    expect(vad.pushFrame(frame()).kind).toBe("speech"); // speech starts
    expect(vad.pushFrame(frame()).kind).toBe("speech"); // 3 -> 2
    expect(vad.pushFrame(frame()).kind).toBe("speech"); // 2 -> 1
    expect(vad.pushFrame(frame()).kind).toBe("speech"); // 1 -> 0
    expect(vad.pushFrame(frame()).kind).toBe("noise"); // tail exhausted
  });

  it("reset clears speech state so a new stream does not inherit it", () => {
    const vad = new SmoothedVad(new ScriptedVad([true, true], 4), 0, 0, 1);
    vad.pushFrame(frame());
    expect(vad.isInSpeech).toBe(true);
    vad.reset();
    expect(vad.isInSpeech).toBe(false);
  });
});

describe("buildSmoothedVad — Handy's timing profiles", () => {
  it("uses the STREAMING hangover (1650 ms) for a live stream, which is ~3.7x the offline tail", () => {
    // 1650 ms vs 450 ms at 512 samples = 52 vs 15 frames. Assert the constants
    // and that a stream tolerates a far longer pause before cutting.
    expect(framesForDurationMs(VAD_STREAMING_HANGOVER_MS, 512)).toBe(52);
    expect(framesForDurationMs(VAD_OFFLINE_HANGOVER_MS, 512)).toBe(15);
    expect(VAD_STREAMING_HANGOVER_MS).toBeGreaterThan(VAD_OFFLINE_HANGOVER_MS);

    const frameLen = 512;
    const onset = framesForDurationMs(VAD_ONSET_MS, frameLen); // 2
    // Two voiced frames to clear the onset, then a 30-frame pause, then two
    // more voiced frames.
    const pauseFrames = 30;
    const verdicts = [
      ...new Array(onset).fill(true),
      ...new Array(pauseFrames).fill(false),
      ...new Array(onset).fill(true),
    ];

    const run = (hangoverMs: number) => {
      const vad = new SmoothedVad(
        new ScriptedVad(verdicts, frameLen),
        0,
        framesForDurationMs(hangoverMs, frameLen),
        onset,
      );
      const kinds = verdicts.map(
        () => vad.pushFrame(new Float32Array(frameLen)).kind,
      );
      // Frames 0..onset-1 are the onset; the pause starts right after.
      const duringPause = kinds.slice(onset, onset + pauseFrames);
      return {
        speechFrames: kinds.filter((k) => k === "speech").length,
        noiseDuringPause: duringPause.filter((k) => k === "noise").length,
      };
    };

    const streaming = run(VAD_STREAMING_HANGOVER_MS);
    const offline = run(VAD_OFFLINE_HANGOVER_MS);

    // The streaming tail outlasts the whole pause, so the utterance stays ONE
    // caption; the offline tail gives up mid-pause and cuts it in two.
    expect(streaming.noiseDuringPause).toBe(0);
    expect(offline.noiseDuringPause).toBe(pauseFrames - 15);
    expect(streaming.speechFrames).toBeGreaterThan(offline.speechFrames);
  });

  it("builds a SmoothedVad in both profiles", () => {
    expect(
      buildSmoothedVad({ frameSamples: 512, streaming: true }),
    ).toBeInstanceOf(SmoothedVad);
    expect(buildSmoothedVad({ frameSamples: 512 })).toBeInstanceOf(SmoothedVad);
  });
});

describe("EnergyVad — the dependency-free detector", () => {
  it("treats digital silence as non-voice", () => {
    const vad = new EnergyVad(512);
    expect(vad.isVoice(new Float32Array(512))).toBe(false);
  });

  it("treats a loud frame as voice", () => {
    const vad = new EnergyVad(512);
    const loud = new Float32Array(512);
    for (let i = 0; i < loud.length; i++) loud[i] = 0.3 * Math.sin(i * 0.2);
    expect(vad.isVoice(loud)).toBe(true);
  });

  it("raises the noise floor in a loud room, so steady noise stops registering", () => {
    const vad = new EnergyVad(512);
    const noise = new Float32Array(512);
    for (let i = 0; i < noise.length; i++) noise[i] = 0.05 * Math.sin(i * 0.9);
    // First frame may read as voice; after the floor tracks up, steady noise
    // must stop counting as speech.
    for (let i = 0; i < 40; i++) vad.isVoice(noise);
    const verdicts = Array.from({ length: 5 }, () => vad.isVoice(noise));
    expect(verdicts.some((v) => v === false)).toBe(true);
  });

  it("reports RMS consistently with the exported rms helper", () => {
    const buf = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    expect(EnergyVad.rms(buf)).toBeCloseTo(0.5, 6);
  });

  it("returns 0 RMS for an empty buffer rather than NaN", () => {
    expect(EnergyVad.rms(new Float32Array(0))).toBe(0);
  });

  it("reset returns the floor to its initial value", () => {
    const vad = new EnergyVad(512);
    const noise = new Float32Array(512).fill(0.05);
    for (let i = 0; i < 40; i++) vad.isVoice(noise);
    vad.reset();
    expect(vad.isVoice(new Float32Array(512))).toBe(false);
  });
});
