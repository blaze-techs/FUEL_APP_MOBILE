/**
 * ad-blocker.ts — in-app ad & popup blocker for the media players
 * (Movies, Live TV, Live Radio).
 *
 * Reverse-engineered from two Chrome extensions (a browser extension cannot
 * be bundled into a web app, so the equivalent behavior is implemented
 * in-page):
 *
 * 1. uBlock Origin (gighmmpiobklfepjocnamgkkbiglidom):
 *    - NETWORK FILTERING: block fetch/XHR/beacon requests to known
 *      ad/tracking networks (EasyList/EasyPrivacy-derived list + the ad
 *      networks commonly embedded by free streaming providers).
 *    - COSMETIC FILTERING: MutationObserver hides/removes ad elements that
 *      leak into OUR document (ad iframes, popup overlays, injected
 *      script tags pointing at ad networks).
 *    - SCRIPTLET DEFUSING: neutralize document.write + beforeunload
 *      hijack attempts.
 *
 * 2. Popup Blocker Pro (gkiajdibmbofmbkfhdbjpikhfnapkhfa):
 *    - STRICT POPUP SHIELD: when engaged, window.open is blocked even for
 *      user-gesture calls unless the URL is whitelisted (same-origin or an
 *      allowlisted domain). Each blocked attempt increments a counter that
 *      is surfaced in the player UI (the "badge").
 *    - AUTO-TOGGLE LIFECYCLE: the shield ENGAGES when a media player
 *      mounts (i.e. right before the user can click "play") and RELEASES
 *      when the player unmounts/closes. Ref-counted per scope so nested
 *      players (Movies detail + trailer) never prematurely disengage.
 *
 * Cross-origin note: ads rendered INSIDE a third-party iframe cannot be
 * removed by DOM methods, and the providers actively REFUSE to play in a
 * sandboxed iframe (verified: vidsrc.to renders a "can't be embedded in a
 * sandboxed frame" refusal page). Instead the in-iframe threats are covered
 * by: (1) this engine's beforeunload redirect trap (blocks
 * window.top.location hijacks while a player is open), (2) the MoviesEmbed
 * iframe hijack watchdog (resets the iframe if it navigates itself to an ad
 * page), and (3) Chrome's built-in blocking of gesture-less cross-origin
 * top navigation. This engine covers everything OUR document does: network
 * requests, DOM injection, window.open, and top-level redirects.
 */

// ─── Filter list (EasyList/EasyPrivacy core + streaming-site ad networks) ──
const AD_DOMAINS: readonly string[] = [
  // Big ad/tracking networks (EasyList/EasyPrivacy)
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "ads.yahoo.com",
  "adnxs.com",
  "adsystem.com",
  "advertising.com",
  "criteo.com",
  "criteo.net",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "openx.com",
  "smartadserver.com",
  "smaato.net",
  "inmobi.com",
  "moatads.com",
  "scorecardresearch.com",
  "quantserve.com",
  "bluekai.com",
  "krxd.net",
  "demdex.net",
  "everesttech.net",
  "mathtag.com",
  "media.net",
  "bidswitch.net",
  "casalemedia.com",
  "contextweb.com",
  "sharethrough.com",
  "triplelift.com",
  "indexww.com",
  "amazon-adsystem.com",
  "aaxads.com",
  "adcolony.com",
  "applovin.com",
  "chartboost.com",
  "ironsrc.com",
  "outbrain.com",
  "taboola.com",
  "mgid.com",
  "zergnet.com",
  "revcontent.com",
  "content.ad",
  // Popup / popunder networks (common on free streaming providers)
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "propellerclick.com",
  "exoclick.com",
  "trafficjunky.com",
  "juicyads.com",
  "clickadu.com",
  "adsterra.com",
  "ero-advertising.com",
  "hilltopads.net",
  "adcash.com",
  "onclkds.com",
  "onclickperformance.com",
  "onclickgenius.com",
  "go2cloud.org",
  "voluum.com",
  "trackvoluum.com",
  "waust.at",
  "dlsdk.com",
  "betotodilea.com",
  "bestreams.net",
  "mygoodstream.pw",
  "streamtape.com",
  "dood.so",
  "dood.ws",
  "dood.wf",
  "dood.re",
  "doodstream.com",
  "voe.sx",
  "voe-unblock.com",
  "mixdrop.co",
  "upstream.to",
  "streamlare.com",
];

/** Domains that are NEVER blocked even in strict mode (auth, shares, our API). */
const POPUP_WHITELIST: readonly string[] = [
  "accounts.google.com",
  "apis.google.com",
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "supabase.co",
  "wa.me",
  "api.whatsapp.com",
  "mailto:",
  "tel:",
];

// ─── State ────────────────────────────────────────────────────────────────
let initialized = false;
let strictScopes = 0; // ref-count of active player scopes
let blockedCount = 0;
let shieldEngaged = false;
// Top-navigation (redirect) guard: armed for a short window after each user
// gesture / iframe load. A cross-origin embed iframe that tries
// `window.top.location = ad-page` while the shield is engaged AND armed gets
// trapped by beforeunload (the browser shows "Leave site?" and the user
// stays). Chrome already blocks gesture-less cross-origin top navigation —
// this closes the remaining gesture-driven redirect hole.
let navGuardArmedUntil = 0;
let lastGestureAt = 0;

/** Arm the redirect guard for `ms` (default 3s). */
export function armNavGuard(ms = 3000): void {
  navGuardArmedUntil = Date.now() + ms;
}

/** Timestamp (ms epoch) of the last user pointer gesture anywhere. */
export function getLastGestureTime(): number {
  return lastGestureAt;
}

/** Public counter for ad/redirect events detected outside this module. */
export function noteBlockedEvent(kind: string, detail: string): void {
  noteBlocked(kind, detail);
}

type ShieldListener = (state: { active: boolean; blocked: number }) => void;
const listeners = new Set<ShieldListener>();

function emit() {
  const state = { active: shieldEngaged, blocked: blockedCount };
  listeners.forEach((cb) => {
    try {
      cb(state);
    } catch {
      /* listener errors must never break the blocker */
    }
  });
}

export function onPopupShieldChange(cb: ShieldListener): () => void {
  listeners.add(cb);
  cb({ active: shieldEngaged, blocked: blockedCount });
  return () => {
    listeners.delete(cb);
  };
}

export function getPopupShieldState(): { active: boolean; blocked: number } {
  return { active: shieldEngaged, blocked: blockedCount };
}

function noteBlocked(kind: string, url: string) {
  blockedCount += 1;
  if (typeof console !== "undefined") {
    console.warn(`[ad-blocker] blocked ${kind}:`, url);
  }
  emit();
}

function isAdUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return AD_DOMAINS.some((d) => lower.includes(d));
}

function isWhitelistedPopup(url: string): boolean {
  if (!url) return true; // window.open() with no URL is harmless
  const lower = url.toLowerCase();
  if (lower.startsWith("/")) return true;
  if (
    typeof window !== "undefined" &&
    window.location?.origin &&
    lower.startsWith(window.location.origin.toLowerCase())
  ) {
    return true;
  }
  return POPUP_WHITELIST.some((d) => lower.includes(d));
}

// ─── Public lifecycle API ─────────────────────────────────────────────────

/** Engage the strict popup shield (ref-counted). Call when a player mounts. */
export function engagePopupShield(scope = "player"): void {
  strictScopes += 1;
  if (!shieldEngaged) {
    shieldEngaged = true;
    if (typeof console !== "undefined") {
      console.info(`[ad-blocker] popup shield ENGAGED (${scope})`);
    }
    emit();
  }
}

/** Release one scope. When the last scope releases, the shield disengages. */
export function releasePopupShield(scope = "player"): void {
  strictScopes = Math.max(0, strictScopes - 1);
  if (strictScopes === 0 && shieldEngaged) {
    shieldEngaged = false;
    if (typeof console !== "undefined") {
      console.info(`[ad-blocker] popup shield released (${scope})`);
    }
    emit();
  }
}

/** Manually reset the blocked counter (e.g. when a new title/channel plays). */
export function resetPopupShieldCount(): void {
  blockedCount = 0;
  emit();
}

// ─── Engine ───────────────────────────────────────────────────────────────

/**
 * Install the blockers. Idempotent — safe to call more than once (main.tsx
 * boot + any late-init path).
 */
export function initAdBlocker(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // ── 1. window.open override (Popup Blocker Pro behavior) ──────────────
  // Chains over any earlier override (e.g. the inline index.html guard).
  const prevOpen = window.open?.bind(window);
  window.open = function (
    url?: string | URL,
    target?: string,
    features?: string,
  ): Window | null {
    const urlStr = typeof url === "string" ? url : url ? String(url) : "";
    // Always block ad-network popups.
    if (isAdUrl(urlStr)) {
      noteBlocked("popup(ad-network)", urlStr);
      return null;
    }
    // In strict mode (player active) block ANY non-whitelisted popup —
    // even user-gesture ones. The streaming providers' play buttons often
    // fire popup ads on the FIRST click.
    if (shieldEngaged && !isWhitelistedPopup(urlStr)) {
      noteBlocked("popup(strict)", urlStr);
      return null;
    }
    return prevOpen ? prevOpen(url, target, features) : null;
  } as typeof window.open;

  // ── 2. Network filtering (uBlock Origin behavior) ─────────────────────
  // Block ad-network requests made by OUR document (fetch / XHR / beacons).
  // Requests inside cross-origin iframes are unaffected (separate context)
  // — those are covered by the iframe sandbox in the player.
  const origFetch = window.fetch?.bind(window);
  if (origFetch) {
    window.fetch = function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (isAdUrl(urlStr)) {
        noteBlocked("fetch", urlStr);
        // Return a realistic empty 204 rather than throwing — ad scripts
        // often retry loop on rejection.
        return Promise.resolve(
          new Response(null, { status: 204, statusText: "Blocked" }),
        );
      }
      return origFetch(input, init);
    } as typeof window.fetch;
  }

  const origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const urlStr = typeof url === "string" ? url : String(url);
    if (isAdUrl(urlStr)) {
      noteBlocked("xhr", urlStr);
      // Point at an empty same-origin resource so listeners fire harmlessly.
      return origXhrOpen.call(this, method, "about:blank", ...(rest as []));
    }
    return origXhrOpen.call(this, method, url, ...(rest as []));
  };

  const origBeacon = navigator.sendBeacon?.bind(navigator);
  if (origBeacon) {
    navigator.sendBeacon = function (
      url: string | URL,
      data?: BodyInit | null,
    ): boolean {
      const urlStr = typeof url === "string" ? url : String(url);
      if (isAdUrl(urlStr)) {
        noteBlocked("beacon", urlStr);
        return true; // pretend success so the ad script moves on
      }
      return origBeacon(url, data);
    };
  }

  // ── 3. Cosmetic filtering (element hiding) ────────────────────────────
  // Streaming providers sometimes inject overlay/iframes into the TOP
  // document via postMessage-driven helpers or leaked globals. Remove any
  // element whose src/href points at an ad network, plus classic popup
  // overlay patterns, as soon as they appear.
  const removeAdElements = (root: ParentNode) => {
    const adSelector = AD_DOMAINS.map(
      (d) => `iframe[src*="${d}"],script[src*="${d}"],img[src*="${d}"]`,
    ).join(",");
    root.querySelectorAll(adSelector).forEach((el) => {
      const src =
        (el as HTMLIFrameElement).src || (el as HTMLScriptElement).src || "";
      noteBlocked("dom-element", src);
      el.remove();
    });
    // Classic popup overlay: fixed full-viewport transparent click-catchers.
    root.querySelectorAll("div, a").forEach((el) => {
      const htmlEl = el as HTMLElement;
      const style = htmlEl.style;
      if (
        style.position === "fixed" &&
        (style.zIndex === "2147483647" || parseInt(style.zIndex) > 900000) &&
        (style.inset === "0px" ||
          (style.top === "0px" && style.left === "0px")) &&
        !htmlEl.closest("[data-fuelpro-ui]")
      ) {
        // Only remove if it is a bare click-catcher (no meaningful content).
        if (!htmlEl.textContent?.trim() && htmlEl.children.length === 0) {
          noteBlocked("dom-overlay", htmlEl.className || "overlay");
          el.remove();
        }
      }
    });
  };

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            removeAdElements(node.parentElement ?? document.body);
          }
        });
      }
    });
    const startObserving = () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        removeAdElements(document.body);
      } else {
        setTimeout(startObserving, 100);
      }
    };
    startObserving();
  }

  // ── 4. Scriptlet defusing ─────────────────────────────────────────────
  // document.write is only ever used by legacy ad injectors — neutralize it.
  if (typeof document.write === "function") {
    document.write = function (markup?: unknown) {
      noteBlocked("document.write", String(markup).slice(0, 120));
    } as typeof document.write;
    document.writeln = document.write;
  }

  // ── 5. Top-navigation (redirect-to-another-tab/site) guard ────────────
  // Track user gestures so the guard + the Movies iframe hijack watchdog
  // know what was user-driven. Any pointerdown arms the guard for 3s.
  window.addEventListener(
    "pointerdown",
    () => {
      lastGestureAt = Date.now();
      armNavGuard(3000);
    },
    true,
  );
  // Clicks INSIDE a cross-origin iframe never reach the parent's pointerdown
  // listener. Detect them via the focus heuristic: when the top window
  // blurs and document.activeElement is an IFRAME, the user just clicked
  // inside that frame (the standard cross-origin iframe click tracker).
  // This lets the redirect trap + hijack watchdog treat in-player clicks as
  // user-driven.
  window.addEventListener("blur", () => {
    setTimeout(() => {
      if (
        document.activeElement &&
        document.activeElement.tagName === "IFRAME"
      ) {
        lastGestureAt = Date.now();
        armNavGuard(3000);
      }
    }, 0);
  });
  // While a media player is open (shield engaged) and the guard is armed,
  // trap any attempt to navigate THIS tab away (an ad redirect fired by a
  // click inside the embed iframe). The browser shows its "Leave site?"
  // dialog so the redirect only proceeds if the USER explicitly confirms —
  // the default outcome is the user stays on the site.
  window.addEventListener("beforeunload", (e) => {
    if (!shieldEngaged) return;
    if (Date.now() >= navGuardArmedUntil) return;
    noteBlocked("top-redirect", "navigation blocked while player is active");
    e.preventDefault();
    e.returnValue = "";
  });
}
