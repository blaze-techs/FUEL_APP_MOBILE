/**
 * Decisive end-to-end test: load the real caption model from a page that
 * carries the REAL CSP.
 *
 * probe-csp-block.mjs cannot distinguish a CSP block from a CORS failure —
 * both surface as "Failed to fetch". This loads the actual ASR pipeline,
 * which is the only thing that proves the model can be downloaded in
 * production conditions.
 *
 * Usage: node scripts/probe-model-load.mjs [origin]
 */
import { chromium } from "playwright";

const ORIGIN = process.argv[2] || "https://fuel-app-mobile.pages.dev";

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await (await browser.newContext()).newPage();

const violations = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy/i.test(t)) violations.push(t.slice(0, 200));
});

await page.goto(`${ORIGIN}/`, {
  waitUntil: "domcontentloaded",
  timeout: 90000,
});

const result = await page.evaluate(async () => {
  const started = Date.now();
  try {
    // Import the app's OWN bundled transformers chunk, not the CDN copy —
    // script-src does not allow the CDN, so the CDN import would fail for a
    // reason that has nothing to do with the model download.
    const html = await (await fetch("./", { cache: "no-store" })).text();
    const entry = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
    if (!entry) return { ok: false, error: "no entry chunk" };
    const entrySrc = await (
      await fetch(`./${entry}`, { cache: "no-store" })
    ).text();
    // transformers is a shared chunk pulled in by the lazy News chunk, not by
    // the entry. Walk entry -> News -> transformers.
    let chunk = /assets\/transformers-[A-Za-z0-9_-]+\.js/.exec(entrySrc)?.[0];
    if (!chunk) {
      const news = /assets\/News-[A-Za-z0-9_-]+\.js/.exec(entrySrc)?.[0];
      if (news) {
        const newsSrc = await (
          await fetch(`./${news}`, { cache: "no-store" })
        ).text();
        chunk = /assets\/transformers-[A-Za-z0-9_-]+\.js/.exec(newsSrc)?.[0];
      }
    }
    if (!chunk) return { ok: false, error: "no transformers chunk referenced" };

    const lib = await import(`./${chunk}`);
    lib.env.allowLocalModels = false;
    lib.env.useBrowserCache = false;
    lib.env.remoteHost = "https://huggingface.co/";
    lib.env.backends.onnx.wasm.numThreads = 1;

    // Same class-based construction the engine uses (the string-dispatch
    // `pipeline()` form is tree-shaken away by the bundler).
    const {
      AutoModelForSpeechSeq2Seq,
      AutoProcessor,
      AutoTokenizer,
      AutomaticSpeechRecognitionPipeline,
    } = lib;
    if (typeof AutoModelForSpeechSeq2Seq !== "function") {
      return {
        ok: false,
        chunk,
        error: `exports: ${Object.keys(lib).slice(0, 12).join(",")}`,
      };
    }
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
    return { ok: !!pipe, chunk, ms: Date.now() - started };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: String(e).slice(0, 220),
    };
  }
});

console.log(`\n=== ${ORIGIN} ===`);
console.log(`  model load : ${result.ok ? "SUCCESS" : "FAILED"}`);
console.log(`  elapsed    : ${result.ms} ms`);
if (result.error) console.log(`  error      : ${result.error}`);
if (violations.length) {
  console.log("  CSP violations:");
  for (const v of [...new Set(violations)]) console.log(`    ${v}`);
}

await browser.close();
process.exit(result.ok ? 0 : 1);
