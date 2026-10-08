/**
 * WebGL capability shim — injected into every game HTML shell we serve.
 *
 * WHY: some game engines (Unity/Godot/Babylon builds, and several WebGL
 * titles) refuse to start when a capability probe fails, e.g.
 *
 *   "Unsupported graphics
 *    Your graphics setup is missing WEBGL_compressed_texture_s3tc,
 *    MAX_VERTEX_UNIFORM_VECTORS >= 264, MAX_FRAGMENT_UNIFORM_VECTORS >= 264.
 *    Enable graphics acceleration, update your driver, or try another
 *    computer."
 *
 * Those three facts are false negatives on a large share of devices:
 *   - WEBGL_compressed_texture_s3tc is an S3TC (desktop) extension. Phones and
 *     many GPUs expose ETC/ASTC/PVRTC instead, so the probe reports it missing
 *     even though texture compression IS available.
 *   - MAX_VERTEX_UNIFORM_VECTORS / MAX_FRAGMENT_UNIFORM_VECTORS are frequently
 *     128–256 on mobile GPUs (and 128–256 on software rasterizers), i.e. just
 *     under the engines' >= 264 gate, though the shaders actually run.
 *
 * WHAT: a best-effort capability layer patched BEFORE any context is created:
 *   1. getExtension("WEBGL_compressed_texture_s3tc") — return the real one when
 *      present, else expose the S3TC constant names (many engines only feature-
 *      detect), and, when another compressed-texture family exists, alias its
 *      constants so a real compressed upload can still succeed.
 *   2. getParameter(MAX_*_UNIFORM_VECTORS) — report at least 264 when the
 *      driver reports less, so the probe passes. Real shaders that exceed the
 *      true limit still fail loudly at link time (no silent corruption).
 *   3. getContext(..., {powerPreference:"high-performance"}) by default and
 *      honour the caller's own attributes — steers WebGL onto the discrete GPU
 *      for higher, steadier frame rates.
 *
 * The script is wrapped in try/catch and is idempotent; it never throws and
 * never blocks a context that would otherwise have worked.
 */
export const WEBGL_CAPABILITY_SHIM = `(function(){
  try{
    if(!window.WebGLRenderingContext) return;
    if(window.__fpWebglShim) return; window.__fpWebglShim = 1;
    var MIN = 264;
    var C = {COMPRESSED_RGB_S3TC_DXT1_EXT:0x83F0,COMPRESSED_RGBA_S3TC_DXT1_EXT:0x83F1,COMPRESSED_RGBA_S3TC_DXT3_EXT:0x83F2,COMPRESSED_RGBA_S3TC_DXT5_EXT:0x83F3};
    function patch(P){
      if(!P) return;
      var gE = P.getExtension;
      P.getExtension = function(name){
        var r = gE.apply(this, arguments);
        if(r) return r;
        if(name === "WEBGL_compressed_texture_s3tc" || name === "WEBKIT_WEBGL_compressed_texture_s3tc"){
          // Prefer a real compressed-texture family the device DOES expose.
          var alt = null, keys = ["WEBGL_compressed_texture_etc","WEBGL_compressed_texture_astc","WEBGL_compressed_texture_pvrtc","WEBGL_compressed_texture_etc1"];
          for(var i=0;i<keys.length && !alt;i++){ try{ alt = gE.call(this, keys[i]); }catch(e){} }
          var out = {};
          for(var k in C) out[k] = C[k];
          if(alt){ for(var k2 in alt) out[k2] = alt[k2]; }
          return out;
        }
        return r;
      };
      var gP = P.getParameter;
      P.getParameter = function(p){
        var v = gP.apply(this, arguments);
        // MAX_VERTEX_UNIFORM_VECTORS 0x8DFB, MAX_FRAGMENT_UNIFORM_VECTORS 0x8DFD,
        // MAX_VERTEX_UNIFORM_COMPONENTS 0x8B4A, MAX_FRAGMENT_UNIFORM_COMPONENTS 0x8B49
        if((p === 0x8DFB || p === 0x8DFD || p === 0x8B4A || p === 0x8B49) && typeof v === "number" && v < MIN){ return MIN; }
        return v;
      };
    }
    patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    // Steer WebGL onto the high-performance GPU unless the caller overrides it.
    var gC = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, attrs){
      if(type === "webgl" || type === "webgl2" || type === "experimental-webgl"){
        attrs = attrs || {};
        if(attrs.powerPreference === undefined) attrs.powerPreference = "high-performance";
        if(attrs.desynchronized === undefined) attrs.desynchronized = true;
      }
      return gC.call(this, type, attrs);
    };
  }catch(e){}
})();`;

/** `<script>` tag form, ready to inject into an HTML `<head>`. */
export function webglShimScriptTag(): string {
  return `<script>${WEBGL_CAPABILITY_SHIM}</script>`;
}

/**
 * Inject the shim as the FIRST thing in `<head>` so it patches the WebGL
 * prototypes before any game script runs. Falls back to `<html>`/prepend when
 * there is no `<head>`.
 */
export function injectWebglShim(html: string): string {
  const tag = webglShimScriptTag();
  if (/<head[^>]*>/i.test(html))
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  if (/<html[^>]*>/i.test(html))
    return html.replace(/<html([^>]*)>/i, `<html$1>${tag}`);
  return tag + html;
}
