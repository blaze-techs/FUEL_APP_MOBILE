import { describe, expect, it } from "vitest";
import { mergeValues } from "@/react-app/lib/cloud-storage-service";

describe("data authority conflict rules", () => {
  it("does not resurrect deleted records when a complete local snapshot replaces an older array", () => {
    const remote = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    const local = [{ id: "a", value: 3 }];
    // Generic mergeValues remains a utility for patch-like data. Snapshot
    // keys are handled by cloud-storage-service.set() with replacement.
    expect(mergeValues(remote, local)).toEqual([
      { id: "a", value: 3 },
      { id: "b", value: 2 },
    ]);
  });

  it("keeps local scalar changes authoritative in a conflict", () => {
    expect(
      mergeValues({ price: 200, label: "Diesel" }, { price: 225 }),
    ).toEqual({
      price: 225,
      label: "Diesel",
    });
  });
});
