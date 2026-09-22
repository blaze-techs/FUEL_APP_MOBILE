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
  /**
   * Caller-authored CSS for the document. Content that carries its own
   * stylesheet must pass it here rather than inlining it in `html`, because
   * `html` is sanitised against markup breakout (see guardPrintMarkup) and
   * any genuine `</style>` inside it would be neutralised.
   */
  css?: string;
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
  // Regex replacements rather than `String.prototype.replaceAll`, which needs
  // an ES2021 lib target this project does not compile against.
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Neutralise markup that would break out of an injected print surface.
 *
 * Print html is frequently assembled from user data (a customer name, a fuel
 * label, a note). A `</style>` or `</script>` sequence inside that data can
 * terminate the surrounding block early and swallow the remainder of the
 * document, printing a truncated page. Escaping only the closing form
 * preserves legitimate styling attributes.
 *
 * Escaping `<scr` + `ipt` in full because no print payload in this app needs
 * to execute script inside the rendered document.
 */
export function guardPrintMarkup(html: string): string {
  return (
    html
      .replace(/<\/(style|script|title|textarea)/gi, "&lt;/$1")
      // Patterns are written with character-class splits so the source bytes
      // never contain a literal script opener or comment opener. Those
      // sequences inside an inlined bundle can put the HTML tokenizer into
      // double-escaped script state, which stops the module from executing.
      .replace(/<scr[i]pt/gi, "&lt;script")
      .replace(/<!-[-]/g, "&lt;!--")
  );
}

/**
 * CSS may only be passed in through `options.css`. Content flowing through
 * `html` is untrusted and cannot open or close a style block.
 */
function guardPrintCss(css: string): string {
  // A nested </style> inside caller CSS would terminate the block early.
  return css.replace(/<\/style/gi, "");
}

function buildPrintDocument(
  html: string,
  options: PrintDocumentOptions,
): string {
  const title = escapeHtml(options.title || "FuelPro Document");
  const paper =
    options.paper === "a4"
      ? "@page{size:A4;margin:10mm;}"
      : options.paper === "letter"
        ? "@page{size:Letter;margin:10mm;}"
        : options.paper === "receipt"
          ? "@page{size:auto;margin:3mm;}"
          : "@page{size:auto;margin:10mm;}";
  const customCss = options.css ? guardPrintCss(options.css) : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
${paper}
html,body{margin:0;padding:0;background:#fff;color:#000;color-scheme:light}
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
${customCss}
</style>
</head>
<body>
${guardPrintMarkup(html)}
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
async function printInCurrentDocument(
  html: string,
  options: PrintDocumentOptions,
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Printing is only available in the application");
  }

  const rootId = "fuelpro-print-root";
  document.getElementById(rootId)?.remove();
  document.getElementById("fuelpro-print-style")?.remove();

  const root = document.createElement("div");
  root.id = rootId;
  root.setAttribute("data-fuelpro-print-root", "true");
  root.innerHTML = guardPrintMarkup(html);

  const style = document.createElement("style");
  style.id = "fuelpro-print-style";
  const page =
    options.paper === "a4"
      ? "@page{size:A4;margin:10mm;}"
      : options.paper === "letter"
        ? "@page{size:Letter;margin:10mm;}"
        : options.paper === "receipt"
          ? "@page{size:auto;margin:3mm;}"
          : "@page{size:auto;margin:10mm;}";
  style.textContent = `
    ${page}
    ${options.css ? guardPrintCss(options.css) : ""}
    @media print {
      /* The print root lives in the app document, so it inherits the app's
         theme CSS variables and utility classes. Dark-mode text tiers are
         !important, so they win over any inherited colour and would print a
         near-invisible grey. The id-scoped selector outranks those rules. */
      html, body { color-scheme: light !important; }
      #${rootId}, #${rootId} * {
        color: #000 !important;
        background-color: #fff !important;
        box-shadow: none !important;
        text-shadow: none !important;
      }
      body > *:not(#${rootId}) { display: none !important; }
      #${rootId} {
        display: block !important;
        position: static !important;
        width: 100% !important;
        max-width: none !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        background: #fff !important;
        color: #000 !important;
      }
      #${rootId} * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      #${rootId} .no-print,
      #${rootId} [data-no-print] { display: none !important; }
      #${rootId} thead { display: table-header-group; }
      #${rootId} tr,
      #${rootId} img { break-inside: avoid; }
    }
    @media screen {
      #${rootId} {
        position: fixed !important;
        left: -100000px !important;
        top: 0 !important;
        width: 1px !important;
        height: 1px !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(root);
  const previousTitle = document.title;
  document.title = options.title || "FuelPro Document";

  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("afterprint", onAfterPrint);
      window.setTimeout(() => {
        root.remove();
        style.remove();
        document.title = previousTitle;
      }, 0);
      resolve();
    };
    const onAfterPrint = () => cleanup();

    window.addEventListener("afterprint", onAfterPrint, { once: true });

    // Call print synchronously from the same user-gesture call stack.
    // Deferring through requestAnimationFrame can lose the transient user
    // activation on mobile browsers/PWAs, causing window.print() to do
    // nothing. The print surface is already attached before this call, so the
    // browser can snapshot it for the print preview itself.
    try {
      window.print();
    } catch (error) {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error("The browser print service failed"),
      );
      return;
    }

    // Some Android WebViews return without firing afterprint. Restore the
    // application after a bounded safety period instead of leaving it hidden.
    // The native Android print bridge is handled separately and does not use
    // this browser path.
    window.setTimeout(cleanup, Math.min(options.timeoutMs ?? 120000, 15000));
  });
}

/**
 * Print HTML from a user action. Native shells use their OS bridge.
 * Web/PWA printing uses an isolated current-document print surface so it does
 * not depend on a popup surviving asynchronous queue/data work.
 */
export async function printHtml(
  html: string,
  options: PrintDocumentOptions = {},
): Promise<void> {
  if (!html || !html.trim()) throw new Error("Nothing to print");

  const title = options.title || "FuelPro Document";

  if (typeof window !== "undefined" && window.FuelProNativePrint?.printHtml) {
    const result = window.FuelProNativePrint.printHtml(
      buildPrintDocument(html, options),
      title,
    );
    if (result === false) {
      throw new Error("Android print service rejected the document");
    }
    return;
  }

  if (typeof window !== "undefined" && window.FuelProElectronPrint?.printHtml) {
    const result = await window.FuelProElectronPrint.printHtml(
      buildPrintDocument(html, options),
      title,
    );
    if (result === false) {
      throw new Error("Desktop print service rejected the document");
    }
    return;
  }

  await printInCurrentDocument(html, options);
}

/** Print a DOM element as a clean document, stripping interactive controls. */
export function printElement(
  element: HTMLElement,
  options: PrintDocumentOptions = {},
): Promise<void> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("button,input,select,textarea,[data-no-print],.no-print")
    .forEach((node) => node.remove());
  return printHtml(clone.outerHTML, options);
}

export function printText(
  text: string,
  options: PrintDocumentOptions = {},
): Promise<void> {
  const safe = escapeHtml(text).replace(/\n/g, "<br>");
  return printHtml(
    `<pre style="white-space:pre-wrap;font:12px/1.45 monospace">${safe}</pre>`,
    options,
  );
}
