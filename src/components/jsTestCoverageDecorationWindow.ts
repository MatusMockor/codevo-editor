import type * as Monaco from "monaco-editor";
import type { JsTestCoverageLineDecoration } from "../domain/jsTestCoverageDecorations";

export const MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS = 256;
export const MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS = 128;
export const JS_TEST_COVERAGE_DECORATION_OVERSCAN_LINES = 40;

interface LineWindow {
  readonly endLineNumber: number;
  readonly startLineNumber: number;
}

export function selectVisibleJsTestCoverageDecorations(
  decorations: readonly JsTestCoverageLineDecoration[],
  visibleRanges: readonly Pick<Monaco.Range, "endLineNumber" | "startLineNumber">[],
  lineCount: number,
): readonly JsTestCoverageLineDecoration[] {
  if (decorations.length === 0 || lineCount <= 0) return [];
  const visibleWindows = normalizedLineWindows(visibleRanges, lineCount, 0);
  const overscannedWindows = normalizedLineWindows(
    visibleRanges,
    lineCount,
    JS_TEST_COVERAGE_DECORATION_OVERSCAN_LINES,
  );
  const selected: JsTestCoverageLineDecoration[] = [];
  const selectedLines = new Set<number>();

  appendDecorationsFromWindows(decorations, visibleWindows, selected, selectedLines);
  appendDecorationsFromWindows(decorations, overscannedWindows, selected, selectedLines);
  selected.sort((left, right) => left.lineNumber - right.lineNumber);

  const hitCountsTruncated =
    decorations.length > MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS ||
    selected.length > MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS;
  const hitCountLines = selected
    .filter(({ lineNumber }) => lineBelongsToWindows(lineNumber, visibleWindows))
    .concat(selected.filter(({ lineNumber }) => !lineBelongsToWindows(lineNumber, visibleWindows)))
    .slice(0, MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS);
  const hitCountLineNumbers = new Set(hitCountLines.map(({ lineNumber }) => lineNumber));
  return selected.map((decoration) =>
    hitCountsTruncated
      ? {
          ...decoration,
          hitCountsTruncated: true,
          renderInlineHitCount: hitCountLineNumbers.has(decoration.lineNumber),
        }
      : decoration,
  );
}

function lineBelongsToWindows(lineNumber: number, windows: readonly LineWindow[]): boolean {
  return windows.some(
    ({ endLineNumber, startLineNumber }) =>
      lineNumber >= startLineNumber && lineNumber <= endLineNumber,
  );
}

function appendDecorationsFromWindows(
  decorations: readonly JsTestCoverageLineDecoration[],
  windows: readonly LineWindow[],
  selected: JsTestCoverageLineDecoration[],
  selectedLines: Set<number>,
): void {
  for (const window of windows) {
    let index = lowerBoundByLine(decorations, window.startLineNumber);
    while (
      index < decorations.length &&
      selected.length < MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS
    ) {
      const decoration = decorations[index];
      if (!decoration || decoration.lineNumber > window.endLineNumber) break;
      if (!selectedLines.has(decoration.lineNumber)) {
        selected.push(decoration);
        selectedLines.add(decoration.lineNumber);
      }
      index += 1;
    }
    if (selected.length === MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS) break;
  }
}

function normalizedLineWindows(
  visibleRanges: readonly Pick<Monaco.Range, "endLineNumber" | "startLineNumber">[],
  lineCount: number,
  overscan: number,
): readonly LineWindow[] {
  const boundedLineCount = Math.max(1, Math.trunc(lineCount));
  const source =
    visibleRanges.length > 0
      ? visibleRanges
      : [{ endLineNumber: Math.min(boundedLineCount, 80), startLineNumber: 1 }];
  const windows = source
    .map(({ endLineNumber, startLineNumber }) => ({
      endLineNumber: Math.min(
        boundedLineCount,
        Math.max(startLineNumber, endLineNumber) + overscan,
      ),
      startLineNumber: Math.max(1, Math.min(startLineNumber, endLineNumber) - overscan),
    }))
    .sort((left, right) => left.startLineNumber - right.startLineNumber);
  const merged: LineWindow[] = [];

  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (!previous || window.startLineNumber > previous.endLineNumber + 1) {
      merged.push(window);
      continue;
    }
    merged[merged.length - 1] = {
      endLineNumber: Math.max(previous.endLineNumber, window.endLineNumber),
      startLineNumber: previous.startLineNumber,
    };
  }

  return merged;
}

function lowerBoundByLine(
  decorations: readonly JsTestCoverageLineDecoration[],
  lineNumber: number,
): number {
  let lower = 0;
  let upper = decorations.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((decorations[middle]?.lineNumber ?? Number.POSITIVE_INFINITY) < lineNumber) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
}
