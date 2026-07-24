import { describe, expect, it } from "vitest";
import {
  debugInlineBreakpointCapturesEqual,
  type DebugInlineBreakpointCapture,
} from "./debugInlineBreakpointCapture";

const capture: DebugInlineBreakpointCapture = {
  columnNumber: 7,
  documentPath: "/workspace/a.ts",
  focusEpoch: 1,
  focused: true,
  lineNumber: 4,
  modelIdentity: "model-a",
  modelVersion: 3,
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
  writable: true,
};

describe("debug inline breakpoint capture", () => {
  it("includes the monotonic focus epoch in exact identity", () => {
    expect(debugInlineBreakpointCapturesEqual(capture, { ...capture })).toBe(true);
    expect(debugInlineBreakpointCapturesEqual(capture, { ...capture, focusEpoch: 3 })).toBe(false);
  });
});
