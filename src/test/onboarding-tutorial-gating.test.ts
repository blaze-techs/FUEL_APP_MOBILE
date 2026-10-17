import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The onboarding tutorial's launch card is a centered `z-[9999]` modal. If it
 * auto-opens while the user is NOT on the dashboard it sits directly on top of
 * whatever surface is rendered and swallows clicks meant for the page beneath
 * — the reported "I click Watch Now and nothing happens" (the Movies modal is
 * at z-[80], far below the coach). These assertions pin the two guards that
 * keep that from recurring:
 *
 *   1. auto-start is gated to the dashboard tab, and
 *   2. any tab switch dismisses an open tutorial.
 */
const home = readFileSync(
  resolve(process.cwd(), "src/react-app/pages/Home.tsx"),
  "utf8",
);

describe("onboarding tutorial cannot intercept other tabs", () => {
  it("only auto-starts the tutorial on the dashboard", () => {
    expect(home).toMatch(
      /tutorial\.shouldAutoStart\s*&&\s*!tutorial\.active\s*&&\s*activeTab === "dashboard"/,
    );
  });

  it("dismisses an open tutorial when the tab changes", () => {
    expect(home).toMatch(/tutorial\.stopTutorial\(\)/);
    expect(home).toMatch(/prevTabForTutorialRef/);
  });

  it("keeps the coach above the movie modal (why the guard is required)", () => {
    const tutorial = readFileSync(
      resolve(process.cwd(), "src/react-app/components/OnboardingTutorial.tsx"),
      "utf8",
    );
    // If the coach were ever lowered below the player, the guards above would
    // be unnecessary — this documents the layering the guards compensate for.
    expect(tutorial).toMatch(/z-\[9999\]/);
  });
});
