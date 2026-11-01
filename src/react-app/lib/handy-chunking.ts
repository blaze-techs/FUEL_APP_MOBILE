/**
 * handy-chunking.ts — browser port of Handy's long-form chunking.
 *
 * Reverse-engineered from cjpais/Handy (`src-tauri/src/audio_toolkit/chunking.rs`,
 * itself "ported from pi-voice's chunking.ts"). Why it exists: a speech model's
 * accuracy degrades past 30–40 s of audio in one run, so long audio is cut at
 * PAUSES rather than at a fixed interval — a cut mid-word is what produces
 * garbled captions.
 *
 * Ported:
 *  - `speechSegments` — Silero's `get_speech_timestamps` (threshold 0.5, neg
 *    threshold 0.35, 250 ms min speech, 100 ms min silence, 30 ms speech pad).
 *  - `cutCandidates` / `planCuts` — the greedy cut planner: prefer a long pause
 *    near 30 s that leaves at least 5 s behind it, else a hard cut at 40 s.
 *  - `joinTranscripts` — joins chunk text with a space, EXCEPT between two
 *    characters of an unspaced script (Han, Hiragana, Katakana, Bopomofo,
 *    Thai, Lao, Khmer, Myanmar, and their punctuation). Without that rule CJK
 *    captions come out with stray spaces between every word.
 *
 * Everything is in samples of 16 kHz audio, never frames, so any detector's
 * frame size works with the same rules — exactly as Handy does it.
 */

import { WHISPER_SAMPLE_RATE } from "./handy-vad";

const RATE = WHISPER_SAMPLE_RATE;

/** Handy: `TARGET_SECONDS` — the pause position the planner aims for. */
export const TARGET_SECONDS = 30;
/** Handy: `MAX_CHUNK_SAMPLES` — audio longer than this is always cut. */
export const MAX_CHUNK_SAMPLES = 40 * RATE;
/** Handy: `MIN_CHUNK_SAMPLES` — no cut leaves a shorter tail than this. */
export const MIN_CHUNK_SAMPLES = 5 * RATE;

// Silero's `get_speech_timestamps` defaults, as Handy applies them.
const THRESHOLD = 0.5;
const NEG_THRESHOLD = THRESHOLD - 0.15;
const MIN_SPEECH_SAMPLES = (250 * RATE) / 1000;
const MIN_SILENCE_SAMPLES = (100 * RATE) / 1000;
const SPEECH_PAD_SAMPLES = (30 * RATE) / 1000;

/** A half-open sample range, `[start, end)`. */
export interface SampleRange {
  start: number;
  end: number;
}

/**
 * Handy's `speech_segments`: speech spans in samples from per-frame speech
 * probabilities, with Silero's hysteresis (a dip below 0.35 ends a span, a
 * span shorter than 250 ms is dropped) and its speech padding.
 */
export function speechSegments(
  probs: readonly number[],
  frameSamples: number,
  samples: number,
): SampleRange[] {
  const segments: SampleRange[] = [];
  let triggered = false;
  let start = 0;
  let tempEnd: number | null = null;

  for (let i = 0; i < probs.length; i++) {
    const at = i * frameSamples;
    const prob = probs[i];
    if (prob >= THRESHOLD) {
      tempEnd = null;
      if (!triggered) {
        triggered = true;
        start = at;
      }
      continue;
    }
    if (prob < NEG_THRESHOLD && triggered) {
      if (tempEnd === null) tempEnd = at;
      const end = tempEnd;
      if (at - end < MIN_SILENCE_SAMPLES) continue;
      if (end - start > MIN_SPEECH_SAMPLES) segments.push({ start, end });
      triggered = false;
      tempEnd = null;
    }
  }
  if (triggered && samples - start > MIN_SPEECH_SAMPLES) {
    segments.push({ start, end: samples });
  }

  // Speech padding: extend the outer edges outward, and split the silence
  // between neighbours so each segment gains at most half of it.
  for (let i = 0; i < segments.length; i++) {
    if (i === 0) {
      segments[0].start = Math.max(0, segments[0].start - SPEECH_PAD_SAMPLES);
    }
    if (i + 1 === segments.length) {
      segments[i].end = Math.min(samples, segments[i].end + SPEECH_PAD_SAMPLES);
      continue;
    }
    const silence = segments[i + 1].start - segments[i].end;
    const pad =
      silence < 2 * SPEECH_PAD_SAMPLES
        ? Math.floor(silence / 2)
        : SPEECH_PAD_SAMPLES;
    segments[i].end = Math.min(samples, segments[i].end + pad);
    segments[i + 1].start = Math.max(0, segments[i + 1].start - pad);
  }
  return segments;
}

/** A place a chunk may end: the middle of a pause. */
export interface CutCandidate {
  cut: number;
  gapSeconds: number;
}

/** Handy's `cut_candidates`: one candidate in the middle of each pause. */
export function cutCandidates(
  segments: readonly SampleRange[],
  samples: number,
): CutCandidate[] {
  const candidates: CutCandidate[] = [];
  let silenceStart = 0;
  const all: SampleRange[] = [...segments, { start: samples, end: samples }];
  for (const segment of all) {
    if (segment.start > silenceStart) {
      candidates.push({
        cut: Math.floor((silenceStart + segment.start) / 2),
        gapSeconds: (segment.start - silenceStart) / RATE,
      });
    }
    silenceStart = Math.max(silenceStart, segment.end);
  }
  return candidates;
}

/**
 * Handy's `plan_cuts`, verbatim: greedy left-to-right. Each cut is the
 * best-scoring pause 5–40 s after the previous one, preferring long pauses
 * near 30 s and ones that leave at least 5 s after them. With no pause it is a
 * hard cut at 40 s, or halfway when that would leave under 5 s. Audio of 40 s
 * or less is never cut. `candidates` must be in order.
 */
export function planCuts(
  candidates: readonly CutCandidate[],
  samples: number,
  from: number,
): number[] {
  const cuts: number[] = [];
  let start = from;
  let first = 0;

  while (samples - start > MAX_CHUNK_SAMPLES) {
    while (
      first < candidates.length &&
      candidates[first].cut < start + MIN_CHUNK_SAMPLES
    ) {
      first++;
    }

    let best: { cut: number; score: number } | null = null;
    let fallback: { cut: number; score: number } | null = null;

    for (let i = first; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (candidate.cut > start + MAX_CHUNK_SAMPLES) break;
      const position = (candidate.cut - start) / RATE;
      const offTarget =
        position > TARGET_SECONDS
          ? 0.1 * (position - TARGET_SECONDS)
          : 0.05 * (TARGET_SECONDS - position);
      const score = Math.min(candidate.gapSeconds, 1) - offTarget;
      if (
        samples - candidate.cut >= MIN_CHUNK_SAMPLES &&
        (best === null || score > best.score)
      ) {
        best = { cut: candidate.cut, score };
      }
      if (fallback === null || score > fallback.score) {
        fallback = { cut: candidate.cut, score };
      }
    }

    const hardCut =
      samples - start < MAX_CHUNK_SAMPLES + MIN_CHUNK_SAMPLES
        ? start + Math.floor((samples - start) / 2)
        : start + MAX_CHUNK_SAMPLES;

    const chosen = best ?? fallback;
    start = chosen ? chosen.cut : hardCut;
    cuts.push(start);
  }
  return cuts;
}

/**
 * Plan the cuts for a whole clip from its per-frame speech probabilities —
 * `speechSegments` → `cutCandidates` → `planCuts`, the same pipeline Handy
 * runs. `frameSamples` must match the detector that produced `probs`.
 */
export function planCutsForProbs(
  probs: readonly number[],
  frameSamples: number,
  samples: number,
  from = 0,
): number[] {
  const segments = speechSegments(probs, frameSamples, samples);
  return planCuts(cutCandidates(segments, samples), samples, from);
}

/** Cut `audio` at `cuts` (sample offsets), returning the chunk list. */
export function sliceAtCuts(
  audio: Float32Array,
  cuts: readonly number[],
): Float32Array[] {
  const out: Float32Array[] = [];
  let start = 0;
  for (const cut of cuts) {
    out.push(audio.subarray(start, cut));
    start = cut;
  }
  out.push(audio.subarray(start));
  return out;
}

// ---------------------------------------------------------------------------
// Text joining
// ---------------------------------------------------------------------------

/**
 * Handy's `UNSPACED` regex: scripts written without spaces between words, plus
 * the CJK punctuation ranges.
 */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\u3000-\u303f\uff00-\uffef]/u;

/** Whether a character belongs to a script that does not separate words. */
export function isUnspaced(ch: string): boolean {
  return UNSPACED.test(ch);
}

/**
 * Handy's `join_transcripts`: chunk texts in order, with a space between two
 * chunks unless either side is an unspaced script.
 */
export function joinTranscripts(texts: readonly string[]): string {
  let joined = "";
  let last: string | null = null;
  for (const raw of texts) {
    const text = raw.trim();
    if (!text) continue;
    const first = text[0];
    if (last !== null && !isUnspaced(last) && !isUnspaced(first)) {
      joined += " ";
    }
    joined += text;
    last = text[text.length - 1];
  }
  return joined;
}

/**
 * Handy's `agreed_language`: the language every chunk's model reported, if they
 * all agree. A disagreement leaves the language unknown rather than guessing.
 */
export function agreedLanguage(
  languages: readonly (string | null | undefined)[],
): string | null {
  const first = languages[0];
  if (!first) return null;
  for (const lang of languages) {
    if (lang !== first) return null;
  }
  return first;
}
