import { describe, expect, it } from "vitest";
import { parseInputNumber, inputValueToString } from "@/react-app/utils/inputUtils";

describe("numeric input clearing", () => {
  it("keeps an emptied field empty instead of forcing zero", () => {
    expect(parseInputNumber("")).toBeNull();
    expect(parseInputNumber("   ")).toBeNull();
    expect(inputValueToString(null)).toBe("");
    expect(inputValueToString(undefined)).toBe("");
  });

  it("still accepts an intentional zero", () => {
    expect(parseInputNumber("0")).toBe(0);
    expect(inputValueToString(0)).toBe("0");
  });
});
