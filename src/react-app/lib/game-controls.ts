/**
 * game-controls — in-game input helper for the Unified Player.
 *
 * Solves the "controls aren't working" problem in every browser game embed:
 *
 *   1. FOCUS — an embedded <iframe> only receives keyboard/mouse input when
 *      IT is focused. If the user types before clicking inside the game (or
 *      focuses the modal chrome instead), keystrokes go to the parent page,
 *      NOT the game. We auto-focus the game frame on open and on any click on
 *      the playing surface, and forward stray keys into the frame.
 *
 *   2. CONTROL MODES — the user can pick which control set to use:
 *        auto     = whatever is detected (recommended)
 *        keyboard = classic WASD/arrows keyboard play
 *        mouse    = point-and-click / drag play (touch included)
 *        gamepad  = physical controller; same-origin mirrors get a
 *                   gamepad → keyboard bridge so ANY gamepad works even for
 *                   games that only listen to keyboard.
 *
 *   3. AUTO-DETECTION — we poll navigator.getGamepads() (connect/disconnect)
 *      and pointer media queries to tell the user what input is live.
 *
 *   4. SAME-ORIGIN BRIDGE — games served THROUGH our own mirrors
 *      (/api/game-embed/*, /api/quenq-embed/*) share our origin, so we can
 *      reach into iframe.contentDocument and synthesize key events from a
 *      connected gamepad. Cross-origin embeds (archive.org, classic.minecraft)
 *      keep their own native gamepad support + the `gamepad` permission policy
 *      token on the iframe — we still focus them and report honest status.
 *
 * All functions are DOM-guarded so this file stays vitest-safe (no side
 * effects at import time).
 */

export type ControlMode = "auto" | "keyboard" | "mouse" | "gamepad";

export interface GameControlStatus {
  /** A physical controller is currently connected (or detected recently). */
  gamepad: boolean;
  /** Number of connected gamepads. */
  gamepadCount: number;
  /** Coarse pointer (touchscreen) detected. */
  touch: boolean;
  /** A mouse/fine pointer is available. */
  mouse: boolean;
  /** Keyboard is always available in browsers. */
  keyboard: boolean;
}

export const CONTROL_MODES: {
  value: ControlMode;
  label: string;
  hint: string;
}[] = [
  { value: "auto", label: "Auto", hint: "Use whatever input is detected" },
  { value: "keyboard", label: "Keyboard", hint: "WASD / arrows, Space, Enter" },
  { value: "mouse", label: "Mouse / touch", hint: "Point, click, drag, swipe" },
  {
    value: "gamepad",
    label: "Controller",
    hint: "Plug in a gamepad (same-origin games get a keyboard bridge)",
  },
];

/** Detected-status label shown in the player header. */
export function statusLabel(s: GameControlStatus): string {
  const parts: string[] = [];
  if (s.keyboard) parts.push("keyboard");
  if (s.mouse) parts.push("mouse");
  if (s.touch) parts.push("touch");
  if (s.gamepadCount > 0)
    parts.push(`${s.gamepadCount} gamepad${s.gamepadCount > 1 ? "s" : ""}`);
  if (!parts.length) return "no input detected";
  return parts.join(" · ");
}

/** Poll the live controller + pointer state (safe outside browsers). */
export function detectControls(): GameControlStatus {
  const nav =
    typeof navigator !== "undefined"
      ? navigator
      : (undefined as unknown as Navigator);
  const gamepads: (Gamepad | null)[] = [];
  try {
    const gps = nav?.getGamepads?.();
    if (gps) {
      for (let i = 0; i < gps.length; i++) if (gps[i]) gamepads.push(gps[i]);
    }
  } catch {
    // getGamepads can throw in privacy modes — treat as no gamepads.
  }
  const coarse =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const fine =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches;
  return {
    gamepad: gamepads.length > 0,
    gamepadCount: gamepads.length,
    touch: coarse,
    mouse: fine || !coarse, // desktop defaults to a mouse
    keyboard: true,
  };
}

/**
 * True when the frame URL shares our own origin (our ad-free mirrors). Only
 * same-origin frames can be reached for the gamepad→keyboard bridge.
 *
 * Relative paths (our /api/game-embed + /api/quenq-embed mirrors) are
 * same-origin by definition; absolute URLs are compared to the current page
 * origin when available (in a browser), otherwise treated as foreign.
 */
export function isSameOriginFrame(src: string): boolean {
  if (src.startsWith("/")) return true;
  try {
    const loc = typeof window !== "undefined" ? window.location : undefined;
    if (!loc) return false;
    return new URL(src, loc.href).origin === loc.origin;
  } catch {
    return false;
  }
}

/** Best-effort focus of the game frame (blurring any parent focus first). */
export function focusGameFrame(frame: HTMLIFrameElement | null): boolean {
  if (!frame) return false;
  try {
    if (typeof document !== "undefined" && document.activeElement === frame)
      return true;
    frame.focus({ preventScroll: true });
    // Some engines defer — try again on next frame for robustness.
    window.setTimeout(() => {
      try {
        if (frame && document.activeElement !== frame)
          frame.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a temporary "key forwarder" on the PARENT document while the player
 * is open. When the user presses a key and the game frame is NOT focused, we
 * focus it so the very next keystroke lands in the game. For same-origin
 * frames we re-dispatch the keystroke immediately so the FIRST press works
 * too.
 */
export function forwardKeysToFrame(
  getFrame: () => HTMLIFrameElement | null,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return () => {};
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const frame = getFrame();
    if (!frame) return;
    const active = document.activeElement;
    if (active === frame) return; // already focused — native delivery
    // Ignore modifier-only chords and typed-into-input helpers.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT")
    ) {
      return;
    }
    focusGameFrame(frame);
    // Same-origin mirrors: deliver this keystroke to the game immediately.
    const cdoc = frame.contentDocument;
    if (isSameOriginFrame(frame.src) && cdoc) {
      const target = cdoc.body || cdoc.documentElement;
      if (target) {
        target.dispatchEvent(
          new KeyboardEvent(e.type, {
            key: e.key,
            code: e.code,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        if (typeof frame.contentWindow?.dispatchEvent === "function") {
          frame.contentWindow.dispatchEvent(
            new KeyboardEvent(e.type, { key: e.key, code: e.code }),
          );
        }
      }
    }
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}

// ─── Gamepad → keyboard bridge (same-origin mirrors only) ─────────────────
//
// Many simple HTML5/Canvas games only listen to keyboard events. A connected
// gamepad produces NO keystrokes, so those games ignore it. For same-origin
// frames (our mirrors) we map gamepad buttons/axes → synthesized key events
// dispatched into the frame's document, so a controller plays every game.
//
// Button map (standard mapping used by most pads + browser gamepad API):
//   0 A, 1 B, 2 X, 3 Y, 12 D-pad up, 13 D-pad down, 14 D-pad left, 15 D-pad right,
//   9 Start, 8 Select/Back, 4 LB, 5 RB, 6 LT, 7 RT, 10/11 stick presses.

export interface GamepadKeyMap {
  [buttonIndex: string]: string; // button index (string) → KeyboardEvent.key
}

export const GAMEPAD_BUTTON_KEYS: { index: number; key: string }[] = [
  { index: 0, key: " " }, // A → jump / confirm
  { index: 1, key: "e" }, // B → interact
  { index: 2, key: " " }, // X → jump/confirm (alt)
  { index: 3, key: "Shift" }, // Y → run
  { index: 4, key: "q" }, // LB
  { index: 5, key: "w" }, // RB
  { index: 6, key: "r" }, // LT
  { index: 7, key: "f" }, // RT → fire
  { index: 8, key: "Escape" }, // Select/Back
  { index: 9, key: "Enter" }, // Start
  { index: 12, key: "ArrowUp" }, // D-pad up
  { index: 13, key: "ArrowDown" }, // D-pad down
  { index: 14, key: "ArrowLeft" }, // D-pad left
  { index: 15, key: "ArrowRight" }, // D-pad right
];

export const GAMEPAD_AXIS_KEYS: {
  axis: number;
  neg: [string, string];
  pos: [string, string];
}[] = [
  // Left stick: axis 0 (x), axis 1 (y)
  { axis: 0, neg: ["a", "ArrowLeft"], pos: ["d", "ArrowRight"] },
  { axis: 1, neg: ["w", "ArrowUp"], pos: ["s", "ArrowDown"] },
];

/** Build the current pressed-key set from a Gamepad + a mapping table. */
export function pressedKeysFromGamepad(
  pad: Gamepad | null | undefined,
  buttons = GAMEPAD_BUTTON_KEYS,
  axes = GAMEPAD_AXIS_KEYS,
): string[] {
  const keys = new Set<string>();
  if (!pad) return [];
  for (const b of buttons) {
    const btn = pad.buttons[b.index];
    if (
      btn &&
      (btn.pressed || (typeof btn.value === "number" && btn.value > 0.5))
    ) {
      keys.add(b.key);
    }
  }
  const DEAD = 0.35;
  for (const a of axes) {
    let v = 0;
    try {
      v = pad.axes[a.axis] ?? 0;
    } catch {
      v = 0;
    }
    if (v > DEAD) keys.add(a.pos[0]);
    else if (v < -DEAD) keys.add(a.neg[0]);
    // Also emit the arrow alias so games that only read arrows still move.
    if (v > DEAD) keys.add(a.pos[1]);
    else if (v < -DEAD) keys.add(a.neg[1]);
  }
  return [...keys];
}

/** Dispatch a synthetic KeyboardEvent into a same-origin frame's document. */
export function dispatchKeyIntoFrame(
  frame: HTMLIFrameElement | null,
  key: string,
  type: "keydown" | "keyup",
): boolean {
  if (!frame) return false;
  try {
    const doc = frame.contentDocument;
    if (!doc) return false;
    const target = doc.body || doc.documentElement;
    if (!target) return false;
    const init: KeyboardEventInit = {
      key,
      code: "GamepadButton",
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    target.dispatchEvent(new KeyboardEvent(type, init));
    // Deliver on window as well — many games register key handlers there.
    if (typeof doc.defaultView?.dispatchEvent === "function") {
      doc.defaultView.dispatchEvent(new KeyboardEvent(type, init));
    }
    return true;
  } catch {
    return false; // cross-origin → can't bridge
  }
}

export interface GamepadBridgeHandle {
  frame: HTMLIFrameElement | null;
  stop: () => void;
  /** Set true when a frame switches to cross-origin — bridge is inert. */
  bridged: boolean;
  /** Internal flag — true once .stop() has been called. */
  stopped: boolean;
}

/**
 * Start polling a gamepad and bridging its input to a same-origin frame.
 * Fires onStatus whenever the connection/pressed-set changes.
 * Returns a handle with .stop().
 */
export function startGamepadBridge(
  getFrame: () => HTMLIFrameElement | null,
  onStatus?: (s: GameControlStatus, pressed: string[]) => void,
  intervalMs = 100,
): GamepadBridgeHandle {
  let intervals: number[] = [];
  let timers: number[] = [];
  let onConnect: () => void = () => {};

  const cleanupWindow = () => {
    if (
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onConnect);
    }
  };

  const handle: GamepadBridgeHandle = {
    frame: null,
    stopped: false,
    stop: () => {
      handle.stopped = true;
      for (const t of timers) window.clearTimeout(t);
      for (const i of intervals) window.clearInterval(i);
      intervals = [];
      timers = [];
      cleanupWindow();
    },
    get bridged() {
      const f = getFrame();
      return !!f && isSameOriginFrame(f.src);
    },
  };

  onConnect = () => {
    timers.push(window.setTimeout(tick, 0));
  };

  // Track pressed key state per pad so we only emit edges (down on press,
  // up on release) instead of spamming repeats.
  const prevByPad = new Map<number, string[]>();

  const tick = () => {
    if (handle.stopped) return;
    const frame = getFrame();
    const sameOrigin = !!frame && isSameOriginFrame(frame.src);
    const status = detectControls();
    if (!status.gamepad || !frame || !sameOrigin) {
      onStatus?.(status, []);
      prevByPad.clear();
      return;
    }
    let nav: Navigator | undefined;
    try {
      nav = typeof navigator !== "undefined" ? navigator : undefined;
    } catch {
      nav = undefined;
    }
    let pads: (Gamepad | null)[] = [];
    try {
      pads = nav?.getGamepads?.() ?? [];
    } catch {
      pads = [];
    }
    const pressedAll: string[] = [];
    pads.forEach((pad, idx) => {
      if (!pad) {
        prevByPad.delete(idx);
        return;
      }
      const now = pressedKeysFromGamepad(pad);
      const prev = prevByPad.get(idx) ?? [];
      // Emit keydown edges for newly pressed keys.
      for (const k of now) {
        if (!prev.includes(k)) dispatchKeyIntoFrame(frame, k, "keydown");
      }
      // Emit keyup edges for released keys.
      for (const k of prev) {
        if (!now.includes(k)) dispatchKeyIntoFrame(frame, k, "keyup");
      }
      prevByPad.set(idx, now);
      // Nudge focus into the frame so the game actually receives input.
      if (now.length) focusGameFrame(frame);
      pressedAll.push(...now.map((k) => `${idx}:${k}`));
    });
    onStatus?.(status, pressedAll);
  };

  const iv = window.setInterval(tick, intervalMs);
  intervals.push(iv);
  tick();

  // React to connect/disconnect events immediately.
  if (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onConnect);
  }

  return handle;
}
