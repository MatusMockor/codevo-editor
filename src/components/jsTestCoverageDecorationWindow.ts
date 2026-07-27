import type * as Monaco from "monaco-editor";
import type { JsTestCoverageLine } from "../domain/jsTestCoverage";
import {
  jsTestCoverageDecorationForLine,
  type JsTestCoverageLineDecoration,
} from "../domain/jsTestCoverageDecorations";

export const MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS = 256;
export const MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS = 128;
export const MAX_JS_TEST_COVERAGE_VISIBLE_RANGES = 64;
export const JS_TEST_COVERAGE_DECORATION_OVERSCAN_LINES = 40;

interface LineWindow {
  readonly endLineNumber: number;
  readonly startLineNumber: number;
}

interface LineWindowProjection {
  readonly truncated: boolean;
  readonly windows: readonly LineWindow[];
}

export function selectVisibleJsTestCoverageDecorations(
  lines: readonly JsTestCoverageLine[],
  visibleRanges: readonly Pick<Monaco.Range, "endLineNumber" | "startLineNumber">[],
  lineCount: number,
): readonly JsTestCoverageLineDecoration[] {
  if (lines.length === 0 || lineCount <= 0) return [];
  const visibleProjection = normalizedLineWindows(visibleRanges, lineCount, 0);
  const overscannedProjection = normalizedLineWindows(
    visibleRanges,
    lineCount,
    JS_TEST_COVERAGE_DECORATION_OVERSCAN_LINES,
  );
  const visibleWindows = visibleProjection.windows;
  const overscannedWindows = overscannedProjection.windows;
  const visibleRangesTruncated = visibleProjection.truncated || overscannedProjection.truncated;
  const selected: JsTestCoverageLineDecoration[] = [];
  const selectedLines = new Set<number>();

  appendDecorationsFromWindows(lines, visibleWindows, selected, selectedLines);
  appendDecorationsFromWindows(lines, overscannedWindows, selected, selectedLines);
  selected.sort((left, right) => left.lineNumber - right.lineNumber);

  const hitCountsTruncated =
    lines.length > MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS ||
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
          ...(visibleRangesTruncated ? { visibleRangesTruncated: true } : {}),
        }
      : visibleRangesTruncated
        ? { ...decoration, visibleRangesTruncated: true }
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
  lines: readonly JsTestCoverageLine[],
  windows: readonly LineWindow[],
  selected: JsTestCoverageLineDecoration[],
  selectedLines: Set<number>,
): void {
  for (const window of windows) {
    let index = lowerBoundByLine(lines, window.startLineNumber);
    while (index < lines.length && selected.length < MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS) {
      const line = lines[index];
      if (!line || line.lineNumber > window.endLineNumber) break;
      if (!selectedLines.has(line.lineNumber)) {
        selected.push(jsTestCoverageDecorationForLine(line));
        selectedLines.add(line.lineNumber);
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
): LineWindowProjection {
  const boundedLineCount = Math.max(1, Math.trunc(lineCount));
  const source =
    visibleRanges.length > 0
      ? visibleRanges
      : [{ endLineNumber: Math.min(boundedLineCount, 80), startLineNumber: 1 }];
  const retainedCount = Math.min(source.length, MAX_JS_TEST_COVERAGE_VISIBLE_RANGES);
  const windows: LineWindow[] = [];
  for (let index = 0; index < retainedCount; index += 1) {
    const range = source[index];
    if (!range) continue;
    const { endLineNumber, startLineNumber } = range;
    windows.push({
      endLineNumber: Math.min(
        boundedLineCount,
        Math.max(startLineNumber, endLineNumber) + overscan,
      ),
      startLineNumber: Math.max(1, Math.min(startLineNumber, endLineNumber) - overscan),
    });
  }
  windows.sort((left, right) => left.startLineNumber - right.startLineNumber);
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

  return {
    truncated: source.length > MAX_JS_TEST_COVERAGE_VISIBLE_RANGES,
    windows: merged,
  };
}

function lowerBoundByLine(lines: readonly JsTestCoverageLine[], lineNumber: number): number {
  let lower = 0;
  let upper = lines.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((lines[middle]?.lineNumber ?? Number.POSITIVE_INFINITY) < lineNumber) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
}
