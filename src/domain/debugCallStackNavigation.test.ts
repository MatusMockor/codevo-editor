import { describe, expect, it } from "vitest";
import type { StackFrame } from "./debug";
import { selectDebugCallStackNavigationTarget } from "./debugCallStackNavigation";

const frames: StackFrame[] = [
  { column: 2, filePath: "/workspace/a.ts", frameId: 11, lineNumber: 4, name: "top" },
  { column: 1, filePath: null, frameId: 12, lineNumber: 1, name: "native" },
  { column: 7, filePath: "/workspace/b.ts", frameId: 13, lineNumber: 9, name: "bottom" },
];

describe("debug call-stack navigation", () => {
  it("selects top and bottom in stable adapter order without mutating input", () => {
    const before = structuredClone(frames);
    expect(selectDebugCallStackNavigationTarget(frames, 12, "top")?.frameId).toBe(11);
    expect(selectDebugCallStackNavigationTarget(frames, 12, "bottom")?.frameId).toBe(13);
    expect(frames).toEqual(before);
    expect(Object.isFrozen(selectDebugCallStackNavigationTarget(frames, 12, "top"))).toBe(true);
  });

  it("wraps up and down and keeps a pathless frame selectable", () => {
    expect(selectDebugCallStackNavigationTarget(frames, 11, "up")?.frameId).toBe(13);
    expect(selectDebugCallStackNavigationTarget(frames, 13, "down")?.frameId).toBe(11);
    expect(selectDebugCallStackNavigationTarget(frames, 11, "down")).toMatchObject({
      filePath: null,
      frameId: 12,
    });
  });

  it("anchors a null selection to top for down and bottom for up", () => {
    expect(selectDebugCallStackNavigationTarget(frames, null, "top")?.frameId).toBe(11);
    expect(selectDebugCallStackNavigationTarget(frames, null, "down")?.frameId).toBe(11);
    expect(selectDebugCallStackNavigationTarget(frames, null, "bottom")?.frameId).toBe(13);
    expect(selectDebugCallStackNavigationTarget(frames, null, "up")?.frameId).toBe(13);
  });

  it("fails closed for empty, unknown selection, duplicate, and invalid frame IDs", () => {
    expect(selectDebugCallStackNavigationTarget([], null, "top")).toBeNull();
    expect(selectDebugCallStackNavigationTarget(frames, 99, "down")).toBeNull();
    expect(
      selectDebugCallStackNavigationTarget([frames[0], { ...frames[1], frameId: 11 }], 11, "down"),
    ).toBeNull();
    expect(
      selectDebugCallStackNavigationTarget([{ ...frames[0], frameId: 0 }], null, "top"),
    ).toBeNull();
  });
});
