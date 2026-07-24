import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type { EditorChangeHunk } from "../domain/editorChangeMarkers";
import {
  changePreviewText,
  editorChangePopoverStyle,
  findChangeHunkAtLine,
  jumpToChangeHunk,
  navigateChangeHunkFromPopover,
  toBreakpointDecoration,
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
  it("maps change and breakpoint state to stable Monaco decorations", () => {
    expect(toEditorChangeDecoration(monaco, hunks[1])).toMatchObject({
      options: {
        glyphMarginClassName: "editor-change-glyph editor-change-glyph-added",
        glyphMarginHoverMessage: {
          value: "Added lines. Click to preview or revert.",
        },
        linesDecorationsClassName: "editor-change-line editor-change-line-added",
      },
      range: new FakeRange(3, 1, 4, 1),
    });

    expect(
      toBreakpointDecoration(monaco, {
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "bp",
        lineNumber: 12,
        verified: false,
      }),
    ).toMatchObject({
      options: {
        glyphMarginClassName: "breakpoint-glyph breakpoint-glyph-unverified",
        glyphMarginHoverMessage: { value: "Breakpoint" },
      },
      range: new FakeRange(12, 1, 12, 1),
    });

    expect(
      toBreakpointDecoration(monaco, {
        condition: "count > 3",
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "conditional",
        lineNumber: 14,
        verified: true,
      }),
    ).toMatchObject({
      options: {
        glyphMarginClassName:
          "breakpoint-glyph breakpoint-glyph-conditional breakpoint-glyph-verified",
        glyphMarginHoverMessage: { value: "Breakpoint — Condition: count > 3" },
      },
    });

    expect(
      toBreakpointDecoration(monaco, {
        condition: "ready",
        enabled: true,
        filePath: "/workspace/app.ts",
        hitCondition: { count: 5, kind: "greaterOrEqual" },
        id: "composed",
        lineNumber: 15,
      }),
    ).toMatchObject({
      options: {
        glyphMarginClassName: expect.stringContaining("breakpoint-glyph-conditional"),
        glyphMarginHoverMessage: {
          value: "Breakpoint — Condition: ready; Hit count: >=5",
        },
      },
    });

    expect(
      toBreakpointDecoration(monaco, {
        condition: "ready",
        enabled: true,
        filePath: "/workspace/app.ts",
        hitCondition: { count: 3, kind: "multiple" },
        id: "logpoint",
        lineNumber: 16,
        logMessage: "value={value}",
      }),
    ).toMatchObject({
      options: {
        glyphMarginClassName: expect.stringContaining("breakpoint-glyph-logpoint"),
        glyphMarginHoverMessage: {
          value: "Logpoint — Log message: value={value}; Condition: ready; Hit count: %3",
        },
      },
    });

    expect(
      toBreakpointDecoration(monaco, {
        columnNumber: 7,
        condition: "ready",
        enabled: false,
        filePath: "/workspace/app.ts",
        hitCondition: { count: 2, kind: "greaterOrEqual" },
        id: "inline-conditional",
        lineNumber: 18,
        verified: false,
      }),
    ).toMatchObject({
      options: {
        after: {
          content: "●",
          inlineClassName: expect.stringMatching(
            /inline-breakpoint-marker-conditional.*breakpoint-glyph-disabled/,
          ),
        },
        hoverMessage: {
          value: "Breakpoint — Condition: ready; Hit count: >=2",
        },
      },
      range: new FakeRange(18, 7, 18, 7),
    });

    expect(
      toBreakpointDecoration(monaco, {
        columnNumber: 11,
        enabled: true,
        filePath: "/workspace/app.ts",
        id: "inline-logpoint",
        lineNumber: 18,
        logMessage: "value={value}",
      }),
    ).toMatchObject({
      options: {
        after: {
          inlineClassName: expect.stringContaining("inline-breakpoint-marker-logpoint"),
        },
        hoverMessage: { value: "Logpoint — Log message: value={value}" },
      },
      range: new FakeRange(18, 11, 18, 11),
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
