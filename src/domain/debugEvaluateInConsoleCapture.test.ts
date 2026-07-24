import { describe, expect, it } from "vitest";
import {
  debugEvaluateInConsoleCapturesEqual,
  type DebugEvaluateInConsoleCapture,
} from "./debugEvaluateInConsoleCapture";

const capture: DebugEvaluateInConsoleCapture = {
  currentLineText: "account.total",
  documentPath: "/workspace/src/app.ts",
  focused: true,
  modelIdentity: "model-1",
  modelVersion: 7,
  selection: { endColumn: 14, endLineNumber: 1, startColumn: 1, startLineNumber: 1 },
  selectionText: "account.total",
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
};

describe("Debug Evaluate in Console capture", () => {
  it("matches only an exact focused editor snapshot", () => {
    expect(debugEvaluateInConsoleCapturesEqual(capture, { ...capture })).toBe(true);
    for (const changed of [
      { ...capture, currentLineText: "account.tax" },
      { ...capture, documentPath: "/workspace/src/other.ts" },
      { ...capture, focused: false },
      { ...capture, modelIdentity: "model-2" },
      { ...capture, modelVersion: 8 },
      { ...capture, selectionText: "account" },
      { ...capture, selection: { ...capture.selection, endColumn: 8 } },
      { ...capture, workspaceOwnerKey: "owner-b" },
      { ...capture, workspaceRoot: "/other" },
    ]) {
      expect(debugEvaluateInConsoleCapturesEqual(capture, changed)).toBe(false);
    }
  });
});
