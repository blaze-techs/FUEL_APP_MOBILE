/**
 * End-to-end proof that captions actually transcribe speech.
 *
 * probe-model-load.mjs proves the model DOWNLOADS. This proves it WORKS:
 * it runs real audio through the same class-based pipeline the engine
 * builds, then reports the transcript and the language Whisper locked onto.
 *
 * The model loading is necessary but not sufficient — a pipeline can load
 * and still return empty text if the input is mis-shaped, which is exactly
 * the failure mode a captions feature has to rule out.
 *
 * Usage: node scripts/probe-caption-transcribe.mjs [origin]
 */
import { chromium } from "playwright";

const ORIGIN = process.argv[2] || "https://fuel-app-mobile.pages.dev";
const SAMPLE =
  "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav";

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await (await browser.newContext()).newPage();

await page.goto(`${ORIGIN}/`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});

const result = await page.evaluate(
  async ({ sample }) => {
    const started = Date.now();
    try {
      // Resolve the app's own bundled transformers chunk (script-src does not
      // allow the CDN copy, so importing that would fail for an unrelated
      // reason).
      const html = await (await fetch("./", { cache: "no-store" })).text();
      const entry = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
      const entrySrc = await (
        await fetch(`./${entry}`, { cache: "no-store" })
      ).text();
      let chunk = /assets\/transformers-[A-Za-z0-9_-]+\.js/.exec(entrySrc)?.[0];
      if (!chunk) {
        const news = /assets\/News-[A-Za-z0-9_-]+\.js/.exec(entrySrc)?.[0];
        if (news) {
          const s = await (
            await fetch(`./${news}`, { cache: "no-store" })
          ).text();
          chunk = /assets\/transformers-[A-Za-z0-9_-]+\.js/.exec(s)?.[0];
        }
      }
      if (!chunk) return { ok: false, error: "no transformers chunk" };

      const lib = await import(`./${chunk}`);
      lib.env.allowLocalModels = false;
      lib.env.useBrowserCache = false;
      lib.env.remoteHost = "https://huggingface.co/";
      lib.env.backends.onnx.wasm.numThreads = 1;

      const {
        AutoModelForSpeechSeq2Seq,
        AutoProcessor,
        AutoTokenizer,
        AutomaticSpeechRecognitionPipeline,
      } = lib;
      const model = await AutoModelForSpeechSeq2Seq.from_pretrained(
        "Xenova/whisper-tiny",
        { quantized: true },
      );
      const tokenizer = await AutoTokenizer.from_pretrained(
        "Xenova/whisper-tiny",
      );
      const processor = await AutoProcessor.from_pretrained(
        "Xenova/whisper-tiny",
      );
      const pipe = new AutomaticSpeechRecognitionPipeline({
        task: "automatic-speech-recognition",
        model,
        tokenizer,
        processor,
      });

      // Decode the sample to the 16 kHz mono float PCM Whisper expects.
      const buf = await (await fetch(sample)).arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 16000 });
      const decoded = await ctx.decodeAudioData(buf);
      const audio = decoded.getChannelData(0);

      const out = await pipe(audio, { language: null, task: "transcribe" });

      // Whisper's own <|startoftranscript|> token is the primary evidence for
      // the spoken language — the requirement is to caption in the language
      // ACTUALLY spoken, not the one the channel's country suggests. Mirror
      // the engine's call shape exactly: features are the FIRST argument
      // (not an `input_features` property), and the language token sits in
      // the first few emitted tokens.
      let detected = null;
      try {
        const feats = (await pipe.processor(audio)).input_features;
        const raw = await pipe.model.generate(feats, { max_new_tokens: 2 });
        const seq = Array.isArray(raw?.[0])
          ? raw[0]
          : (raw?.sequences?.[0] ?? []);
        for (const tok of seq.slice(0, 3)) {
          const name = tokenizer.decode([Number(tok)], {
            skip_special_tokens: false,
          });
          if (/<\|[a-z]{2,3}\|>/.test(name)) {
            detected = name.match(/<\|([a-z]{2,3})\|>/)?.[1] ?? null;
            break;
          }
        }
      } catch {
        /* LID is best-effort; the transcript above is the main assertion. */
      }

      return {
        ok: true,
        chunk,
        seconds: +(audio.length / 16000).toFixed(1),
        text: String(out?.text || "").trim(),
        detected,
        ms: Date.now() - started,
      };
    } catch (e) {
      return {
        ok: false,
        ms: Date.now() - started,
        error: String(e).slice(0, 220),
      };
    }
  },
  { sample: SAMPLE },
);

console.log(`\n=== ${ORIGIN} ===`);
if (!result.ok) {
  console.log(`  FAILED  ${result.error}`);
} else {
  console.log(`  audio      : ${result.seconds}s`);
  console.log(`  transcript : ${JSON.stringify(result.text)}`);
  console.log(`  detected   : ${JSON.stringify(result.detected)}`);
  console.log(`  elapsed    : ${result.ms} ms`);
}

await browser.close();
process.exit(result.ok && result.text ? 0 : 1);
