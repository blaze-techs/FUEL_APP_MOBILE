import { describe, it, expect } from "vitest";
import { detectAudioLanguage } from "@/react-app/lib/handy-language-id";

/**
 * The audio LID reads Whisper's `<|startoftranscript|><|english|>` prefix.
 *
 * Nothing else in the suite exercises the real Transformers.js call shape, and
 * a wrong index or a missed wrapper field would silently degrade every caption
 * to country-guessing. These stubs reproduce the two output shapes the library
 * actually returns (a bare tensor and a `{ sequences }` object) plus the
 * tokenizer contract, so the parse path is pinned rather than assumed.
 */

/** Whisper's own vocabulary, in the order it emits the prefix. */
const TOKENS: Record<number, string> = {
  50257: "<|startoftranscript|>",
  50258: "<|en|>",
  50259: "<|transcribe|>",
  50260: "<|notimestamps|>",
  50261: "<|fr|>",
  50262: "<|zh|>",
  100: "hello",
};

const tokenizer = {
  decode: (ids: number[]) =>
    ids
      .map((i) => TOKENS[i])
      .filter(Boolean)
      .join(""),
};

describe("audio language identification", () => {
  it("reads the language token out of a bare tensor", async () => {
    const model = {
      generate: async () => [[50257, 50258, 50259]],
    };
    const out = await detectAudioLanguage(model, tokenizer, {});
    expect(out).toEqual([{ code: "en", probability: 1 }]);
  });

  it("reads the language token out of a `{ sequences }` object", async () => {
    // Transformers.js returns this shape for some export revisions.
    const model = {
      generate: async () => ({ sequences: [[50257, 50261, 50259]] }),
    };
    const out = await detectAudioLanguage(model, tokenizer, {});
    expect(out).toEqual([{ code: "fr", probability: 1 }]);
  });

  it("scans past the start token rather than trusting a fixed index", async () => {
    // The exact position differs between revisions; a version that emitted an
    // extra token first must still be read correctly.
    const model = {
      generate: async () => [[50257, 50259, 50262]],
    };
    const out = await detectAudioLanguage(model, tokenizer, {});
    expect(out).toEqual([{ code: "zh", probability: 1 }]);
  });

  it("never mistakes a control token for a language", async () => {
    // `<|transcribe|>` / `<|notimestamps|>` sit alongside the language token;
    // reading one of those as a language would caption everything as that code.
    const model = {
      generate: async () => [[50259, 50260]],
    };
    expect(await detectAudioLanguage(model, tokenizer, {})).toEqual([]);
  });

  it("returns no candidates when the model is unusable", async () => {
    // Degrades to transcript + country evidence rather than throwing.
    expect(await detectAudioLanguage(null, tokenizer, {})).toEqual([]);
    expect(await detectAudioLanguage({}, tokenizer, {})).toEqual([]);
    expect(await detectAudioLanguage({ generate: 1 }, tokenizer, {})).toEqual(
      [],
    );
  });

  it("swallows a generate() rejection so captioning continues", async () => {
    const model = {
      generate: async () => {
        throw new Error("onnx session died");
      },
    };
    expect(await detectAudioLanguage(model, tokenizer, {})).toEqual([]);
  });

  it("returns no candidates for an unrecognised output shape", async () => {
    const model = { generate: async () => "nonsense" };
    expect(await detectAudioLanguage(model, tokenizer, {})).toEqual([]);
  });

  it("passes the processed input features through to generate", async () => {
    // The probe must feed the SAME pre-processed audio the ASR uses; passing
    // the raw Float32Array would produce a meaningless token.
    let received: unknown;
    const features = { input_features: new Float32Array(80 * 3000) };
    const model = {
      generate: async (input: unknown) => {
        received = input;
        return [[50257, 50258]];
      },
    };
    await detectAudioLanguage(model, tokenizer, features);
    expect(received).toBe(features);
  });
});
