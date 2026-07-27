import { describe, expect, it } from "vitest";
import type { JsTestCoverageLine } from "../domain/jsTestCoverage";
import {
  MAX_JS_TEST_COVERAGE_VISIBLE_RANGES,
  MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS,
  MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS,
  selectVisibleJsTestCoverageDecorations,
} from "./jsTestCoverageDecorationWindow";

describe("selectVisibleJsTestCoverageDecorations", () => {
  const lines: readonly JsTestCoverageLine[] = Array.from({ length: 20_000 }, (_, index) => ({
    hits: index % 2,
    lineNumber: index + 1,
  }));

  it("selects only the viewport plus bounded overscan from a 20k-line report", () => {
    const selected = selectVisibleJsTestCoverageDecorations(
      lines,
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
      lines,
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
      lines,
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
      lines,
      [
        { endLineNumber: 50, startLineNumber: 40 },
        { endLineNumber: 70, startLineNumber: 45 },
      ],
      20_000,
    );
    const fallback = selectVisibleJsTestCoverageDecorations(lines, [], 20_000);

    expect(new Set(overlapping.map(({ lineNumber }) => lineNumber)).size).toBe(overlapping.length);
    expect(fallback).toHaveLength(120);
    expect(fallback[0]?.lineNumber).toBe(1);
    expect(fallback[fallback.length - 1]?.lineNumber).toBe(120);
  });

  it("keeps Home and end-of-file windows exact after distant scroll jumps", () => {
    const home = selectVisibleJsTestCoverageDecorations(
      lines,
      [{ endLineNumber: 20, startLineNumber: 1 }],
      20_000,
    );
    const end = selectVisibleJsTestCoverageDecorations(
      lines,
      [{ endLineNumber: 20_000, startLineNumber: 19_981 }],
      20_000,
    );

    expect(home[0]?.lineNumber).toBe(1);
    expect(home[home.length - 1]?.lineNumber).toBe(60);
    expect(end[0]?.lineNumber).toBe(19_941);
    expect(end[end.length - 1]?.lineNumber).toBe(20_000);
  });

  it("touches only a binary-search plus bounded window from a 500k-line file", () => {
    const source = Array.from({ length: 500_000 }, (_, index) => ({
      hits: index % 2,
      lineNumber: index + 1,
    }));
    let indexedReads = 0;
    const guarded = new Proxy(source, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const selected = selectVisibleJsTestCoverageDecorations(
      guarded,
      [{ endLineNumber: 250_400, startLineNumber: 250_000 }],
      500_000,
    );

    expect(selected).toHaveLength(MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS);
    expect(
      selected.filter(({ renderInlineHitCount }) => renderInlineHitCount !== false),
    ).toHaveLength(MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS);
    expect(indexedReads).toBeLessThan(700);
  });

  it("preserves exact small-file decoration values without allocation-only flags", () => {
    expect(
      selectVisibleJsTestCoverageDecorations(
        [
          { hits: 4, lineNumber: 1 },
          { hits: 0, lineNumber: 3 },
          { hits: 1, lineNumber: 8 },
        ],
        [{ endLineNumber: 8, startLineNumber: 1 }],
        8,
      ),
    ).toEqual([
      { hits: 4, lineNumber: 1, status: "covered" },
      { hits: 0, lineNumber: 3, status: "uncovered" },
      { hits: 1, lineNumber: 8, status: "covered" },
    ]);
  });

  it("bounds adversarial disjoint visible ranges and marks the retained projection truthfully", () => {
    const ranges = Array.from(
      { length: MAX_JS_TEST_COVERAGE_VISIBLE_RANGES * 100 },
      (_, index) => ({
        endLineNumber: index * 3 + 1,
        startLineNumber: index * 3 + 1,
      }),
    );
    let indexedReads = 0;
    const guardedRanges = new Proxy(ranges, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) indexedReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const selected = selectVisibleJsTestCoverageDecorations(lines, guardedRanges, 20_000);

    expect(selected.length).toBeLessThanOrEqual(MAX_VISIBLE_JS_TEST_COVERAGE_DECORATIONS);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every(({ visibleRangesTruncated }) => visibleRangesTruncated)).toBe(true);
    expect(indexedReads).toBeLessThanOrEqual(MAX_JS_TEST_COVERAGE_VISIBLE_RANGES * 2);
  });
});
