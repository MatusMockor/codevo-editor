import type * as Monaco from "monaco-editor";
import { describe, expect, it } from "vitest";
import type { JsTestProblemLineDecoration } from "../domain/jsTestProblemDecorations";
import {
  MAX_JS_TEST_PROBLEM_HOVER_BYTES,
  MAX_JS_TEST_PROBLEM_HOVER_ENTRIES,
  MAX_JS_TEST_PROBLEM_INLINE_MESSAGE_LENGTH,
  toJsTestProblemMonacoDecoration,
} from "./editorJsTestProblemMonacoMappings";

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
    OverviewRulerLane: { Right: 4 },
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
  },
} as unknown as typeof Monaco;

const model = {
  getLineLength: (lineNumber: number) => (lineNumber === 7 ? 12 : 0),
} as Monaco.editor.ITextModel;

describe("JavaScript test problem Monaco mappings", () => {
  it("maps one source line to one whole-line inline and overview decoration", () => {
    expect(toJsTestProblemMonacoDecoration(monaco, model, line(["Expected true"]))).toEqual({
      options: {
        after: {
          content: "checkout: Expected true",
          inlineClassName: "js-test-problem-inline-message",
        },
        className: "js-test-problem-line",
        hoverMessage: { value: "**JavaScript Tests**: checkout: Expected true" },
        isWholeLine: true,
        overviewRuler: { color: "#d98b8b", position: 4 },
        stickiness: 1,
        zIndex: 6,
      },
      range: new FakeRange(7, 13, 7, 13),
    });
  });

  it("shows one bounded single-line summary and preserves all escaped messages in hover", () => {
    const long = `${"*".repeat(150)}\nunsafe\u202e`;
    const decoration = toJsTestProblemMonacoDecoration(
      monaco,
      model,
      line([long, "second [failure]"]),
    );
    const content = decoration.options.after?.content ?? "";

    expect(Array.from(content)).toHaveLength(MAX_JS_TEST_PROBLEM_INLINE_MESSAGE_LENGTH);
    expect(content.endsWith("… (+1 more)")).toBe(true);
    expect(content).not.toMatch(/[\r\n\u202e]/u);
    expect(decoration.options.hoverMessage).toEqual({
      value:
        `**JavaScript Tests**: checkout: ${"\\*".repeat(150)} unsafe\n\n` +
        "**JavaScript Tests**: checkout: second \\[failure\\]",
    });
  });

  it("uses a truthful fallback when a defensive sanitization empties the message", () => {
    const decoration = toJsTestProblemMonacoDecoration(monaco, model, {
      entries: [
        {
          filePath: "src/example.test.ts",
          lineNumber: 7,
          message: "\n\t",
          name: null,
          status: "error",
        },
      ],
      lineNumber: 7,
    });

    expect(decoration.options.after?.content).toBe("Test errored.");
    expect(decoration.options.hoverMessage).toEqual({
      value: "**JavaScript Tests**: Test errored\\.",
    });
  });

  it("bounds a hostile same-line hover and reports every omitted problem", () => {
    const messages = Array.from(
      { length: MAX_JS_TEST_PROBLEM_HOVER_ENTRIES + 7 },
      (_, index) => `${index}:${"*".repeat(4_096)}`,
    );
    const decoration = toJsTestProblemMonacoDecoration(monaco, model, line(messages));
    const hover = String(
      "value" in (decoration.options.hoverMessage as { value: string })
        ? (decoration.options.hoverMessage as { value: string }).value
        : "",
    );

    expect(new TextEncoder().encode(hover).byteLength).toBeLessThanOrEqual(
      MAX_JS_TEST_PROBLEM_HOVER_BYTES,
    );
    expect(hover).toMatch(/more JavaScript test problems omitted\\\._$/u);
    const omitted = Number(hover.match(/_(\d+) more/u)?.[1]);
    expect(omitted).toBeGreaterThanOrEqual(7);
    expect(hover).toContain("checkout: 0:");
  });
});

function line(messages: readonly string[]): JsTestProblemLineDecoration {
  return {
    entries: messages.map((message) => ({
      filePath: "src/example.test.ts",
      lineNumber: 7,
      message,
      name: "checkout",
      status: "failed" as const,
    })),
    lineNumber: 7,
  };
}
