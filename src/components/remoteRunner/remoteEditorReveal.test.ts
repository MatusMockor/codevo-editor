import { describe, expect, it, vi } from "vitest";
import { revealRemoteEditorLocation, type RemoteEditorRevealSurface } from "./remoteEditorReveal";

function editorWith(lines: ReadonlyArray<string> | null) {
  const setPosition = vi.fn<RemoteEditorRevealSurface["setPosition"]>();
  const revealPositionInCenter = vi.fn<RemoteEditorRevealSurface["revealPositionInCenter"]>();
  const editor: RemoteEditorRevealSurface = {
    getModel: () =>
      lines === null
        ? null
        : {
            getLineCount: () => lines.length,
            getLineMaxColumn: (lineNumber) => (lines[lineNumber - 1] ?? "").length + 1,
          },
    setPosition,
    revealPositionInCenter,
  };
  return { editor, setPosition, revealPositionInCenter };
}

describe("revealRemoteEditorLocation", () => {
  it("moves the caret to the linked line and column and centers it", () => {
    const { editor, setPosition, revealPositionInCenter } = editorWith(["a", "const x = 1;", "c"]);
    expect(revealRemoteEditorLocation(editor, { line: 2, column: 7 })).toEqual({
      lineNumber: 2,
      column: 7,
    });
    expect(setPosition).toHaveBeenCalledWith({ lineNumber: 2, column: 7 });
    expect(revealPositionInCenter).toHaveBeenCalledWith({ lineNumber: 2, column: 7 });
  });

  it("clamps positions past the end of the server file", () => {
    const { editor } = editorWith(["one", "two"]);
    expect(revealRemoteEditorLocation(editor, { line: 99, column: 50 })).toEqual({
      lineNumber: 2,
      column: 4,
    });
    expect(revealRemoteEditorLocation(editor, { line: 1, column: null })).toEqual({
      lineNumber: 1,
      column: 1,
    });
  });

  it("does nothing without a line or a model", () => {
    const withoutLine = editorWith(["one"]);
    expect(revealRemoteEditorLocation(withoutLine.editor, { line: null, column: null })).toBeNull();
    expect(withoutLine.setPosition).not.toHaveBeenCalled();
    const withoutModel = editorWith(null);
    expect(revealRemoteEditorLocation(withoutModel.editor, { line: 3, column: 1 })).toBeNull();
    expect(withoutModel.setPosition).not.toHaveBeenCalled();
  });
});
