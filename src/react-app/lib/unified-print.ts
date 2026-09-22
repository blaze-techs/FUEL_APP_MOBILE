/**
 * Unified document printing for FuelPro.
 *
 * One public API for Web/PWA, Android Capacitor WebView and Electron.
 * Browser printing opens a real print document instead of relying on a
 * hidden iframe, which is unreliable in mobile WebViews and blocked by
 * popup policies when the print window is created too late.
 */

export interface PrintDocumentOptions {
  title?: string;
  timeoutMs?: number;
  paper?: "auto" | "a4" | "letter" | "receipt";
}

declare global {
  interface Window {
    FuelProNativePrint?: {
      printHtml: (html: string, title?: string) => boolean | void;
    };
    FuelProElectronPrint?: {
      printHtml: (html: string, title?: string) => Promise<boolean> | boolean;
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildPrintDocument(html: string, options: PrintDocumentOptions): string {
  const title = escapeHtml(options.title || "FuelPro Document");
  const paper =
    options.paper === "a4"
      ? "@page{size:A4;margin:10mm;}"
      : options.paper === "letter"
        ? "@page{size:Letter;margin:10mm;}"
        : options.paper === "receipt"
          ? "@page{size:auto;margin:3mm;}"
          : "@page{size:auto;margin:10mm;}";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
${paper}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:Arial,Helvetica,sans-serif}
*{box-sizing:border-box}
img{max-width:100%}
table{max-width:100%}
@media print{
  html,body{background:#fff!important;color:#000!important}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  thead{display:table-header-group}
  tr,img{break-inside:avoid}
  .no-print{display:none!important}
}
</style>
</head>
<body>
${html}
<script>
(function(){
  var done=false;
  function printNow(){
    if(done) return;
    done=true;
    setTimeout(function(){ window.focus(); window.print(); }, 50);
  }
  if(document.readyState === "complete") printNow();
  else window.addEventListener("load", printNow, {once:true});
  setTimeout(printNow, 1200);
})();
</script>
</body>
</html>`;
}

/**
 * Print HTML from a user action. On native shells the call is delegated to
 * the OS print framework. On normal browsers it opens a print-ready tab.
 */
export async function printHtml(
  html: string,
  options: PrintDocumentOptions = {},
): Promise<void> {
  if (!html || !html.trim()) throw new Error("Nothing to print");

  const title = options.title || "FuelPro Document";

  // Android Capacitor native bridge.
  if (typeof window !== "undefined" && window.FuelProNativePrint?.printHtml) {
    const result = window.FuelProNativePrint.printHtml(
      buildPrintDocument(html, options),
      title,
    );
    if (result === false) throw new Error("Android print service rejected the document");
    return;
  }

  // Electron native print bridge.
  if (typeof window !== "undefined" && window.FuelProElectronPrint?.printHtml) {
    const result = await window.FuelProElectronPrint.printHtml(
      buildPrintDocument(html, options),
      title,
    );
    if (result === false) throw new Error("Desktop print service rejected the document");
    return;
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Printing is only available in the application");
  }

  // Create the window synchronously so mobile browsers do not classify it as
  // an unsolicited popup. The caller should invoke this from the print click.
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) {
    throw new Error("Printing was blocked by the browser. Allow pop-ups for FuelPro and try again.");
  }

  const printDocument = buildPrintDocument(html, options);
  printWindow.document.open();
  printWindow.document.write(printDocument);
  printWindow.document.close();

  // Do not close the tab immediately: Android Chrome/Safari can cancel the
  // native print job if the document is destroyed while the dialog is opening.
  const timeout = options.timeoutMs ?? 120000;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        printWindow.close();
      } catch {
        // Some browsers intentionally keep the print tab open.
      }
      resolve();
    };

    printWindow.addEventListener("afterprint", finish, { once: true });
    setTimeout(finish, timeout);
  });
}

/** Convenience wrapper for plain text documents. */
/** Print a DOM element as a clean document, stripping interactive controls. */
export function printElement(
  element: HTMLElement,
  options: PrintDocumentOptions = {},
): Promise<void> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button,input,select,textarea,[data-no-print],.no-print").forEach((node) => node.remove());
  return printHtml(clone.outerHTML, options);
}

export function printText(
  text: string,
  options: PrintDocumentOptions = {},
): Promise<void> {
  const safe = escapeHtml(text).replaceAll("\\n", "<br>");
  return printHtml(`<pre style="white-space:pre-wrap;font:12px/1.45 monospace">${safe}</pre>`, options);
}
