/**
 * The clean-path bootstrap in index.html.
 *
 * Both public mini sites are advertised as REAL website addresses
 * (`/site/<slug>`, `/account/<token>`), not `/#/...` fragments. The SPA uses a
 * HashRouter, which only reads the part after `#`, so if this rewrite is
 * missing or broken the visitor silently lands on the app root (the login
 * screen for an anonymous customer) instead of the page the link promised.
 *
 * That failure is invisible to every other test — the app still loads, there is
 * no error, the URL simply shows the wrong page. So assert it against the real
 * index.html rather than a copy of the regex.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

/** Pull the boot script and run it against a simulated location. */
function bootWith(pathname: string, hash = "") {
  const match =
    /<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);\s*<\/script>/.exec(html);
  if (!match) throw new Error("clean-path bootstrap script not found");
  const code = match[0].replace(/<\/?script>/g, "");

  let replaced: string | null = null;
  const location = { pathname, hash };
  const history = {
    replaceState: (_s: unknown, _t: unknown, url: string) => {
      replaced = url;
    },
  };

  // eslint-disable-next-line no-new-func
  new Function("location", "history", code)(location, history);
  return replaced;
}

describe("clean-path bootstrap", () => {
  it("rewrites /site/<slug> into the hash route", () => {
    expect(bootWith("/site/publican-energy")).toBe("/#/site/publican-energy");
  });

  it("rewrites /account/<token> into the hash route", () => {
    expect(bootWith("/account/abcDEF123456")).toBe("/#/account/abcDEF123456");
  });

  it("tolerates a trailing slash on either route", () => {
    expect(bootWith("/site/publican-energy/")).toBe("/#/site/publican-energy");
    expect(bootWith("/account/abcDEF123456/")).toBe("/#/account/abcDEF123456");
  });

  it("leaves a hash-only URL alone so in-app navigation never bounces", () => {
    expect(bootWith("/", "#/account/abcDEF123456")).toBeNull();
    expect(bootWith("/", "#/site/publican-energy")).toBeNull();
  });

  it("does not rewrite unrelated paths", () => {
    expect(bootWith("/")).toBeNull();
    expect(bootWith("/founder")).toBeNull();
    expect(bootWith("/station-access")).toBeNull();
  });

  it("requires a plausible token so a stray /account/ path is not hijacked", () => {
    // Too short, and illegal characters, must both be left for the router's
    // own 404 handling rather than rewritten into a bogus account route.
    expect(bootWith("/account/short")).toBeNull();
    expect(bootWith("/account/not a token")).toBeNull();
    expect(bootWith("/account/nested/deeper")).toBeNull();
  });
});
