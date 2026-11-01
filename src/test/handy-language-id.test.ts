/**
 * Tests for the Handy-derived language identification.
 *
 * The behaviour that matters is the GATE: Handy's posture is "fail closed",
 * because a wrong accepted language is worse than no answer. These tests pin
 * that, plus the constraint that the channel's country narrows the candidate
 * set without ever BEING the answer.
 */
import { describe, it, expect } from "vitest";
import {
  CAPTION_LANGUAGES,
  MIN_TEXT_LID_CONFIDENCE,
  WHISPER_LANG_TO_ISO,
  allowedMass,
  identifyFromAudio,
  identifyFromText,
  languageLabel,
  languagesForCountry,
  normalizeLanguageCode,
  rankCandidates,
  resolveCaptionLanguage,
  speechHead,
} from "@/react-app/lib/handy-language-id";

describe("normalizeLanguageCode", () => {
  it("maps Whisper's language NAMES to ISO 639-1", () => {
    expect(normalizeLanguageCode("english")).toBe("en");
    expect(normalizeLanguageCode("spanish")).toBe("es");
    expect(normalizeLanguageCode("chinese")).toBe("zh");
    expect(normalizeLanguageCode("japanese")).toBe("ja");
    expect(normalizeLanguageCode("swahili")).toBe("sw");
  });

  it("accepts a 2-letter code as-is, case-insensitively", () => {
    expect(normalizeLanguageCode("FR")).toBe("fr");
    expect(normalizeLanguageCode(" de ")).toBe("de");
  });

  it("normalizes a BCP-47 regional tag to its primary subtag", () => {
    // Handy's own test: `pt-BR` and `PT_br` normalize to `pt`.
    expect(normalizeLanguageCode("pt-BR")).toBe("pt");
    expect(normalizeLanguageCode("PT_br")).toBe("pt");
    expect(normalizeLanguageCode("zh-Hant")).toBe("zh");
  });

  it("returns null for something that is not a language", () => {
    expect(normalizeLanguageCode("")).toBeNull();
    expect(normalizeLanguageCode("klingon")).toBeNull();
  });
});

describe("languageLabel", () => {
  it("names the languages the caption picker offers", () => {
    for (const code of CAPTION_LANGUAGES) {
      expect(languageLabel(code)).not.toBe("");
      expect(languageLabel(code)).not.toBe(code.toUpperCase());
    }
  });

  it("falls back to the upper-cased code for an unlisted language", () => {
    expect(languageLabel("xx")).toBe("XX");
  });

  it("returns an empty string for no code", () => {
    expect(languageLabel("")).toBe("");
  });
});

describe("speechHead (Handy's speech.rs)", () => {
  it("keeps only speech, up to the requested window", () => {
    // Handy's own test: [silence, silence, speech..., silence, speech...]
    // and the first 3 samples of speech come back.
    const audio = new Float32Array([0, 0, 1, 2, 0, 0, 3, 4, 5, 6]);
    const segments = [
      { start: 2, end: 4 },
      { start: 6, end: 10 },
    ];
    expect(Array.from(speechHead(audio, segments, 3))).toEqual([1, 2, 3]);
    expect(Array.from(speechHead(audio, segments, 100))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("returns nothing when there is no speech", () => {
    expect(speechHead(new Float32Array(6), [], 4).length).toBe(0);
  });
});

describe("rankCandidates / allowedMass (Handy's detector.rs)", () => {
  it("orders candidates by probability, best first", () => {
    const ranked = rankCandidates(
      [
        { code: "fr", probability: 0.3 },
        { code: "en", probability: 0.6 },
      ],
      [],
    );
    expect(ranked.map((c) => c.code)).toEqual(["en", "fr"]);
  });

  it("boosts a candidate the country's list contains, so a close call goes the expected way", () => {
    const ranked = rankCandidates(
      [
        { code: "es", probability: 0.5 },
        { code: "en", probability: 0.48 },
      ],
      ["en"],
    );
    expect(ranked[0].code).toBe("en");
  });

  it("does NOT veto a confident detection outside the country's list", () => {
    // France 24 English / DW English / Al Jazeera English / TRT World / NHK
    // World all broadcast in a language their country does not speak. A veto
    // would caption them in the wrong language, so geography only nudges.
    const ranked = rankCandidates(
      [
        { code: "en", probability: 0.95 },
        { code: "fr", probability: 0.05 },
      ],
      ["fr"],
    );
    expect(ranked[0].code).toBe("en");
  });

  it("an empty allowed set means no preference", () => {
    const ranked = rankCandidates([{ code: "de", probability: 0.4 }], []);
    expect(ranked.length).toBe(1);
    expect(allowedMass([{ code: "de", probability: 0.4 }], [])).toBe(1);
  });

  it("sums only the probability mass on the allowed set", () => {
    const cands = [
      { code: "en", probability: 0.5 },
      { code: "fr", probability: 0.3 },
      { code: "de", probability: 0.2 },
    ];
    expect(allowedMass(cands, ["en", "fr"])).toBeCloseTo(0.8, 6);
  });

  it("drops a candidate whose code cannot be normalized", () => {
    expect(
      rankCandidates([{ code: "klingon", probability: 0.9 }], []).length,
    ).toBe(0);
  });
});

describe("identifyFromAudio — the confidence gate", () => {
  it("accepts a confident detection", () => {
    const out = identifyFromAudio(
      [
        { code: "fr", probability: 0.95 },
        { code: "en", probability: 0.05 },
      ],
      ["fr", "en"],
    );
    expect(out.code).toBe("fr");
    expect(out.source).toBe("audio");
  });

  it("REFUSES when no candidate clears the confidence floor", () => {
    // A coin-flip between two languages must not be reported as an answer —
    // it falls through to the transcript and then the country.
    const out = identifyFromAudio(
      [
        { code: "en", probability: 0.4 },
        { code: "es", probability: 0.35 },
      ],
      ["fr"],
    );
    expect(out.code).toBeNull();
    expect(out.source).toBe("none");
  });

  it("accepts a confident detection even when the country list disagrees", () => {
    const out = identifyFromAudio([{ code: "en", probability: 0.9 }], ["fr"]);
    expect(out.code).toBe("en");
    expect(out.allowedMass).toBe(0); // reported, but not disqualifying
  });

  it("refuses when there are no candidates at all", () => {
    expect(identifyFromAudio([], ["en"]).code).toBeNull();
  });
});

describe("identifyFromText — confidence-gated, fails closed", () => {
  it("identifies a script-distinct language", () => {
    expect(identifyFromText("これは日本語のテストです").code).toBe("ja");
    expect(identifyFromText("مرحبا بالعالم هذا اختبار").code).toBe("ar");
    expect(identifyFromText("한국어 테스트 문장입니다").code).toBe("ko");
    expect(identifyFromText("это русский тестовый текст").code).toBe("ru");
  });

  it("returns null for short ambiguous text, like Handy's own test", () => {
    // Handy: `short_ambiguous_text_returns_none` — "um ok" must not be a
    // confident detection.
    expect(identifyFromText("um ok").code).toBeNull();
    expect(identifyFromText("").code).toBeNull();
  });

  it("never names a language outside the allowed set when it would otherwise guess", () => {
    // The country preference only decides among genuinely matching scripts.
    // Here the ONLY script hit is Japanese and the country list is {en, fr},
    // so the answer is still Japanese — the transcript is definitive and the
    // country does not get to overrule it.
    expect(identifyFromText("これは日本語です", ["en", "fr"]).code).toBe("ja");
  });

  it("reports Han-only text as ambiguous (Japanese uses Han too)", () => {
    // Han alone is below the gate, so Chinese is not claimed on Han alone.
    const out = identifyFromText("这是一个中文句子测试内容");
    expect(out.code).toBeNull();
    expect(MIN_TEXT_LID_CONFIDENCE).toBe(0.9);
  });

  it("prefers Japanese when kana is present, even alongside Han", () => {
    expect(identifyFromText("日本語のテストです").code).toBe("ja");
  });
});

describe("languagesForCountry — the constraint, not the answer", () => {
  it("lists the languages plausibly spoken in a country", () => {
    expect(languagesForCountry("fr")).toEqual(["fr"]);
    expect(languagesForCountry("ke")).toContain("sw");
    expect(languagesForCountry("in")).toContain("hi");
    expect(languagesForCountry("BE")).toContain("nl");
  });

  it("returns nothing for an unknown country rather than inventing a language", () => {
    expect(languagesForCountry("zz")).toEqual([]);
    expect(languagesForCountry("")).toEqual([]);
  });
});

describe("resolveCaptionLanguage — Handy's evidence order", () => {
  it("a user's explicit choice wins outright", () => {
    const out = resolveCaptionLanguage({
      audioCandidates: [{ code: "de", probability: 0.9 }],
      country: "de",
      preferred: "es",
    });
    expect(out.code).toBe("es");
  });

  it("uses the audio detection ahead of the country hint", () => {
    const out = resolveCaptionLanguage({
      audioCandidates: [{ code: "en", probability: 0.95 }],
      transcript: "hello there this is english",
      country: "fr",
    });
    expect(out.code).toBe("en");
    expect(out.source).toBe("detected");
  });

  it("falls back to the transcript's script when audio gives nothing", () => {
    const out = resolveCaptionLanguage({
      audioCandidates: [],
      transcript: "これは日本語のテストです",
      country: "jp",
    });
    expect(out.code).toBe("ja");
    expect(out.source).toBe("text");
  });

  it("uses the country only as a last resort, and flags it as an assumption", () => {
    const out = resolveCaptionLanguage({
      audioCandidates: [],
      transcript: "plain latin text with no script evidence at all",
      country: "de",
    });
    expect(out.code).toBe("de");
    expect(out.source).toBe("country");
    // confidence 0 marks it an inference, not a detection.
    expect(out.confidence).toBe(0);
  });

  it("returns null when there is no evidence at all", () => {
    const out = resolveCaptionLanguage({
      audioCandidates: [],
      transcript: "",
      country: "zz",
    });
    expect(out.code).toBeNull();
    expect(out.source).toBe("none");
  });

  it("reports an English broadcast on a French channel as English, not French", () => {
    // The real case this guards: France 24 English, DW English, Al Jazeera
    // English, TRT World, NHK World all broadcast in a language their country
    // does not speak. Geography must not overrule what is actually heard.
    const out = resolveCaptionLanguage({
      audioCandidates: [{ code: "en", probability: 0.95 }],
      transcript: "",
      country: "fr",
    });
    expect(out.code).toBe("en");
  });
});

describe("WHISPER_LANG_TO_ISO", () => {
  it("covers every language the caption picker offers", () => {
    const values = new Set(Object.values(WHISPER_LANG_TO_ISO));
    for (const code of CAPTION_LANGUAGES) {
      expect(values.has(code)).toBe(true);
    }
  });
});
