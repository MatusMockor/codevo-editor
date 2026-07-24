import { describe, expect, it } from "vitest";
import {
  breakpointHitConditionError,
  formatBreakpointHitCondition,
  parseBreakpointHitCondition,
} from "./debugBreakpointHitCondition";

describe("debug breakpoint hit conditions", () => {
  it.each([
    ["5", { kind: "equals", count: 5 }, "5"],
    [">=12", { kind: "greaterOrEqual", count: 12 }, ">=12"],
    ["%3", { kind: "multiple", count: 3 }, "%3"],
    [" 0002 ", { kind: "equals", count: 2 }, "2"],
    [
      String(Number.MAX_SAFE_INTEGER),
      { kind: "equals", count: Number.MAX_SAFE_INTEGER },
      String(Number.MAX_SAFE_INTEGER),
    ],
  ] as const)("parses and canonically formats %s", (input, expected, formatted) => {
    const parsed = parseBreakpointHitCondition(input);
    expect(parsed).toEqual(expected);
    expect(parsed && formatBreakpointHitCondition(parsed)).toBe(formatted);
    expect(breakpointHitConditionError(input)).toBeNull();
  });

  it("treats blank input as an optional cleared value", () => {
    expect(parseBreakpointHitCondition("   ")).toBeNull();
    expect(breakpointHitConditionError("   ")).toBeNull();
    expect(formatBreakpointHitCondition(null)).toBe("");
  });

  it.each(["0", ">=0", "%0", "-1", "> 2", "2.5", "once", "9007199254740992"])(
    "rejects invalid input %j with an accessible error",
    (input) => {
      expect(parseBreakpointHitCondition(input)).toBeNull();
      expect(breakpointHitConditionError(input)).toMatch(/\S/);
    },
  );
});
