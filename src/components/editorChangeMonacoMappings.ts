import type { CSSProperties } from "react";
import type * as Monaco from "monaco-editor";
import type { Breakpoint } from "../domain/debug";
import { formatBreakpointHitCondition } from "../domain/debugBreakpointHitCondition";
import type { EditorChangeHunk, EditorChangeKind } from "../domain/editorChangeMarkers";
import { gitBlameAnnotation, type GitBlameLine } from "../domain/git";

export function editorChangePopoverStyle(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunk: EditorChangeHunk,
  anchorLineNumber: number,
): CSSProperties {
  const layout = editor.getLayoutInfo();
  const clampedAnchorLine = clampNumber(anchorLineNumber, hunk.startLineNumber, hunk.endLineNumber);
  const lineTop = editor.getTopForLineNumber(clampedAnchorLine) - editor.getScrollTop();
  const nextLineTop = editor.getTopForLineNumber(clampedAnchorLine + 1) - editor.getScrollTop();
  const lineHeight = Math.max(20, nextLineTop - lineTop);
  const estimatedHeight = 170;
  const minimumEdgeGap = 12;
  const left = Math.max(54, Math.min(layout.contentLeft + 12, layout.width - 320));
  const belowTop = lineTop + lineHeight + 6;
  const aboveTop = lineTop - estimatedHeight - 6;
  const maxTop = Math.max(minimumEdgeGap, layout.height - estimatedHeight - minimumEdgeGap);
  const preferredTop = belowTop <= maxTop ? belowTop : Math.max(minimumEdgeGap, aboveTop);
  const top = clampNumber(preferredTop, minimumEdgeGap, maxTop);

  return {
    left: `${Math.round(left)}px`,
    maxHeight: `min(360px, calc(100% - ${Math.round(top + minimumEdgeGap)}px))`,
    top: `${Math.round(top)}px`,
    width: `min(620px, calc(100% - ${Math.round(left + minimumEdgeGap)}px))`,
  };
}

export function toEditorChangeDecoration(
  monaco: typeof Monaco,
  hunk: EditorChangeHunk,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      glyphMargin: {
        position: monaco.editor.GlyphMarginLane.Left,
      },
      glyphMarginClassName: `editor-change-glyph editor-change-glyph-${hunk.kind}`,
      glyphMarginHoverMessage: {
        value: `${editorChangeKindLabel(hunk.kind)}. Click to preview or revert.`,
      },
      isWholeLine: true,
      linesDecorationsClassName: `editor-change-line editor-change-line-${hunk.kind}`,
      overviewRuler: {
        color: editorChangeColor(hunk.kind),
        position: monaco.editor.OverviewRulerLane.Left,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 15,
    },
    range: new monaco.Range(hunk.startLineNumber, 1, hunk.endLineNumber, 1),
  };
}

export function toBookmarkDecoration(
  monaco: typeof Monaco,
  lineNumber: number,
): Monaco.editor.IModelDeltaDecoration {
  return {
    options: {
      isWholeLine: true,
      linesDecorationsClassName: "bookmark-gutter-glyph",
      overviewRuler: {
        color: "#f0a73a",
        position: monaco.editor.OverviewRulerLane.Right,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 10,
    },
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
  };
}

export function toBreakpointDecoration(
  monaco: typeof Monaco,
  breakpoint: Breakpoint,
): Monaco.editor.IModelDeltaDecoration {
  if (breakpoint.columnNumber !== undefined) {
    const kindClass = breakpoint.logMessage
      ? " inline-breakpoint-marker-logpoint"
      : breakpoint.condition || breakpoint.hitCondition
        ? " inline-breakpoint-marker-conditional"
        : "";
    return {
      options: {
        after: {
          content: "●",
          inlineClassName: `inline-breakpoint-marker${kindClass} ${breakpointGlyphStateClassName(breakpoint)}`,
        },
        hoverMessage: { value: breakpointHoverMessage(breakpoint) },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        zIndex: 31,
      },
      range: new monaco.Range(
        breakpoint.lineNumber,
        breakpoint.columnNumber,
        breakpoint.lineNumber,
        breakpoint.columnNumber,
      ),
    };
  }

  return {
    options: {
      glyphMargin: {
        position: monaco.editor.GlyphMarginLane.Left,
      },
      glyphMarginClassName: `breakpoint-glyph${breakpoint.logMessage ? " breakpoint-glyph-logpoint" : breakpoint.condition || breakpoint.hitCondition ? " breakpoint-glyph-conditional" : ""} ${breakpointGlyphStateClassName(breakpoint)}`,
      glyphMarginHoverMessage: {
        value: breakpointHoverMessage(breakpoint),
      },
      isWholeLine: false,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      zIndex: 30,
    },
    range: new monaco.Range(breakpoint.lineNumber, 1, breakpoint.lineNumber, 1),
  };
}

export function breakpointHoverMessage(breakpoint: Breakpoint): string {
  const details: string[] = [];
  if (breakpoint.logMessage) details.push(`Log message: ${breakpoint.logMessage}`);
  if (breakpoint.condition) details.push(`Condition: ${breakpoint.condition}`);
  if (breakpoint.hitCondition)
    details.push(`Hit count: ${formatBreakpointHitCondition(breakpoint.hitCondition)}`);
  const kind = breakpoint.logMessage ? "Logpoint" : "Breakpoint";
  return details.length > 0 ? `${kind} — ${details.join("; ")}` : kind;
}

export function toGitBlameDecoration(
  monaco: typeof Monaco,
  line: GitBlameLine,
  now: number,
): Monaco.editor.IModelDeltaDecoration {
  const annotation = gitBlameAnnotation(line, now);

  return {
    options: {
      before: {
        content: annotation,
        // A non-breaking space pads the annotation from the code without
        // injecting selectable spaces into the document text.
        inlineClassName: "git-blame-annotation",
      },
      // Full commit detail on hover (short SHA + author + relative date), the
      // PhpStorm annotation tooltip equivalent.
      hoverMessage: {
        value: `\`${line.sha}\` ${annotation}`,
      },
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
    range: new monaco.Range(line.lineNumber, 1, line.lineNumber, 1),
  };
}

export function findChangeHunkAtLine(
  hunks: readonly EditorChangeHunk[],
  lineNumber: number,
): EditorChangeHunk | null {
  return (
    hunks.find((hunk) => lineNumber >= hunk.startLineNumber && lineNumber <= hunk.endLineNumber) ??
    null
  );
}

export function jumpToChangeHunk(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunks: readonly EditorChangeHunk[],
  direction: "next" | "previous",
): void {
  const target = navigableChangeHunk(
    editor,
    hunks,
    editor.getPosition()?.lineNumber ?? 1,
    direction,
  );
  if (target) revealChangeHunk(editor, target);
}

export function navigateChangeHunkFromPopover(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunks: readonly EditorChangeHunk[],
  fromLine: number,
  direction: "next" | "previous",
): EditorChangeHunk | null {
  const target = navigableChangeHunk(editor, hunks, fromLine, direction);
  if (target) revealChangeHunk(editor, target);
  return target;
}

export function glyphMarginLaneFromMouseEvent(
  event: Monaco.editor.IEditorMouseEvent,
): Monaco.editor.GlyphMarginLane | null {
  const target = event.target as {
    detail?: { glyphMarginLane?: Monaco.editor.GlyphMarginLane };
  };

  return target.detail?.glyphMarginLane ?? null;
}

export function editorChangeKindLabel(kind: EditorChangeKind): string {
  if (kind === "added") return "Added lines";
  if (kind === "deleted") return "Deleted lines";
  return "Modified lines";
}

export function changePreviewText(hunk: EditorChangeHunk): string {
  return hunk.originalLines.length > 0 ? hunk.originalLines.join("\n") : "No previous lines.";
}

export function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function breakpointGlyphStateClassName(breakpoint: Breakpoint): string {
  if (!breakpoint.enabled) return "breakpoint-glyph-disabled";
  if (breakpoint.verified === false) return "breakpoint-glyph-unverified";
  return "breakpoint-glyph-verified";
}

function editorChangeColor(kind: EditorChangeKind): string {
  if (kind === "added") return "#7ddc9f";
  if (kind === "deleted") return "#ef7373";
  return "#e7c66c";
}

function navigableChangeHunk(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunks: readonly EditorChangeHunk[],
  currentLine: number,
  direction: "next" | "previous",
): EditorChangeHunk | null {
  if (hunks.length === 0 || !editor.getModel()) return null;
  const ordered = [...hunks].sort((left, right) => left.startLineNumber - right.startLineNumber);
  return nextChangeHunk(ordered, currentLine, direction);
}

function nextChangeHunk(
  ordered: readonly EditorChangeHunk[],
  currentLine: number,
  direction: "next" | "previous",
): EditorChangeHunk | null {
  if (direction === "next") {
    return ordered.find((hunk) => hunk.startLineNumber > currentLine) ?? ordered[0] ?? null;
  }

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const hunk = ordered[index];
    if (hunk && hunk.startLineNumber < currentLine) return hunk;
  }
  return ordered[ordered.length - 1] ?? null;
}

function revealChangeHunk(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunk: EditorChangeHunk,
): void {
  const position = { column: 1, lineNumber: hunk.startLineNumber };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}
