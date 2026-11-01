/**
 * handy-language-id.ts — browser port of Handy's language identification.
 *
 * Reverse-engineered from cjpais/Handy:
 *  - `src-tauri/src/language_detection/detector.rs` + `speech.rs` — AUDIO
 *    language ID. The detector is run on SPEECH, not on the whole clip:
 *    `speech_head` feeds VAD-kept frames until it has the window's worth of
 *    speech, "so a window of N seconds is N seconds of speech". Silence dilutes
 *    a language detector, so cutting it out is what makes a short window
 *    reliable.
 *  - `src-tauri/src/audio_toolkit/lang_id.rs` — TEXT language ID as
 *    last-resort evidence, gated on confidence: `is_reliable() && confidence
 *    >= 0.9`. Handy measured ~66% coverage at 99.9% accuracy; the gate is
 *    deliberately strict because a wrong accepted language is worse than none.
 *  - `src-tauri/src/managers/transcription/mod.rs` `agreed_language` — a
 *    detected language only counts when every chunk agrees.
 *  - `src-tauri/src/language_detection/policy.rs` — the model's own languages
 *    constrain what detection may return.
 *
 * Browser reality: Handy runs a dedicated spoken-language model plus
 * whatlang. A browser cannot ship either cheaply, so this module implements
 * the SAME DECISION SHAPE with what it does have:
 *  - audio LID from Whisper's own decoder (`whisper-tiny` is multilingual and
 *    reports a language), run on VAD speech only;
 *  - a text-based tie-breaker with an explicit confidence gate, mirroring
 *    whatlang's role;
 *  - `agreedLanguage` over chunk results, ported directly.
 *
 * The country hint is used the way Handy uses the user's language selection:
 * as a CONSTRAINT on the candidate set, never as a substitute for detection.
 */

import type { SampleRange } from "./handy-chunking";

/** Languages the caption picker offers, as ISO 639-1. */
export const CAPTION_LANGUAGES = [
  "en",
  "es",
  "fr",
  "zh",
  "hi",
  "ar",
  "ko",
  "pt",
  "de",
  "it",
  "ja",
  "ru",
  "sw",
  "tr",
  "nl",
] as const;

export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];

/**
 * Handy's `MIN_CONFIDENCE` for text language ID: `is_reliable()` plus this
 * confidence, or the detection is discarded. Calibrated by Handy on ~8k short
 * sentences; script-distinct languages are ~100% accurate at this gate while
 * Latin-script ones are 22–64% covered. Missed detections merely fall back.
 */
export const MIN_TEXT_LID_CONFIDENCE = 0.9;

/** Whisper's language token → ISO 639-1. Whisper names languages in English
 *  (`<|english|>`), so the table is a name→code map, not a code→code one. */
export const WHISPER_LANG_TO_ISO: Record<string, string> = {
  english: "en",
  spanish: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  russian: "ru",
  chinese: "zh",
  japanese: "ja",
  korean: "ko",
  arabic: "ar",
  hindi: "hi",
  swahili: "sw",
  turkish: "tr",
  // A few common extras Whisper reports that the picker does not list; kept so
  // the detected-language badge can name them instead of showing nothing.
  polish: "pl",
  ukrainian: "uk",
  vietnamese: "vi",
  thai: "th",
  indonesian: "id",
  malay: "ms",
  hebrew: "he",
  greek: "el",
  czech: "cs",
  swedish: "sv",
  danish: "da",
  finnish: "fi",
  norwegian: "no",
  romanian: "ro",
  hungarian: "hu",
  bengali: "bn",
  tamil: "ta",
  urdu: "ur",
  persian: "fa",
  filipino: "tl",
  tagalog: "tl",
};

/** ISO 639-1 → display label, for the "detected: X" badge. */
export const ISO_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  zh: "Chinese",
  hi: "Hindi",
  ar: "Arabic",
  ko: "Korean",
  pt: "Portuguese",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ru: "Russian",
  sw: "Swahili",
  tr: "Turkish",
  nl: "Dutch",
  pl: "Polish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  ms: "Malay",
  he: "Hebrew",
  el: "Greek",
  cs: "Czech",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  ro: "Romanian",
  hu: "Hungarian",
  bn: "Bengali",
  ta: "Tamil",
  ur: "Urdu",
  fa: "Persian",
  tl: "Filipino",
};

/** Normalize a model-reported language name or code to ISO 639-1. */
export function normalizeLanguageCode(raw: string): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (WHISPER_LANG_TO_ISO[key]) return WHISPER_LANG_TO_ISO[key];
  // Already a 2-letter ISO code?
  if (/^[a-z]{2}$/.test(key)) return key;
  // A 3-letter ISO 639-2/3 code or a BCP-47 tag: take the primary subtag.
  const primary = key.split(/[-_]/)[0];
  if (primary.length === 2 && /^[a-z]{2}$/.test(primary)) return primary;
  if (primary.length === 3) {
    const hit = Object.entries(WHISPER_LANG_TO_ISO).find(
      ([, iso]) => iso === primary,
    );
    if (hit) return hit[1];
  }
  return null;
}

/** The label to show for a language code (falls back to the upper-cased code). */
export function languageLabel(code: string): string {
  if (!code) return "";
  return ISO_LABELS[code] || code.toUpperCase();
}

// ---------------------------------------------------------------------------
// Audio LID over VAD speech (Handy's speech.rs + detector.rs shape)
// ---------------------------------------------------------------------------

/**
 * Handy's `speech_head`: the first `maxSamples` of SPEECH in `audio`, with
 * silence cut out by the VAD. Concatenating only voiced frames is what makes a
 * 3-second window actually carry 3 seconds of speech.
 */
export function speechHead(
  audio: Float32Array,
  segments: readonly SampleRange[],
  maxSamples: number,
): Float32Array {
  const out = new Float32Array(Math.min(maxSamples, audio.length));
  let written = 0;
  for (const seg of segments) {
    if (written >= maxSamples) break;
    const start = Math.max(0, seg.start);
    const end = Math.min(audio.length, seg.end);
    if (end <= start) continue;
    const take = Math.min(end - start, maxSamples - written);
    out.set(audio.subarray(start, start + take), written);
    written += take;
  }
  return out.subarray(0, written);
}

/** One detector candidate, as Handy's `Identified` carries them. */
export interface LanguageCandidate {
  code: string;
  probability: number;
}

export interface IdentifiedLanguage {
  /** ISO 639-1 code, or null when nothing passed the gate. */
  code: string | null;
  /** Every candidate the detector produced, best first. */
  candidates: LanguageCandidate[];
  /** Probability mass the detector assigned to the allowed set. */
  allowedMass: number;
  /** Where the answer came from. */
  source: "audio" | "text" | "none";
}

/** How much a candidate from the country's language list is boosted. */
const ALLOWED_BOOST = 1.15;

/**
 * Rank candidates the way Handy's detector does — highest probability first.
 *
 * `allowed` is a PREFERENCE, not a veto. Handy can hard-constrain because its
 * `allowed` list is "the languages the person speaks" (a user setting); the
 * browser's equivalent input is the channel's COUNTRY, which is a much weaker
 * signal. Plenty of channels broadcast in a language their country does not
 * speak — France 24 English, DW English, Al Jazeera English, TRT World, NHK
 * World — so vetoing a strong detection on geographic grounds would caption
 * them in the wrong language. Allowed candidates are nudged up instead, which
 * decides a close call without overriding a confident one.
 */
export function rankCandidates(
  candidates: readonly LanguageCandidate[],
  allowed: readonly string[] = [],
): LanguageCandidate[] {
  const allowedSet =
    allowed.length > 0 ? new Set(allowed.map((a) => a.toLowerCase())) : null;
  return candidates
    .map((c) => ({
      code: normalizeLanguageCode(c.code),
      probability: c.probability,
    }))
    .filter((c): c is LanguageCandidate => c.code !== null)
    .map((c) => ({
      code: c.code,
      probability:
        allowedSet !== null && allowedSet.has(c.code)
          ? Math.min(1, c.probability * ALLOWED_BOOST)
          : c.probability,
    }))
    .sort((a, b) => b.probability - a.probability);
}

/**
 * Sum the probability the detector put on the allowed set — Handy's
 * `allowed_mass`. A low mass means the detector heard a language outside the
 * country's list, which is worth REPORTING (the badge says "assumed") even
 * though it is not grounds for discarding a confident detection.
 */
export function allowedMass(
  candidates: readonly LanguageCandidate[],
  allowed: readonly string[],
): number {
  if (allowed.length === 0) return 1;
  const allowedSet = new Set(allowed.map((a) => a.toLowerCase()));
  return candidates.reduce((sum, c) => {
    const iso = normalizeLanguageCode(c.code);
    return iso && allowedSet.has(iso) ? sum + c.probability : sum;
  }, 0);
}

/**
 * The audio-LID decision: take the highest-probability candidate, but only
 * when it clears `minProbability`. Below that the detector was not sure, and
 * reporting a coin-flip as a language is worse than falling through to the
 * transcript and then the country.
 */
export function identifyFromAudio(
  candidates: readonly LanguageCandidate[],
  allowed: readonly string[] = [],
  minProbability = 0.5,
): IdentifiedLanguage {
  const ranked = rankCandidates(candidates, allowed);
  const mass = allowedMass(candidates, allowed);
  if (ranked.length === 0 || ranked[0].probability < minProbability) {
    return {
      code: null,
      candidates: ranked,
      allowedMass: mass,
      source: "none",
    };
  }
  return {
    code: ranked[0].code,
    candidates: ranked,
    allowedMass: mass,
    source: "audio",
  };
}

// ---------------------------------------------------------------------------
// Text LID (Handy's lang_id.rs shape: confidence-gated, fails closed)
// ---------------------------------------------------------------------------

/**
 * Script ranges used as text evidence. This is the browser stand-in for
 * whatlang: instead of a statistical model it identifies a language only when
 * the SCRIPT is unambiguous, which is the same "fail closed on doubt" posture
 * Handy's 0.9 gate enforces (script-distinct languages are the ones Handy's
 * gate scores at ~100%).
 */
const SCRIPT_RANGES: { code: string; re: RegExp; confidence: number }[] = [
  {
    code: "ja",
    re: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
    confidence: 0.99,
  },
  { code: "ko", re: /[\p{Script=Hangul}]/u, confidence: 0.99 },
  { code: "ar", re: /[\p{Script=Arabic}]/u, confidence: 0.99 },
  { code: "ru", re: /[\p{Script=Cyrillic}]/u, confidence: 0.95 },
  { code: "el", re: /[\p{Script=Greek}]/u, confidence: 0.99 },
  { code: "he", re: /[\p{Script=Hebrew}]/u, confidence: 0.99 },
  { code: "th", re: /[\p{Script=Thai}]/u, confidence: 0.99 },
  { code: "hi", re: /[\p{Script=Devanagari}]/u, confidence: 0.99 },
  { code: "bn", re: /[\p{Script=Bengali}]/u, confidence: 0.99 },
  { code: "ta", re: /[\p{Script=Tamil}]/u, confidence: 0.99 },
  // Han is deliberately BELOW the gate: Japanese writes Han alongside kana, so
  // Han-only text cannot distinguish Chinese from Japanese. Failing closed
  // leaves the choice to the audio detector rather than claiming Chinese.
  { code: "zh", re: /[\p{Script=Han}]/u, confidence: 0.85 },
];

/**
 * Text language ID with Handy's fail-closed posture: a code is returned only
 * for a CONFIDENT script hit, and `null` otherwise.
 *
 * `allowed` is a preference here too, for the same reason as the audio path —
 * a country does not determine a broadcast language. It only breaks a tie when
 * more than one script range matches, which in practice means it almost never
 * applies; a script is usually definitive on its own.
 */
export function identifyFromText(
  text: string,
  allowed: readonly string[] = [],
): IdentifiedLanguage {
  const trimmed = (text || "").trim();
  if (trimmed.length < 8) {
    // Handy's test `short_ambiguous_text_returns_none`: too little text to be
    // reliable, so fail closed rather than guess.
    return { code: null, candidates: [], allowedMass: 0, source: "none" };
  }

  // Every script range that matches AND clears the confidence gate.
  const hits = SCRIPT_RANGES.filter(
    (r) => r.confidence >= MIN_TEXT_LID_CONFIDENCE && r.re.test(trimmed),
  );
  if (hits.length === 0) {
    return { code: null, candidates: [], allowedMass: 0, source: "none" };
  }

  const allowedSet =
    allowed.length > 0 ? new Set(allowed.map((a) => a.toLowerCase())) : null;
  // Prefer a hit the country's list contains; otherwise take the most
  // confident. Kana outranks Han for Japanese because `hits` preserves the
  // declaration order and kana is declared first.
  const preferred =
    (allowedSet && hits.find((h) => allowedSet.has(h.code))) || hits[0];

  return {
    code: preferred.code,
    candidates: [{ code: preferred.code, probability: preferred.confidence }],
    allowedMass: allowedSet?.has(preferred.code) ? preferred.confidence : 0,
    source: "text",
  };
}

// ---------------------------------------------------------------------------
// Whisper's own audio LID (Handy's primary evidence)
// ---------------------------------------------------------------------------

/** The tokenizer surface needed to name the language token. */
export interface TokenizerLike {
  decode(tokens: number[], options?: { skip_special_tokens?: boolean }): string;
}

/** The model surface needed to run a language probe. */
export interface WhisperModelLike {
  generate(inputs: unknown, options: Record<string, unknown>): Promise<unknown>;
}

/**
 * Run Whisper's built-in AUDIO language identification.
 *
 * This is the browser equivalent of Handy's dedicated spoken-language detector
 * (`language_detection/detector.rs`), and it is the evidence that matters for
 * Latin-script languages: a script cannot tell French from Spanish from
 * English, and `identifyFromText` correctly refuses to guess. Without this the
 * country hint would decide, which is exactly the mistake that captions
 * France 24 English as French.
 *
 * Whisper emits the language as the token right after `<|startoftranscript|>`,
 * so a two-token generation IS a language-ID run. Anything unexpected (a
 * different token layout, a token that does not name a language, a runtime
 * without the needed surface) returns `[]` — never a guess.
 *
 * The model picks one language, so the candidate list holds one entry.
 */
export async function detectAudioLanguage(
  model: WhisperModelLike | null | undefined,
  tokenizer: TokenizerLike | null | undefined,
  inputFeatures: unknown,
): Promise<LanguageCandidate[]> {
  if (!model || !tokenizer || typeof model.generate !== "function") return [];
  try {
    const out = await model.generate(inputFeatures, { max_new_tokens: 2 });
    const sequence = extractSequence(out);
    if (!sequence) return [];
    // Scan the first few tokens: the language token follows the start token,
    // but the exact index differs between export revisions.
    for (const token of sequence.slice(0, 3)) {
      const name = decodeTokenName(tokenizer, token);
      if (!name) continue;
      const iso = normalizeLanguageCode(name);
      if (iso) return [{ code: iso, probability: 1 }];
    }
    return [];
  } catch {
    return []; // no audio LID — the transcript and country still decide
  }
}

/** Pull the token sequence out of whatever `generate` returned. */
function extractSequence(out: unknown): number[] | null {
  if (!out) return null;
  if (Array.isArray(out) && out.length > 0) {
    const first = out[0];
    if (Array.isArray(first)) return first as number[];
    if (typeof first === "number") return out as number[];
  }
  const sequences = (out as { sequences?: unknown }).sequences;
  if (Array.isArray(sequences) && sequences.length > 0) {
    const first = sequences[0];
    if (Array.isArray(first)) return first as number[];
  }
  return null;
}

/**
 * Decode one token and read the language name out of it. Whisper writes the
 * language as `<|english|>` (a name, not a code), which is why the result goes
 * through `normalizeLanguageCode`. Returns null for a normal text token.
 */
function decodeTokenName(
  tokenizer: TokenizerLike,
  token: number,
): string | null {
  try {
    const text = tokenizer.decode([token], { skip_special_tokens: false });
    if (!text) return null;
    const match = /<\|([a-z_]+)\|>/i.exec(text);
    if (!match) return null;
    const name = match[1].toLowerCase();
    // `<|startoftranscript|>`, `<|transcribe|>`, `<|notimestamps|>` and the
    // timestamp markers are not languages.
    if (name === "startoftranscript" || name === "endoftext") return null;
    if (name === "transcribe" || name === "translate") return null;
    if (name === "notimestamps" || name.startsWith("timestamp")) return null;
    return name;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Country hint → the preferred set (Handy's "the languages the person speaks")
// ---------------------------------------------------------------------------

/**
 * The languages plausibly SPOKEN in a country, used as a PREFERENCE for
 * detection. Handy constrains detection to "the languages the person speaks"
 * (`auto_language`'s `compatible` list); this is the geographic equivalent, and
 * it is a constraint — never an answer. A stream from Belgium is allowed
 * {nl, fr, en} and the detector still has to pick.
 */
const COUNTRY_LANGUAGES: Record<string, string[]> = {
  us: ["en", "es"],
  gb: ["en"],
  ca: ["en", "fr"],
  au: ["en"],
  nz: ["en"],
  ie: ["en"],
  ke: ["en", "sw"],
  ng: ["en"],
  gh: ["en"],
  ug: ["en", "sw"],
  tz: ["sw", "en"],
  za: ["en"],
  in: ["hi", "en", "ta", "bn", "ur"],
  pk: ["ur", "en"],
  bd: ["bn", "en"],
  es: ["es"],
  mx: ["es"],
  ar: ["es"],
  co: ["es"],
  cl: ["es"],
  pe: ["es"],
  ve: ["es"],
  br: ["pt"],
  pt: ["pt"],
  fr: ["fr"],
  be: ["nl", "fr"],
  ch: ["de", "fr", "it"],
  de: ["de"],
  at: ["de"],
  it: ["it"],
  nl: ["nl"],
  ru: ["ru"],
  ua: ["uk", "ru"],
  cn: ["zh"],
  tw: ["zh"],
  hk: ["zh", "en"],
  sg: ["en", "zh", "ms"],
  jp: ["ja"],
  kr: ["ko"],
  sa: ["ar"],
  ae: ["ar", "en"],
  eg: ["ar"],
  ma: ["ar", "fr"],
  dz: ["ar", "fr"],
  qa: ["ar"],
  tr: ["tr"],
  il: ["he", "en"],
  gr: ["el"],
  pl: ["pl"],
  cz: ["cs"],
  se: ["sv"],
  dk: ["da"],
  fi: ["fi"],
  no: ["no"],
  ro: ["ro"],
  hu: ["hu"],
  vn: ["vi"],
  th: ["th"],
  id: ["id"],
  my: ["ms", "en"],
  ph: ["tl", "en"],
  ir: ["fa"],
};

/** The languages plausibly spoken in `country` (lower-case ISO-2). */
export function languagesForCountry(country: string): string[] {
  return COUNTRY_LANGUAGES[(country || "").trim().toLowerCase()] || [];
}

export interface ResolvedCaptionLanguage {
  /** ISO 639-1 code, or null when nothing could be determined. */
  code: string | null;
  /** How the answer was reached. */
  source: "detected" | "text" | "country" | "none";
  /** Confidence in the answer (0 when it is only an inference). */
  confidence: number;
}

/**
 * Resolve the caption language for a stream, in Handy's evidence order:
 *
 *  1. **Audio LID** on the speech — the strongest signal, because it hears the
 *     stream rather than inferring from metadata.
 *  2. **Text LID** on the transcript — a confident script hit.
 *  3. **Country hint** — a last resort, so a stream always has a sensible
 *     answer rather than "unknown".
 *
 * The country only ever PREFERS a language; it never vetoes a confident
 * detection, because a country does not determine a broadcast language.
 * Returns null only when there is genuinely no evidence at all.
 */
export function resolveCaptionLanguage(opts: {
  /** Candidates from the audio detector (Whisper's reported language). */
  audioCandidates?: readonly LanguageCandidate[];
  /** The transcript so far, for the text tie-breaker. */
  transcript?: string;
  /** The channel's ISO-2 country. */
  country?: string;
  /** A user-chosen language; wins outright when set. */
  preferred?: string;
}): ResolvedCaptionLanguage {
  const { audioCandidates, transcript, country, preferred } = opts;
  const allowed = languagesForCountry(country || "");

  if (preferred && preferred !== "auto") {
    const iso = normalizeLanguageCode(preferred);
    if (iso) return { code: iso, source: "detected", confidence: 1 };
  }

  if (audioCandidates && audioCandidates.length > 0) {
    const fromAudio = identifyFromAudio(audioCandidates, allowed);
    if (fromAudio.code) {
      return {
        code: fromAudio.code,
        source: "detected",
        confidence: fromAudio.candidates[0]?.probability ?? 0,
      };
    }
  }

  const fromText = identifyFromText(transcript || "", allowed);
  if (fromText.code) {
    return {
      code: fromText.code,
      source: "text",
      confidence: fromText.candidates[0]?.probability ?? 0,
    };
  }

  // Last resort: the country's primary language. Confidence 0 marks it as an
  // inference, not a detection, so the badge can say "assumed".
  const fallback = allowed[0];
  if (fallback) {
    return { code: fallback, source: "country", confidence: 0 };
  }
  return { code: null, source: "none", confidence: 0 };
}
