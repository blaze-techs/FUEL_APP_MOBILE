import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  hasNativeFileSave,
  saveFile,
  saveJson,
  saveCsv,
  saveText,
  browserDownload,
  installNativeDownloadInterceptor,
} from "@/react-app/lib/file-save";

/**
 * Regression: exporting a document (PDF/Excel/CSV/text) did nothing inside the
 * Android APK.
 *
 * Android's WebView implements neither `URL.createObjectURL` + `<a download>`
 * nor a DownloadListener here, so every export build on that pattern — which
 * is all of them, including `file-saver` and `jsPDF` — silently no-oped. The
 * fix hands the bytes to the native `FuelProNativeFiles` bridge, and an
 * interception layer catches existing anchor clicks so no call site needed
 * rewriting.
 */

interface NativeCall {
  method: string;
  base64: string;
  filename: string;
  mimeType: string;
}

/** Minimal stand-in for the Android `@JavascriptInterface` bridge. */
function installFakeBridge(options: { fail?: boolean; share?: boolean } = {}) {
  const calls: NativeCall[] = [];
  const record = (method: string) =>
    vi.fn((base64: string, filename: string, mimeType: string) => {
      calls.push({ method, base64, filename, mimeType });
      if (options.fail) {
        return JSON.stringify({ ok: false, error: "disk full" });
      }
      if (method === "shareBytes" && options.share === false) {
        return JSON.stringify({ ok: false, error: "no share target" });
      }
      return JSON.stringify({ ok: true, filename, mimeType });
    });

  (window as unknown as { FuelProNativeFiles?: unknown }).FuelProNativeFiles = {
    isAvailable: () => true,
    saveBytes: record("saveBytes"),
    saveAndShareBytes: record("saveAndShareBytes"),
    shareBytes: record("shareBytes"),
  };
  return calls;
}

function clearBridge() {
  delete (window as unknown as { FuelProNativeFiles?: unknown })
    .FuelProNativeFiles;
}

describe("file-save: native bridge routing", () => {
  beforeEach(() => {
    clearBridge();
  });

  afterEach(() => {
    clearBridge();
    vi.restoreAllMocks();
  });

  it("detects the native bridge only when it is present", () => {
    expect(hasNativeFileSave()).toBe(false);
    installFakeBridge();
    expect(hasNativeFileSave()).toBe(true);
  });

  it("hands bytes to the native bridge instead of an anchor download", async () => {
    const calls = installFakeBridge();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");

    const result = await saveFile(
      new Blob(["hello"], { type: "text/plain" }),
      "report.txt",
      "text/plain",
    );

    expect(result.ok).toBe(true);
    expect(result.via).toBe("native-download");
    expect(calls).toHaveLength(1);
    expect(calls[0].filename).toBe("report.txt");
    expect(calls[0].mimeType).toBe("text/plain");
    // base64 of "hello"
    expect(atob(calls[0].base64)).toBe("hello");
    // The browser path must NOT run when the bridge handled it.
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("reports failure honestly instead of a false success", async () => {
    installFakeBridge({ fail: true });
    const result = await saveFile(
      new Blob(["x"], { type: "text/plain" }),
      "report.txt",
      "text/plain",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("disk full");
  });

  it("routes share requests to the share method", async () => {
    const calls = installFakeBridge();
    const result = await saveFile(
      new Blob(["x"], { type: "application/pdf" }),
      "invoice.pdf",
      "application/pdf",
      { share: true },
    );
    expect(result.ok).toBe(true);
    expect(calls[0].method).toBe("saveAndShareBytes");
  });

  it("falls back to the browser anchor when no bridge exists", async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const result = await saveFile(
      new Blob(["x"], { type: "text/plain" }),
      "report.txt",
      "text/plain",
    );
    expect(result.via).toBe("browser");
    expect(clickSpy).toHaveBeenCalled();
  });

  it("encodes binary content without corrupting it", async () => {
    const calls = installFakeBridge();
    // Bytes outside the ASCII range are where a naive btoa loop would break.
    const bytes = new Uint8Array([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47, 0x7f]);
    await saveFile(bytes, "logo.png", "image/png");
    const decoded = atob(calls[0].base64);
    expect(Array.from(decoded, (c) => c.charCodeAt(0))).toEqual(
      Array.from(bytes),
    );
  });
});

describe("file-save: convenience wrappers", () => {
  beforeEach(() => clearBridge());
  afterEach(() => clearBridge());

  it("saveJson sends JSON with the right mime type", async () => {
    const calls = installFakeBridge();
    await saveJson({ a: 1 }, "data.json");
    expect(calls[0].mimeType).toBe("application/json");
    expect(JSON.parse(atob(calls[0].base64))).toEqual({ a: 1 });
  });

  it("saveJson accepts an already-serialized string", async () => {
    const calls = installFakeBridge();
    await saveJson('{"b":2}', "raw.json");
    expect(JSON.parse(atob(calls[0].base64))).toEqual({ b: 2 });
  });

  it("saveCsv prefixes a BOM so Excel reads UTF-8 correctly", async () => {
    const calls = installFakeBridge();
    await saveCsv("name\nCafé", "rows.csv");
    // The BOM is present as UTF-8 bytes (EF BB BF). Assert at the byte level:
    // TextDecoder strips a leading BOM by default, so decoding would hide it.
    const binary = atob(calls[0].base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("name\nCafé");
    expect(calls[0].mimeType).toBe("text/csv");
  });

  it("saveText sends plain text", async () => {
    const calls = installFakeBridge();
    await saveText("line 1\nline 2", "notes.txt");
    expect(atob(calls[0].base64)).toBe("line 1\nline 2");
    expect(calls[0].mimeType).toBe("text/plain");
  });
});

describe("file-save: anchor-click interception", () => {
  beforeEach(() => {
    clearBridge();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    clearBridge();
    vi.restoreAllMocks();
  });

  it("does not patch anything when there is no native bridge", () => {
    const before = HTMLAnchorElement.prototype.click;
    installNativeDownloadInterceptor();
    expect(HTMLAnchorElement.prototype.click).toBe(before);
  });

  it("redirects an existing anchor download to the native bridge", async () => {
    const calls = installFakeBridge();
    installNativeDownloadInterceptor();

    // This is exactly what file-saver / jsPDF do: an <a download> with an
    // object URL, activated by a synthetic MouseEvent click.
    const blob = new Blob(["receipt"], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "receipt.pdf";
    document.body.appendChild(anchor);

    await new Promise<void>((resolve) => {
      anchor.addEventListener("click", () => resolve(), { once: true });
      anchor.dispatchEvent(new MouseEvent("click"));
      setTimeout(resolve, 50);
    });

    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].filename).toBe("receipt.pdf");
    expect(atob(calls[0].base64)).toBe("receipt");

    anchor.remove();
    URL.revokeObjectURL(url);
  });

  it("keeps the Blob after the caller revokes the URL immediately", async () => {
    const calls = installFakeBridge();
    installNativeDownloadInterceptor();

    const blob = new Blob(["late-click"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    // Many call sites revoke right after clicking.
    URL.revokeObjectURL(url);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "late.txt";
    anchor.dispatchEvent(new MouseEvent("click"));

    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(atob(calls[0].base64)).toBe("late-click");
  });

  it("leaves non-download anchors alone", () => {
    installFakeBridge();
    installNativeDownloadInterceptor();
    const anchor = document.createElement("a");
    anchor.href = "https://example.com/page";
    const spy = vi.spyOn(anchor, "click");
    anchor.click();
    expect(spy).toHaveBeenCalled();
  });

  it("browserDownload still produces a working anchor on the web", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    browserDownload(new Blob(["x"], { type: "text/plain" }), "web.txt");
    expect(clickSpy).toHaveBeenCalled();
  });
});
