import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Cross-language contract: the web app talks to the Android shell through
 * `addJavascriptInterface` names. If the Java side and the TypeScript side
 * ever disagree, exports break SILENTLY inside the APK — which is exactly the
 * bug this work fixed (no file saved, no error shown).
 *
 * These assertions fail the build on drift in either direction.
 */

const mainActivityPath = resolve(
  process.cwd(),
  "android/app/src/main/java/com/fuelpro/app/MainActivity.java",
);
const fileSavePath = resolve(process.cwd(), "src/react-app/lib/file-save.ts");
const printPath = resolve(process.cwd(), "src/react-app/lib/unified-print.ts");

const read = (p: string) => readFileSync(p, "utf8");

describe("Android bridge contract", () => {
  const java = read(mainActivityPath);

  it("registers the file-save bridge the web app looks for", () => {
    const ts = read(fileSavePath);
    // The name the TS side reads off `window`.
    expect(ts).toContain("FuelProNativeFiles");
    // The name the Android shell exposes.
    expect(java).toContain(
      'addJavascriptInterface(new FilesBridge(), "FuelProNativeFiles")',
    );
  });

  it("exposes each method the web app calls", () => {
    const signatures: Record<string, string> = {
      isAvailable: "public boolean isAvailable(",
      saveBytes: "public String saveBytes(",
      saveAndShareBytes: "public String saveAndShareBytes(",
      shareBytes: "public String shareBytes(",
    };
    for (const [method, signature] of Object.entries(signatures)) {
      expect(java, `${method} signature`).toContain(signature);
    }
    const ts = read(fileSavePath);
    expect(ts).toContain("bridge.saveBytes");
    expect(ts).toContain("bridge.saveAndShareBytes");
    expect(ts).toContain("bridge.shareBytes");
  });

  it("annotates every bridged method with @JavascriptInterface", () => {
    // A missing annotation makes the method invisible to the page with no
    // build error — the call just returns undefined at runtime.
    const bridgeBody = java.slice(
      java.indexOf("private final class FilesBridge"),
    );
    const decls =
      bridgeBody.match(/public (?:String|boolean|void) \w+\(/g) ?? [];
    const annotations = bridgeBody.match(/@JavascriptInterface/g) ?? [];
    expect(decls.length).toBeGreaterThan(0);
    expect(annotations.length).toBeGreaterThanOrEqual(decls.length);
  });

  it("keeps the print bridge shared by the printer module", () => {
    expect(java).toContain(
      'addJavascriptInterface(new PrintBridge(), "FuelProNativePrint")',
    );
    expect(read(printPath)).toContain("FuelProNativePrint");
  });

  it("still provides a real PrintManager path for the APK", () => {
    // Android WebView does not implement window.print(); the shell must hand
    // documents to PrintManager instead.
    expect(java).toContain("PrintManager");
    expect(java).toContain("createPrintDocumentAdapter");
  });

  it("writes to a FileProvider root that is actually declared", () => {
    // FileProvider.getUriForFile throws for a path outside every declared
    // root, so sharing would fail silently.
    const paths = read(
      resolve(process.cwd(), "android/app/src/main/res/xml/file_paths.xml"),
    );
    expect(paths).toContain("<cache-path");
    expect(paths).toContain("<external-files-path");
    expect(java).toContain("getCacheDir()");
    expect(java).toContain(
      "getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)",
    );
    // The provider authority must be the one the code asks for.
    const manifest = read(
      resolve(process.cwd(), "android/app/src/main/AndroidManifest.xml"),
    );
    expect(manifest).toContain(
      'android:authorities="${applicationId}.fileprovider"',
    );
    expect(java).toContain('getPackageName() + ".fileprovider"');
  });

  it("does not regress to a plain window.print() for receipts", () => {
    const pos = read(
      resolve(process.cwd(), "src/react-app/components/PointOfSale.tsx"),
    );
    // The receipt used window.open + document.write, which the Android WebView
    // blocks outright.
    expect(pos).not.toContain('window.open("", "_blank")');
    expect(pos).toContain("printHtml(");
  });
});
