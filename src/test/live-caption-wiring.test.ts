/**
 * Wiring guard for the on-device caption pipeline.
 *
 * This repository has shipped "working" modules that nothing imported more
 * than once, so the thing worth pinning is not that the code compiles — it is
 * that every media surface actually reaches it. A caption engine that no
 * player calls changes nothing at runtime.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const LIVE_TV = "src/react-app/components/LiveFeedEmbed.tsx";
const MOVIES = "src/react-app/components/MoviesEmbed.tsx";
const HOOK = "src/react-app/hooks/useLiveCaptions.ts";
const OVERLAY = "src/react-app/components/LiveCaptionOverlay.tsx";
const ENGINE = "src/react-app/lib/live-caption-engine.ts";
const LANG_ID = "src/react-app/lib/handy-language-id.ts";

describe("every media surface reaches the caption pipeline", () => {
  it("Live TV / Live Radio uses the shared caption hook", () => {
    const src = read(LIVE_TV);
    // Assert the CALL, not the import: an unused import would satisfy a
    // `toContain` check while captions never run.
    expect(src).toMatch(/const captions = useLiveCaptions\(\{/);
    // The hook must be given the real media element, or it captions nothing.
    expect(src).toMatch(/mediaRef:\s*captionMediaRef/);
    // And the ref must point at whichever element is playing.
    expect(src).toMatch(/captionMediaRef\.current\s*=/);
  });

  it("Movies uses the shared caption hook too", () => {
    const src = read(MOVIES);
    expect(src).toMatch(/const captions = useLiveCaptions\(\{/);
    // Movies pass the hls.js <video> element.
    expect(src).toMatch(/mediaRef:\s*videoRef/);
  });

  it("both surfaces render the shared overlay rather than their own copy", () => {
    for (const file of [LIVE_TV, MOVIES]) {
      const src = read(file);
      // Assert the JSX ELEMENT, not the import: an imported-but-unrendered
      // overlay would satisfy a bare `toContain` while showing no captions.
      expect(src, file).toMatch(/<LiveCaptionOverlay/);
    }
  });

  it("Movies offers the caption toggle on EVERY stream, not only ones with tracks", () => {
    // The existing CC button is gated on `subtitleTracks.length > 0`, which is
    // empty for the mirror embeds — exactly the streams that need AI captions.
    // The AI toggle must not carry that gate.
    const src = read(MOVIES);
    const idx = src.indexOf("captions.toggle");
    expect(idx).toBeGreaterThan(-1);
    // Walk back to the nearest enclosing conditional and assert it is not the
    // subtitle-track gate.
    const before = src.slice(Math.max(0, idx - 400), idx);
    expect(before).not.toContain("subtitleTracks.length > 0");
  });

  it("the hook and overlay are the only caption lifecycle implementations", () => {
    // Two implementations is how surfaces drift; the inline engine call should
    // exist only inside the hook.
    for (const file of [LIVE_TV, MOVIES]) {
      const src = read(file);
      expect(src, file).not.toContain("liveCaptionEngine.start(");
    }
    expect(read(HOOK)).toContain("liveCaptionEngine.start(");
    expect(read(HOOK)).toContain("liveCaptionEngine.stop(");
  });

  it("the overlay renders every engine status", () => {
    const src = read(OVERLAY);
    for (const status of [
      "loading-model",
      "listening",
      "unavailable",
      "error",
    ]) {
      expect(src, status).toContain(`"${status}"`);
    }
  });

  it("the overlay surfaces which language was detected", () => {
    // Without the badge a mis-detection is indistinguishable from a bad
    // transcript, which is the whole reason the badge exists.
    const src = read(OVERLAY);
    expect(src).toContain("language.label");
    expect(src).toContain("assumed");
  });
});

describe("language detection is automatic and fully on-device", () => {
  it("the engine runs the AUDIO language probe, not just the transcript", () => {
    // Latin-script languages are indistinguishable by script, so the audio
    // probe is the only thing that can name them. Assert the CALL SITE — the
    // method existing without being called would leave captions script-only.
    const src = read(ENGINE);
    expect(src).toContain("detectAudioLanguage");
    expect(src).toContain("asr.processor");
    expect(src).toMatch(/await this\.detectFromAudio\(/);
  });

  it("defaults to AUTO so a stream is captioned in the language actually spoken", () => {
    expect(read(HOOK)).toMatch(/return cached \|\| "auto"/);
  });

  it("uses no server, no API key and no paid service", () => {
    const src = read(ENGINE) + read(LANG_ID) + read(HOOK);
    // Any of these would mean the pipeline is no longer free/on-device.
    expect(src).not.toMatch(/api[_-]?key/i);
    expect(src).not.toMatch(
      /https?:\/\/[^"']*(api|cloud|azure|openai|googleapis)/i,
    );
    expect(src).toContain("@xenova/transformers");
  });

  it("the audio probe is only run once per stream, not per utterance", () => {
    // Re-probing every utterance would double the compute for a signal that
    // does not change mid-programme.
    const src = read(ENGINE);
    expect(src).toMatch(/if \(!this\.activeLang && !this\.detectedLang\)/);
  });
});
