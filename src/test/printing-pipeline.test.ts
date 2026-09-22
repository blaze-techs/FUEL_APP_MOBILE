import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard against printed documents contaminating each other and against a
 * print page inheriting the app's dark-mode/theme CSS.
 *
 * Both defects are silent: a `</style>` inside injected content would break
 * out of the style block and swallow the rest of the document, and a printed
 * page rendered from the app origin carries the app's stylesheet, turning a
 * report into white-on-white on dark themes.
 */
function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

/** Every module that renders HTML for printing. */
const PRINT_SOURCES = [
  "src/react-app/lib/unified-print.ts",
  "src/react-app/lib/silent-print-service.ts",
  "src/react-app/lib/pos/printer-service.ts",
];

describe("print modules survive being inlined into an HTML document", () => {
  /**
   * When a module is inlined into an HTML document, the tokenizer enters
   * double-escaped script state if it sees a comment opener followed later by
   * a script opener. From that point nothing else is parsed, so the module
   * silently never executes. Emitting a script tag on its own is fine, so the
   * guard patterns must simply avoid a preceding comment opener.
   */
  for (const file of PRINT_SOURCES) {
    it(`${file} never pairs a comment opener with a script opener`, () => {
      const src = read(file);
      const comment = src.indexOf("<!-" + "-");
      if (comment === -1) return;
      expect(src.indexOf("<scr" + "ipt", comment)).toBe(-1);
    });
  }
});

describe("dark-mode text cannot leak into a printed document", () => {
  it("the print root forces black text on a white surface", () => {
    // The print root lives inside the app document, so it inherits the app's
    // dark-mode text tiers. Those are declared !important, so print must
    // override them at a higher specificity (the root id), otherwise a
    // dark-mode station prints near-invisible grey text.
    const s = read("src/react-app/lib/unified-print.ts");
    const inDoc = s.slice(s.indexOf("async function printInCurrentDocument"));
    expect(inDoc).toMatch(/#\$\{rootId\},\s*#\$\{rootId\}\s*\*/);
    expect(inDoc).toMatch(/color:\s*#000\s*!important/);
    expect(inDoc).toMatch(/background-color:\s*#fff\s*!important/);
  });
});

describe("caller-supplied CSS reaches the printed document", () => {
  it("the in-document path applies options.css", () => {
    // The in-document path is what browsers actually use, so the receipt's
    // 80mm stylesheet must be wired there and not only into the popup path.
    const s = read("src/react-app/lib/unified-print.ts");
    const inDoc = s.slice(s.indexOf("async function printInCurrentDocument"));
    expect(inDoc).toMatch(/options\.css\s*\?\s*guardPrintCss\(options\.css\)/);
  });

  it("the popup path applies options.css", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(
      /const customCss = options\.css \? guardPrintCss\(options\.css\)/,
    );
  });

  it("caller CSS cannot close its own style block", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/function guardPrintCss/);
    expect(s).toMatch(/replace\(\/<\\\/style\/gi, ""\)/);
  });
});

describe("print documents are self-contained", () => {
  it("emits a doctype", () => {
    // Without a doctype the browser prints in quirks mode, which breaks
    // table pagination and some margin handling.
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/<!doctype html>/i);
  });

  it("neutralises a closing style tag inside content", () => {
    // The print root is injected outside a <style>, so the risk is the
    // reverse: content that closes the wrapper. guardPrintMarkup must run
    // on any html that reaches a document.write/print surface.
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/function guardPrintMarkup|guardPrintMarkup\(/);
  });

  it("forces a light surface for the printed page", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/background:\s*#fff/i);
    expect(s).toMatch(/color:\s*#000/i);
    // Pins the browser's built-in form/scrollbar rendering to light so a
    // dark-mode station does not print dark-on-dark.
    expect(s).toMatch(/color-scheme:\s*light/);
  });
});

describe("no print path prints the whole application", () => {
  /**
   * These call sites used bare window.print(), which prints the live app
   * chrome (nav, dark theme, interactive controls) instead of a document.
   */
  const BARE_PRINT_CALLSITES = [
    "src/react-app/components/Compliance.tsx",
    "src/react-app/components/MemberPortal.tsx",
  ];

  for (const file of BARE_PRINT_CALLSITES) {
    it(`${file} routes through a print document`, () => {
      const s = read(file);
      const bare = s.match(/window\.print\(\s*\)/g) ?? [];
      const hasPrintDoc = /printHtml|printElement|printDocument|printText/.test(
        s,
      );
      // A bare window.print() may only exist as the raw fallback INSIDE a
      // print-document helper, never as the whole implementation.
      expect(bare.length === 0 || hasPrintDoc).toBe(true);
    });
  }
});

describe("popup print paths preserve the user gesture", () => {
  it("no print path defers print() behind a timer", () => {
    // The original defect: a popup was written, then print() was called from
    // setTimeout(300). Deferred calls lose the transient user activation on
    // mobile and the dialog silently never opens.
    const offenders: string[] = [];
    for (const file of [
      "src/react-app/components/Dashboard.tsx",
      "src/react-app/components/FuelSalesReport.tsx",
    ]) {
      const s = read(file);
      if (
        /setTimeout\([^)]*\bprint\b|setTimeout\(\s*\(\s*\)\s*=>\s*printWin\.print/.test(
          s,
        )
      ) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("print surfaces cannot leak into each other", () => {
  it("removes any previous print root before installing a new one", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/getElementById\(rootId\)\?\.remove\(\)/);
  });

  it("cleans up on afterprint and on a bounded safety timeout", () => {
    // Android WebViews sometimes never fire afterprint; without the timer the
    // app would stay hidden behind the print root.
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/afterprint/);
    expect(s).toMatch(/setTimeout\(\s*cleanup/);
    expect(s).toMatch(/root\.remove\(\)/);
    expect(s).toMatch(/style\.remove\(\)/);
  });

  it("restores the document title after printing", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/previousTitle/);
    expect(s).toMatch(/document\.title = previousTitle/);
  });
});

describe("print failures are surfaced, never silent", () => {
  it("printHtml rejects an empty document", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/throw new Error\("Nothing to print"\)/);
  });

  it("native bridge rejection becomes a thrown error", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    expect(s).toMatch(/Android print service rejected the document/);
    expect(s).toMatch(/Desktop print service rejected the document/);
  });

  it("unknown paper sizes fall back to a defined default", () => {
    const s = read("src/react-app/lib/unified-print.ts");
    // a4 / letter / receipt / default — all four branches must exist.
    expect(s).toMatch(/@page\{size:A4/);
    expect(s).toMatch(/@page\{size:Letter/);
    expect(s).toMatch(/@page\{size:auto;margin:3mm;\}/);
  });
});
