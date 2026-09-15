import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectControls,
  statusLabel,
  isSameOriginFrame,
  focusGameFrame,
  forwardKeysToFrame,
  startGamepadBridge,
  pressedKeysFromGamepad,
  dispatchKeyIntoFrame,
  GAMEPAD_BUTTON_KEYS,
  GAMEPAD_AXIS_KEYS,
  CONTROL_MODES,
  type GameControlStatus,
} from "@/react-app/lib/game-controls";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Minimal fake Gamepad shape used by the bridge tests. */
function fakePad(buttons: Record<number, number> = {}): Gamepad {
  const list: GamepadButton[] = [];
  for (let i = 0; i < 16; i++) {
    const v = buttons[i] ?? 0;
    list.push({
      pressed: v > 0.5,
      touched: v > 0.5,
      value: v,
    } as GamepadButton);
  }
  return {
    id: "fake-pad",
    index: 0,
    connected: true,
    timestamp: Date.now(),
    mapping: "standard",
    axes: [0, 0],
    buttons: list,
    vibrationActuator: null,
    hapticActuators: [],
  } as unknown as Gamepad;
}

function fakeFrame(docStub: unknown = null): HTMLIFrameElement {
  // jsdom iframes have contentDocument === null; for bridge tests we pass a
  // stub document that records dispatched events.
  return {
    src: "/api/game-embed/moto-x3m/",
    contentDocument: docStub,
    contentWindow: (docStub as { window?: unknown } | null)?.window ?? null,
    focus: vi.fn(),
  } as unknown as HTMLIFrameElement;
}

function makeDocStub() {
  const keydowns: string[] = [];
  const keyups: string[] = [];
  const windowKeydowns: string[] = [];
  const target = {
    dispatchEvent: (ev: KeyboardEvent) => {
      if (ev.type === "keydown") keydowns.push(ev.key);
      if (ev.type === "keyup") keyups.push(ev.key);
      return true;
    },
  };
  const doc = {
    body: target,
    documentElement: target,
    defaultView: {
      dispatchEvent: (ev: KeyboardEvent) => {
        if (ev.type === "keydown") windowKeydowns.push(ev.key);
        return true;
      },
    },
    window: {},
  };
  return { doc, target, keydowns, keyups, windowKeydowns };
}

describe("detectControls", () => {
  it("returns keyboard always and mouse on fine/desktop pointers", () => {
    const s = detectControls();
    expect(s.keyboard).toBe(true);
    expect(typeof s.gamepad).toBe("boolean");
    expect(typeof s.gamepadCount).toBe("number");
  });

  it("reports a connected gamepad from navigator.getGamepads", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("fine"),
      media: q,
    }));
    vi.stubGlobal(
      "navigator",
      Object.assign(
        {
          getGamepads: () => [fakePad({ 0: 1 }), null, fakePad({ 1: 0.9 })],
          gamepaddisconnected: null,
          gamepadconnected: null,
        },
        navigator,
      ),
    );
    const s = detectControls();
    expect(s.gamepad).toBe(true);
    expect(s.gamepadCount).toBe(2);
  });

  it("tolerates getGamepads throwing (privacy mode)", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      getGamepads: () => {
        throw new Error("blocked");
      },
    });
    const s = detectControls();
    expect(s.gamepad).toBe(false);
    expect(s.gamepadCount).toBe(0);
  });

  it("detects coarse pointer (touch)", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("coarse") && !q.includes("fine"),
      media: q,
    }));
    const s = detectControls();
    expect(s.touch).toBe(true);
    expect(s.mouse).toBe(false);
  });
});

describe("statusLabel", () => {
  it("builds a human status string", () => {
    const s: GameControlStatus = {
      gamepad: true,
      gamepadCount: 2,
      touch: false,
      mouse: true,
      keyboard: true,
    };
    expect(statusLabel(s)).toContain("keyboard");
    expect(statusLabel(s)).toContain("mouse");
    expect(statusLabel(s)).toContain("2 gamepads");
  });

  it("falls back when nothing is detected", () => {
    const s: GameControlStatus = {
      gamepad: false,
      gamepadCount: 0,
      touch: false,
      mouse: false,
      keyboard: false,
    };
    expect(statusLabel(s)).toBe("no input detected");
  });
});

describe("isSameOriginFrame", () => {
  it("true for our relative mirror paths by definition", () => {
    expect(isSameOriginFrame("/api/game-embed/moto-x3m/")).toBe(true);
    expect(isSameOriginFrame("/api/quenq-embed/8-ball-pool")).toBe(true);
    expect(isSameOriginFrame("/api/game-embed/gd/rvvASMiM/5b0abd/i")).toBe(
      true,
    );
  });

  it("compares absolute URLs against the current origin when available", () => {
    // jsdom default origin is http://localhost:3000.
    expect(isSameOriginFrame("http://localhost:3000/api/game-embed/x")).toBe(
      true,
    );
    expect(isSameOriginFrame("https://archive.org/embed/dosbox-doom")).toBe(
      false,
    );
    expect(isSameOriginFrame("https://classic.minecraft.net/")).toBe(false);
    expect(isSameOriginFrame("https://html5.gamedistribution.com/xyz/")).toBe(
      false,
    );
  });
});

describe("pressedKeysFromGamepad", () => {
  it("maps A/d-pad/X buttons to jump/arrows and stick axes to wasd", () => {
    const pad = fakePad({ 0: 1, 15: 1 });
    pad.axes = [0.9, 0]; // stick right
    const keys = pressedKeysFromGamepad(pad);
    expect(keys).toContain(" "); // A pressed
    expect(keys).toContain("ArrowRight"); // d-pad right
    expect(keys).toContain("d"); // stick right (axis > 0.35)
    expect(keys).toContain("ArrowRight"); // arrow alias for right
    expect(keys).not.toContain("a"); // no left input

    const padUp = fakePad({});
    padUp.axes = [0, -0.9]; // stick up
    const upKeys = pressedKeysFromGamepad(padUp);
    expect(upKeys).toContain("w");
    expect(upKeys).toContain("ArrowUp");

    const padLeft = fakePad({});
    padLeft.axes = [-0.9, 0]; // stick left
    const leftKeys = pressedKeysFromGamepad(padLeft);
    expect(leftKeys).toContain("a");
    expect(leftKeys).toContain("ArrowLeft");
  });

  it("returns nothing for a disconnected/null pad", () => {
    expect(pressedKeysFromGamepad(null)).toEqual([]);
    expect(pressedKeysFromGamepad(undefined)).toEqual([]);
  });

  it("deadzone ignores small axis noise", () => {
    const pad = fakePad({});
    pad.axes = [0.2, -0.2];
    expect(pressedKeysFromGamepad(pad)).toEqual([]);
  });

  it("exposes standard button mapping", () => {
    const byIndex = Object.fromEntries(
      GAMEPAD_BUTTON_KEYS.map((b) => [b.index, b.key]),
    );
    expect(byIndex[0]).toBe(" ");
    expect(byIndex[12]).toBe("ArrowUp");
    expect(byIndex[13]).toBe("ArrowDown");
    expect(byIndex[14]).toBe("ArrowLeft");
    expect(byIndex[15]).toBe("ArrowRight");
    expect(byIndex[9]).toBe("Enter");
    expect(GAMEPAD_AXIS_KEYS.length).toBeGreaterThanOrEqual(2);
    expect(CONTROL_MODES.map((m) => m.value)).toEqual([
      "auto",
      "keyboard",
      "mouse",
      "gamepad",
    ]);
  });
});

describe("dispatchKeyIntoFrame", () => {
  it("dispatches keydown/keyup into the frame document + window", () => {
    const { doc, keydowns, keyups, windowKeydowns } = makeDocStub();
    const frame = fakeFrame(doc);
    expect(dispatchKeyIntoFrame(frame, "ArrowLeft", "keydown")).toBe(true);
    expect(dispatchKeyIntoFrame(frame, "ArrowLeft", "keyup")).toBe(true);
    expect(keydowns).toEqual(["ArrowLeft"]);
    expect(keyups).toEqual(["ArrowLeft"]);
    expect(windowKeydowns).toEqual(["ArrowLeft"]);
  });

  it("returns false when the frame has no contentDocument (cross-origin)", () => {
    const frame = fakeFrame(null);
    expect(dispatchKeyIntoFrame(frame, " ", "keydown")).toBe(false);
  });
});

describe("focusGameFrame", () => {
  it("focuses a live frame", () => {
    const frame = fakeFrame(null);
    expect(focusGameFrame(frame)).toBe(true);
    expect(frame.focus).toHaveBeenCalled();
  });
});

describe("forwardKeysToFrame", () => {
  it("focuses + re-dispatches a key to a same-origin frame when unfocused", () => {
    const { doc, keydowns } = makeDocStub();
    const frame = fakeFrame(doc);
    const stop = forwardKeysToFrame(() => frame);

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(frame.focus).toHaveBeenCalled();
    // The re-dispatched event is delivered synchronously if the frame body is
    // available — in jsdom the parent document is the same DOM, so dispatch on
    // the detached stub doc still records.
    expect(keydowns).toContain("ArrowUp");

    stop();
  });

  it("is inert when the frame is already focused", () => {
    const frame = fakeFrame(null);
    const stop = forwardKeysToFrame(() => frame);
    Object.defineProperty(document, "activeElement", {
      value: frame,
      configurable: true,
    });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(frame.focus).not.toHaveBeenCalled();
    delete (document as { activeElement?: Element }).activeElement;
    stop();
  });
});

describe("startGamepadBridge", () => {
  function stubBridgeEnv(getPads: () => (Gamepad | null)[]) {
    vi.useFakeTimers();
    vi.stubGlobal(
      "navigator",
      Object.assign({}, navigator, { getGamepads: () => getPads() }),
    );
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
  }

  it("bridges a connected gamepad into a same-origin frame (keydown edges)", () => {
    const { doc, keydowns, keyups } = makeDocStub();
    const frame = fakeFrame(doc);
    let pads: (Gamepad | null)[] = [fakePad({}), null];
    stubBridgeEnv(() => pads);

    const statuses: GameControlStatus[] = [];
    const handle = startGamepadBridge(
      () => frame,
      (s) => statuses.push(s),
      50,
    );

    // Press A on the pad.
    pads = [fakePad({ 0: 1 }), null];
    vi.advanceTimersByTime(200);
    expect(keydowns).toContain(" ");

    // Release A.
    pads = [fakePad({}), null];
    vi.advanceTimersByTime(200);
    expect(keyups).toContain(" ");

    handle.stop();
    vi.useRealTimers();
  });

  it("does not bridge a cross-origin frame", () => {
    const frame = fakeFrame(null);
    Object.defineProperty(frame, "src", {
      value: "https://archive.org/embed/x",
      configurable: true,
    });
    const pads: (Gamepad | null)[] = [fakePad({ 0: 1 })];
    stubBridgeEnv(() => pads);

    const statuses: GameControlStatus[] = [];
    const handle = startGamepadBridge(
      () => frame,
      (s) => statuses.push(s),
      50,
    );
    vi.advanceTimersByTime(150);
    // No bridging happened; status reported with the gamepad present.
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0].gamepad).toBe(true);
    handle.stop();
    vi.useRealTimers();
  });
});
