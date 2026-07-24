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

describe("JavaScript test coverage Monaco mappings", () => {
  it("maps covered lines to a distinct gutter and accessible hover", () => {
    expect(
      toJsTestCoverageDecoration(monaco, { hits: 3, lineNumber: 7, status: "covered" }),
    ).toEqual({
      options: {
        className: "js-test-coverage-line js-test-coverage-covered-line",
        hoverMessage: { value: "Test coverage: covered (3 hits)." },
        isWholeLine: true,
        linesDecorationsClassName: "js-test-coverage-gutter js-test-coverage-covered-gutter",
        linesDecorationsTooltip: "Test coverage: covered (3 hits).",
        stickiness: 1,
        zIndex: 4,
      },
      range: new FakeRange(7, 1, 7, 1),
    });
  });

  it("maps uncovered lines independently from covered lines", () => {
    expect(
      toJsTestCoverageDecoration(monaco, { hits: 0, lineNumber: 11, status: "uncovered" }),
    ).toMatchObject({
      options: {
        className: "js-test-coverage-line js-test-coverage-uncovered-line",
        hoverMessage: { value: "Test coverage: uncovered (0 hits)." },
        linesDecorationsClassName: "js-test-coverage-gutter js-test-coverage-uncovered-gutter",
        linesDecorationsTooltip: "Test coverage: uncovered (0 hits).",
      },
      range: new FakeRange(11, 1, 11, 1),
    });
  });
});
