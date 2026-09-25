import { describe, expect, it } from "vitest";
import { debugExceptionRows, nextExceptionPauseMode } from "./debugExceptionRows";

describe("debugExceptionRows", () => {
  it("shows two rows with implied uncaught when all exceptions pause", () => {
    expect(debugExceptionRows("none")).toEqual([
      { id: "all", label: "All exceptions", checked: false, implied: false },
      { id: "uncaught", label: "Uncaught exceptions", checked: false, implied: false },
    ]);
    expect(debugExceptionRows("uncaught").map((row) => row.checked)).toEqual([false, true]);
    expect(debugExceptionRows("all")).toEqual([
      { id: "all", label: "All exceptions", checked: true, implied: false },
      { id: "uncaught", label: "Uncaught exceptions", checked: true, implied: true },
    ]);
  });
});

describe("nextExceptionPauseMode", () => {
  it.each([
    ["none", "uncaught", "uncaught"],
    ["uncaught", "uncaught", "none"],
    ["all", "uncaught", "none"],
    ["none", "all", "all"],
    ["uncaught", "all", "all"],
    ["all", "all", "uncaught"],
  ] as const)("%s + toggle %s -> %s", (mode, row, expected) => {
    expect(nextExceptionPauseMode(mode, row)).toBe(expected);
  });
});
