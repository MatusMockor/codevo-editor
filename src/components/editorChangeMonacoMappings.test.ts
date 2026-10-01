import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import {
  changePreviewText,
  editorChangePopoverStyle,
  findChangeHunkAtLine,
  jumpToChangeHunk,
  navigateChangeHunkFromPopover,
  toEditorChangeDecoration,
} from "./editorChangeMonacoMappings";

class FakeRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

const monaco = {
  Range: FakeRange,
  editor: {
    GlyphMarginLane: { Left: 1 },
    OverviewRulerLane: { Left: 2, Right: 4 },
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
  },
} as unknown as typeof Monaco;

const hunks: EditorChangeHunk[] = [
  {
    currentLines: ["second"],
    endLineNumber: 9,
    id: "second",
    kind: "modified",
    originalLines: ["old second"],
    originalStartLineNumber: 9,
    startLineNumber: 9,
  },
  {
    currentLines: ["first", "continued"],
    endLineNumber: 4,
    id: "first",
    kind: "added",
    originalLines: [],
    originalStartLineNumber: 3,
    startLineNumber: 3,
  },
];

function editorAt(lineNumber: number, withModel = true) {
  return {
    focus: vi.fn(),
    getModel: vi.fn(() => (withModel ? {} : null)),
    getPosition: vi.fn(() => ({ column: 4, lineNumber })),
    revealPositionInCenter: vi.fn(),
    setPosition: vi.fn(),
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
}

describe("editor change Monaco mappings", () => {
  it("maps change state to stable Monaco decorations", () => {
    expect(toEditorChangeDecoration(monaco, hunks[1])).toMatchObject({
      options: {
        linesDecorationsClassName: "editor-change-line editor-change-line-added",
        linesDecorationsTooltip: "Added lines. Click to preview or revert.",
      },
      range: new FakeRange(3, 1, 4, 1),
    });
  });

  it("draws change hunks as a line-decorations bar, leaving the glyph margin free", () => {
    const decoration = toEditorChangeDecoration(monaco, hunks[0]);

    expect(decoration.options.glyphMarginClassName).toBeUndefined();
    expect(decoration.options.glyphMargin).toBeUndefined();
    expect(decoration.options.linesDecorationsClassName).toBe(
      "editor-change-line editor-change-line-modified",
    );
    expect(decoration.options.overviewRuler?.color).toEqual({
      id: "editorOverviewRuler.modifiedForeground",
    });
    expect(toEditorChangeDecoration(monaco, hunks[1]).options.overviewRuler?.color).toEqual({
      id: "editorOverviewRuler.addedForeground",
    });
  });

  it("finds hunks across their complete line range and renders previews", () => {
    expect(findChangeHunkAtLine(hunks, 4)?.id).toBe("first");
    expect(findChangeHunkAtLine(hunks, 5)).toBeNull();
    expect(changePreviewText(hunks[0])).toBe("old second");
    expect(changePreviewText(hunks[1])).toBe("No previous lines.");
  });

  it("sorts unsorted hunks and wraps next/previous caret navigation", () => {
    const nextEditor = editorAt(9);
    jumpToChangeHunk(nextEditor, hunks, "next");
    expect(nextEditor.setPosition).toHaveBeenCalledWith({
      column: 1,
      lineNumber: 3,
    });

    const previousEditor = editorAt(3);
    jumpToChangeHunk(previousEditor, hunks, "previous");
    expect(previousEditor.setPosition).toHaveBeenCalledWith({
      column: 1,
      lineNumber: 9,
    });
  });

  it("uses the popover anchor and returns the newly revealed hunk", () => {
    const editor = editorAt(100);
    const target = navigateChangeHunkFromPopover(editor, hunks, 3, "next");

    expect(target?.id).toBe("second");
    expect(editor.revealPositionInCenter).toHaveBeenCalledWith({
      column: 1,
      lineNumber: 9,
    });
    expect(editor.focus).toHaveBeenCalledOnce();
  });

  it("does not navigate when the editor has no live model", () => {
    const editor = editorAt(3, false);
    jumpToChangeHunk(editor, hunks, "next");
    expect(editor.setPosition).not.toHaveBeenCalled();
  });

  it("keeps the change popover inside the editor viewport", () => {
    const editor = {
      getLayoutInfo: () => ({ contentLeft: 90, height: 240, width: 800 }),
      getScrollTop: () => 0,
      getTopForLineNumber: (line: number) => line * 20,
    } as unknown as Monaco.editor.IStandaloneCodeEditor;

    expect(editorChangePopoverStyle(editor, hunks[1], 99)).toEqual({
      left: "102px",
      maxHeight: "min(360px, calc(100% - 24px))",
      top: "12px",
      width: "min(620px, calc(100% - 114px))",
    });
  });
});
