import { describe, expect, it } from "vitest";
import { editorCursorCapturesEqual, type EditorCursorCapture } from "./editorCursorCapture";

const capture: EditorCursorCapture = {
  content: "user.profile.name",
  documentPath: "/workspace/src/app.ts",
  modelIdentity: "model-1",
  modelVersion: 7,
  position: { column: 14, lineNumber: 1 },
  workspaceOwnerKey: "owner-a",
  workspaceRoot: "/workspace",
};

describe("editor cursor capture", () => {
  it("matches only an exact immutable editor snapshot", () => {
    expect(editorCursorCapturesEqual(capture, { ...capture })).toBe(true);

    for (const changed of [
      { ...capture, content: `${capture.content} ` },
      { ...capture, documentPath: "/workspace/src/other.ts" },
      { ...capture, modelIdentity: "model-2" },
      { ...capture, modelVersion: 8 },
      { ...capture, position: { ...capture.position, column: 15 } },
      { ...capture, position: { ...capture.position, lineNumber: 2 } },
      { ...capture, workspaceOwnerKey: "owner-b" },
      { ...capture, workspaceRoot: "/workspace-b" },
    ]) {
      expect(editorCursorCapturesEqual(capture, changed)).toBe(false);
    }
  });
});
