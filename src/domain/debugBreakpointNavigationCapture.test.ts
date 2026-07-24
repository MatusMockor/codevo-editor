import { describe, expect, it } from "vitest";
import {
  debugBreakpointNavigationCapturesEqual,
  type DebugBreakpointNavigationCapture,
} from "./debugBreakpointNavigationCapture";

const capture: DebugBreakpointNavigationCapture = {
  columnNumber: 3,
  documentPath: "/workspace/src/app.ts",
  focused: true,
  lineNumber: 7,
  modelIdentity: "model-a",
  modelVersion: 3,
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
};

describe("debug breakpoint navigation capture", () => {
  it("matches only an exact focused editor snapshot", () => {
    expect(debugBreakpointNavigationCapturesEqual(capture, { ...capture })).toBe(true);
    for (const changed of [
      { ...capture, documentPath: "/workspace/src/other.ts" },
      { ...capture, focused: false },
      { ...capture, columnNumber: 4 },
      { ...capture, lineNumber: 8 },
      { ...capture, modelIdentity: "model-b" },
      { ...capture, modelVersion: 4 },
      { ...capture, workspaceOwnerKey: "owner-b" },
      { ...capture, workspaceRoot: "/other" },
    ]) {
      expect(debugBreakpointNavigationCapturesEqual(capture, changed)).toBe(false);
    }
  });
});
