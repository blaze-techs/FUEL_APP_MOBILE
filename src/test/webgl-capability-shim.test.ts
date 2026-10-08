import { describe, it, expect } from "vitest";
import {
  injectWebglShim,
  webglShimScriptTag,
  WEBGL_CAPABILITY_SHIM,
} from "../react-app/lib/webgl-capability-shim";

describe("webgl capability shim", () => {
  it("injects as the FIRST element in <head>", () => {
    const html =
      "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>";
    const out = injectWebglShim(html);
    const headIdx = out.indexOf("<head>");
    const shimIdx = out.indexOf("<script>");
    const titleIdx = out.indexOf("<title>");
    expect(headIdx).toBeGreaterThan(-1);
    expect(shimIdx).toBeGreaterThan(headIdx);
    expect(shimIdx).toBeLessThan(titleIdx);
  });

  it("preserves <head> attributes", () => {
    const out = injectWebglShim(
      '<html><head data-x="1"><meta charset="utf-8"></head></html>',
    );
    expect(out).toContain('<head data-x="1"><script>');
  });

  it("falls back to prepending when there is no <head>", () => {
    const out = injectWebglShim('<html lang="en"><body>hi</body></html>');
    expect(out.startsWith('<html lang="en"><script>')).toBe(true);
  });

  it("covers the three facts the engines probe", () => {
    // S3TC extension, and the uniform-vector parameters.
    const s = WEBGL_CAPABILITY_SHIM;
    expect(s).toContain("WEBGL_compressed_texture_s3tc");
    expect(s).toContain("MAX_VERTEX_UNIFORM_VECTORS");
    expect(s).toContain("0x8DFB");
    expect(s).toContain("0x8DFD");
    expect(s).toContain("264");
  });

  it("requests the high-performance GPU by default", () => {
    expect(WEBGL_CAPABILITY_SHIM).toContain("high-performance");
  });

  it("is self-guarding and idempotent", () => {
    expect(WEBGL_CAPABILITY_SHIM).toContain("__fpWebglShim");
    expect(WEBGL_CAPABILITY_SHIM.startsWith("(function(){")).toBe(true);
    expect(WEBGL_CAPABILITY_SHIM).toContain("catch(e){}");
  });

  it("scopes parameter padding to uniform-vector queries only", () => {
    // A blanket getParameter override would corrupt unrelated reads.
    expect(WEBGL_CAPABILITY_SHIM).toContain(
      '&& typeof v === "number" && v < MIN',
    );
  });

  it("script tag wraps the IIFE once", () => {
    const tag = webglShimScriptTag();
    expect(tag.startsWith("<script>(function(){")).toBe(true);
    expect(tag.endsWith("})();</script>")).toBe(true);
    expect(tag.match(/<script>/g)?.length).toBe(1);
  });
});
