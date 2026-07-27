import type * as Monaco from "monaco-editor";
import { describe, expect, it } from "vitest";
import { toJsTestCoverageDecoration } from "./editorJsTestCoverageMonacoMappings";

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
  editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
} as unknown as typeof Monaco;

const model = {
  getLineLength: (lineNumber: number) => (lineNumber === 7 ? 12 : 18),
} as Monaco.editor.ITextModel;

describe("JavaScript test coverage Monaco mappings", () => {
  it("covered line emits an inline hit-count content decoration", () => {
    const decoration = toJsTestCoverageDecoration(monaco, model, {
      hits: 3,
      lineNumber: 7,
      status: "covered",
    });

    expect(decoration.options.after).toEqual({
      content: "3×",
      inlineClassName: "js-test-coverage-hit-count",
    });
  });

  it("maps covered lines to a distinct gutter and accessible hover", () => {
    expect(
      toJsTestCoverageDecoration(monaco, model, {
        hits: 3,
        lineNumber: 7,
        status: "covered",
      }),
    ).toEqual({
      options: {
        after: {
          content: "3×",
          inlineClassName: "js-test-coverage-hit-count",
        },
        className: "js-test-coverage-line js-test-coverage-covered-line",
        hoverMessage: { value: "Test coverage: covered (3 hits)." },
        isWholeLine: true,
        linesDecorationsClassName: "js-test-coverage-gutter js-test-coverage-covered-gutter",
        linesDecorationsTooltip: "Test coverage: covered (3 hits).",
        stickiness: 1,
        zIndex: 4,
      },
      range: new FakeRange(7, 13, 7, 13),
    });
  });

  it("maps uncovered lines independently from covered lines", () => {
    expect(
      toJsTestCoverageDecoration(monaco, model, {
        hits: 0,
        lineNumber: 11,
        status: "uncovered",
      }),
    ).toMatchObject({
      options: {
        after: {
          content: "0×",
          inlineClassName: "js-test-coverage-hit-count",
        },
        className: "js-test-coverage-line js-test-coverage-uncovered-line",
        hoverMessage: { value: "Test coverage: uncovered (0 hits)." },
        linesDecorationsClassName: "js-test-coverage-gutter js-test-coverage-uncovered-gutter",
        linesDecorationsTooltip: "Test coverage: uncovered (0 hits).",
      },
      range: new FakeRange(11, 19, 11, 19),
    });
  });

  it("keeps the coverage band and surfaces truncation without injected hit-count content", () => {
    expect(
      toJsTestCoverageDecoration(monaco, model, {
        hitCountsTruncated: true,
        hits: 2,
        lineNumber: 11,
        renderInlineHitCount: false,
        status: "covered",
      }),
    ).toMatchObject({
      options: {
        className: "js-test-coverage-line js-test-coverage-covered-line",
        hoverMessage: {
          value:
            "Test coverage: covered (2 hits). Inline hit counts are limited in large coverage reports.",
        },
        linesDecorationsClassName: "js-test-coverage-gutter js-test-coverage-covered-gutter",
        linesDecorationsTooltip:
          "Test coverage: covered (2 hits). Inline hit counts are limited in large coverage reports.",
      },
      range: new FakeRange(11, 19, 11, 19),
    });
    expect(
      toJsTestCoverageDecoration(monaco, model, {
        hitCountsTruncated: true,
        hits: 2,
        lineNumber: 11,
        renderInlineHitCount: false,
        status: "covered",
      }).options.after,
    ).toBeUndefined();
  });
});
