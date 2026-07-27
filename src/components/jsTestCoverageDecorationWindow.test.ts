import { describe, expect, it } from "vitest";
import type { JsTestCoverageLineDecoration } from "../domain/jsTestCoverageDecorations";
import {
  MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS,
  MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS,
  selectVisibleJsTestCoverageDecorations,
} from "./jsTestCoverageDecorationWindow";

describe("selectVisibleJsTestCoverageDecorations", () => {
  const decorations: readonly JsTestCoverageLineDecoration[] = Array.from(
    { length: 20_000 },
    (_, index) => ({
      hits: index % 2,
      lineNumber: index + 1,
      status: index % 2 === 0 ? "uncovered" : "covered",
    }),
  );

  it("selects only the viewport plus bounded overscan from a 20k-line report", () => {
    const selected = selectVisibleJsTestCoverageDecorations(
      decorations,
      [{ endLineNumber: 10_020, startLineNumber: 10_000 }],
      20_000,
    );

    expect(selected).toHaveLength(101);
    expect(selected[0]?.lineNumber).toBe(9_960);
    expect(selected[selected.length - 1]?.lineNumber).toBe(10_060);
    expect(selected.every(({ renderInlineHitCount }) => renderInlineHitCount !== false)).toBe(true);
  });

  it("caps decorations and inline labels for adversarially large visible ranges", () => {
    const selected = selectVisibleJsTestCoverageDecorations(
      decorations,
      [{ endLineNumber: 20_000, startLineNumber: 1 }],
      20_000,
    );

    expect(selected).toHaveLength(MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS);
    expect(
      selected.filter(({ renderInlineHitCount }) => renderInlineHitCount !== false),
    ).toHaveLength(MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS);
  });

  it("never lets overscan evict lines from a large but bounded visible viewport", () => {
    const selected = selectVisibleJsTestCoverageDecorations(
      decorations,
      [{ endLineNumber: 1_239, startLineNumber: 1_000 }],
      20_000,
    );
    const selectedLines = new Set(selected.map(({ lineNumber }) => lineNumber));

    expect(selected).toHaveLength(MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS);
    expect(
      Array.from({ length: 240 }, (_, index) => 1_000 + index).every((line) =>
        selectedLines.has(line),
      ),
    ).toBe(true);
    expect(selected.find(({ lineNumber }) => lineNumber === 960)?.renderInlineHitCount).toBe(false);
    expect(selected.find(({ lineNumber }) => lineNumber === 1_000)?.renderInlineHitCount).toBe(
      true,
    );
    expect(selected.find(({ lineNumber }) => lineNumber === 1_127)?.renderInlineHitCount).toBe(
      true,
    );
    expect(selected.find(({ lineNumber }) => lineNumber === 1_128)?.renderInlineHitCount).toBe(
      false,
    );
  });

  it("merges overlapping ranges and provides a bounded pre-layout fallback", () => {
    const overlapping = selectVisibleJsTestCoverageDecorations(
      decorations,
      [
        { endLineNumber: 50, startLineNumber: 40 },
        { endLineNumber: 70, startLineNumber: 45 },
      ],
      20_000,
    );
    const fallback = selectVisibleJsTestCoverageDecorations(decorations, [], 20_000);

    expect(new Set(overlapping.map(({ lineNumber }) => lineNumber)).size).toBe(overlapping.length);
    expect(fallback).toHaveLength(120);
    expect(fallback[0]?.lineNumber).toBe(1);
    expect(fallback[fallback.length - 1]?.lineNumber).toBe(120);
  });
});
