/**
 * Regression guard for the fullscreen state notifier.
 *
 * `installFullscreenState` subscribes to the very `fuelpro:fullscreenchange`
 * event it dispatches. If the notifier is not idempotent, receiving the event
 * re-dispatches it, which is received again — an unbounded synchronous chain
 * reported in production as "RangeError: Maximum call stack size exceeded" on
 * every page load (a listener on an event it also emits).
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  dispatchFullscreenState,
  installFullscreenState,
  resetFullscreenState,
} from "@/react-app/lib/fullscreen";

beforeEach(() => {
  resetFullscreenState();
  document.documentElement.classList.remove("fuelpro-fullscreen-active");
  document.body.classList.remove("fuelpro-fullscreen-active");
});

describe("fullscreen state notification", () => {
  it("installFullscreenState does not recurse on its own event", () => {
    const uninstall = installFullscreenState();
    // If the notifier echoes its own event this throws RangeError instead of
    // returning, which is exactly the production symptom.
    expect(() => dispatchFullscreenState(false)).not.toThrow();
    expect(() => dispatchFullscreenState(false)).not.toThrow();
    uninstall();
  });

  it("announces a repeated state only once", () => {
    // No install() here: in jsdom there is no real fullscreen element, so the
    // installer's own sync would legitimately report false and interleave with
    // the pings below. This test isolates the idempotence guard itself.
    const seen: boolean[] = [];
    const onChange = (e: Event) =>
      seen.push(Boolean((e as CustomEvent).detail?.active));
    window.addEventListener("fuelpro:fullscreenchange", onChange);

    dispatchFullscreenState(false);
    dispatchFullscreenState(false); // repeat must be suppressed
    dispatchFullscreenState(true);
    dispatchFullscreenState(true); // repeat must be suppressed

    window.removeEventListener("fuelpro:fullscreenchange", onChange);
    expect(seen).toEqual([false, true]);
  });

  it("does not treat its own class as fullscreen evidence", () => {
    const uninstall = installFullscreenState();
    // No real fullscreen element exists in jsdom, so the class must not be set
    // by install()'s initial sync (previously isFullscreen() read the class
    // back, making the state self-confirming).
    expect(
      document.documentElement.classList.contains("fuelpro-fullscreen-active"),
    ).toBe(false);
    uninstall();
  });
});
