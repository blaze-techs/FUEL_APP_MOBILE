/**
 * View Zoom + Frame Aspect (APK accessibility) tests.
 *
 * Verifies the pure helpers from ZoomContext: zoom clamping to the 75–200%
 * range with 5% steps, the percentage label, and frame-mode validation.
 * (The provider itself applies persistent localStorage/cloud values the
 * same way the color-theme provider does.)
 */

import { describe, it, expect } from "vitest";
import {
  clampZoom,
  zoomLabel,
  isFrameMode,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  DEFAULT_ZOOM,
  DEFAULT_FRAME,
} from "@/react-app/context/ZoomContext";

describe("clampZoom", () => {
  it("rounds to 5% steps within the range", () => {
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(103)).toBe(105);
    expect(clampZoom(97)).toBe(95);
    expect(clampZoom(60)).toBe(ZOOM_MIN);
    expect(clampZoom(250)).toBe(ZOOM_MAX);
  });

  it("returns the default for non-numeric input", () => {
    expect(clampZoom(undefined)).toBe(DEFAULT_ZOOM);
    expect(clampZoom("abc")).toBe(DEFAULT_ZOOM);
    expect(clampZoom(null)).toBe(DEFAULT_ZOOM);
    expect(clampZoom(NaN)).toBe(DEFAULT_ZOOM);
  });
});

describe("zoomLabel", () => {
  it("formats the percentage label", () => {
    expect(zoomLabel(100)).toBe("100%");
    expect(zoomLabel(75)).toBe("75%");
    expect(zoomLabel(150)).toBe("150%");
  });
});

describe("isFrameMode", () => {
  it("accepts the three frame modes only", () => {
    expect(isFrameMode("device")).toBe(true);
    expect(isFrameMode("wide")).toBe(true);
    expect(isFrameMode("full")).toBe(true);
    expect(isFrameMode("narrow")).toBe(false);
    expect(isFrameMode(undefined)).toBe(false);
    expect(isFrameMode(42)).toBe(false);
  });
});

describe("constants", () => {
  it("defines a sane zoom range with a 5% step and device default frame", () => {
    expect(ZOOM_MIN).toBe(75);
    expect(ZOOM_MAX).toBe(200);
    expect(ZOOM_STEP).toBe(5);
    expect(DEFAULT_ZOOM).toBe(100);
    expect(DEFAULT_FRAME).toBe("device");
  });
});
