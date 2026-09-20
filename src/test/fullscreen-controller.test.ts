import { describe, expect, it, vi } from "vitest";
import {
  enterFullscreen,
  exitFullscreen,
  isFullscreen,
  installFullscreenState,
  toggleFullscreen,
} from "@/react-app/lib/fullscreen";

/**
 * `installFullscreenState` both listens for and dispatches
 * `fuelpro:fullscreenchange`. Without a re-entrancy guard the dispatch fed
 * straight back into the listener and recursed until the stack overflowed —
 * a `RangeError: Maximum call stack size exceeded` on every app boot, since
 * main.tsx installs the controller unconditionally.
 */
describe("fullscreen controller", () => {
  it("does not recurse when dispatching its own state event", () => {
    const stop = installFullscreenState();
    const seen: unknown[] = [];
    const onEvent = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("fuelpro:fullscreenchange", onEvent);

    // Firing the event must not throw RangeError, and must not loop.
    expect(() => {
      window.dispatchEvent(
        new CustomEvent("fuelpro:fullscreenchange", {
          detail: { active: false },
        }),
      );
    }).not.toThrow();

    window.removeEventListener("fuelpro:fullscreenchange", onEvent);
    stop();

    // Only the event dispatched here should be observed. The controller
    // recomputes state on the event and finds it unchanged, so the idempotence
    // guard swallows its own re-dispatch — that suppression IS the fix. An
    // echo here would mean the guard had been removed and the recursion is
    // back, so the bound below is the assertion that matters.
    expect(seen.length).toBe(1);
    expect(seen.length).toBeLessThan(10);
  });

  it("keeps the fallback class and state check in agreement", async () => {
    expect(isFullscreen()).toBe(false);

    const target = document.createElement("div");
    document.body.appendChild(target);

    await enterFullscreen(target);
    expect(
      document.documentElement.classList.contains("fuelpro-fullscreen-active"),
    ).toBe(true);
    expect(isFullscreen()).toBe(true);

    await exitFullscreen();
    expect(
      document.documentElement.classList.contains("fuelpro-fullscreen-active"),
    ).toBe(false);
    expect(isFullscreen()).toBe(false);

    target.remove();
  });

  it("promotes nested media to its owning fullscreen target", async () => {
    const wrapper = document.createElement("div");
    wrapper.className = "fuelpro-fullscreen-target";
    wrapper.dataset.fuelproFullscreenTarget = "";
    const media = document.createElement("iframe");
    media.dataset.fuelproFullscreenContent = "";
    wrapper.appendChild(media);
    document.body.appendChild(wrapper);

    const request = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(wrapper, "requestFullscreen", {
      configurable: true,
      value: request,
    });

    await enterFullscreen(media);
    expect(request).toHaveBeenCalledTimes(1);
    wrapper.remove();
    await exitFullscreen();
  });

  it("toggles between entered and exited", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const entered = await toggleFullscreen(target);
    expect(entered).toBe(true);
    const exited = await toggleFullscreen(target);
    expect(exited).toBe(false);

    target.remove();
  });

  it("uninstalls its listeners cleanly", () => {
    const stop = installFullscreenState();
    const onEvent = vi.fn();
    window.addEventListener("fuelpro:fullscreenchange", onEvent);
    stop();

    window.dispatchEvent(
      new CustomEvent("fuelpro:fullscreenchange", { detail: { active: true } }),
    );
    window.removeEventListener("fuelpro:fullscreenchange", onEvent);

    // After stop() the controller no longer echoes; only the manual listener
    // above runs.
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
