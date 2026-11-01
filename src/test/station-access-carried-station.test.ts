import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regression guard: a shared station-access link must survive the search box.
 *
 * A pre-filled link (`/#/station-access?owner=<uid>&station=<sid>`) arrives with
 * the station in component state and the "Find Your Station" box EMPTY. Typing
 * anything into that box called `handleStationSearch`, which unconditionally
 * cleared the owner/station — silently discarding the station the link carried.
 * The submit then failed with "Please search for and select your station, or
 * enter the IDs manually" even though the link already identified one, and the
 * member had no way to see which station the link pointed at.
 *
 * These are wiring checks (the repo has no component-render harness): the fix is
 * that the clear is gated on the box actually being emptied.
 */

const ROOT = resolve(__dirname, "../..");
const source = readFileSync(
  resolve(ROOT, "src/react-app/pages/StationAccess.tsx"),
  "utf8",
);

/** The body of the debounced station-search handler. */
function searchHandlerBody(): string {
  const start = source.indexOf("const handleStationSearch = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("}, []);", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("station-access: the shared link's station is not discarded by search", () => {
  it("no longer clears the owner/station unconditionally", () => {
    const body = searchHandlerBody();
    // The old shape: setStationQuery(value) immediately followed by the clears.
    expect(body).not.toMatch(
      /setStationQuery\(value\);\s*\n\s*setStationOwnerId\(""\);\s*\n\s*setStationId\(""\);/,
    );
  });

  it("only clears the owner/station when the search box is emptied", () => {
    const body = searchHandlerBody();
    const clearAt = body.indexOf('setStationOwnerId("")');
    expect(clearAt).toBeGreaterThan(-1);
    // The clear must sit inside a `if (!value.trim()) { ... }` guard.
    const guardAt = body.lastIndexOf("if (!value.trim())", clearAt);
    expect(guardAt).toBeGreaterThan(-1);
    const guardToClear = body.slice(guardAt, clearAt);
    expect(guardToClear).toContain("{");
    // And the station id must be cleared in the same guarded block.
    expect(body.slice(clearAt, clearAt + 200)).toContain('setStationId("")');
  });

  it("still runs the search itself regardless of the guard", () => {
    // The guard must gate the CLEAR only — searching must still happen, or a
    // member could never replace a wrong station.
    const body = searchHandlerBody();
    expect(body).toContain("lookupStation(q)");
    const guardAt = body.indexOf("if (!value.trim())");
    const searchAt = body.indexOf("lookupStation(q)");
    expect(searchAt).toBeGreaterThan(guardAt);
  });
});

describe("station-access: the carried station is visible to the member", () => {
  it("renders a confirmation that the link selected a station", () => {
    expect(source).toContain("Station selected from your access link");
  });

  it("shows it only when the link carried a station and no pick has replaced it", () => {
    expect(source).toMatch(
      /stationOwnerId\s*&&\s*stationId\s*&&\s*!selectedStationName\s*&&\s*!grantCode/,
    );
  });

  it("lets the member drop the carried station", () => {
    const at = source.indexOf("Station selected from your access link");
    const block = source.slice(at, at + 1200);
    expect(block).toContain('setStationOwnerId("")');
    expect(block).toContain('setStationId("")');
  });
});

describe("station-access: the 'selected station' chip shows a real station name", () => {
  it("tracks the name of the station the member picked", () => {
    expect(source).toContain("setSelectedStationName(s.stationName)");
  });

  it("does not echo an arbitrary search query as the station name", () => {
    // The old chip rendered `{stationQuery}`, which after the carry fix could be
    // half-typed text rather than a chosen station.
    const chipAt = source.indexOf("Selected station confirmation");
    expect(chipAt).toBeGreaterThan(-1);
    const block = source.slice(chipAt, chipAt + 1400);
    expect(block).toContain("{selectedStationName}");
    expect(block).not.toContain("{stationQuery}");
  });

  it("clears the tracked name when the search box is emptied or changed", () => {
    expect(source).toMatch(
      /setStationQuery\(""\);\s*\n\s*setSelectedStationName\(""\)/,
    );
  });
});
