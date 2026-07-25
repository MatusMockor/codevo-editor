// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import { MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS } from "../domain/jsTestCoverageDecorations";
import type { EditorDocument } from "../domain/workspace";
import { useJsTestCoverageEditorDecorations } from "./useJsTestCoverageEditorDecorations";

describe("useJsTestCoverageEditorDecorations", () => {
  it("keeps every coverage band while bounding inline hit-count decorations", () => {
    const lineCount = MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS + 2;
    const lines = Array.from({ length: lineCount }, (_, index) => ({
      hits: 1,
      lineNumber: lineCount - index,
    }));
    const report: JsTestCoverageReport = {
      branches: { covered: 0, percentage: null, total: 0 },
      files: [
        {
          branches: { covered: 0, percentage: null, total: 0 },
          firstUncoveredLine: null,
          functions: { covered: 0, percentage: null, total: 0 },
          lines,
          path: "src/example.ts",
          summary: { covered: lineCount, percentage: 100, total: lineCount },
        },
      ],
      functions: { covered: 0, percentage: null, total: 0 },
      summary: { covered: lineCount, percentage: 100, total: lineCount },
      truncated: false,
    };
    const activeDocument: EditorDocument = {
      content: "",
      language: "typescript",
      name: "example.ts",
      path: "/workspace/src/example.ts",
      savedContent: "",
    };
    const model = {
      getLineCount: vi.fn(() => lineCount),
      getLineLength: vi.fn(() => 10),
      isDisposed: vi.fn(() => false),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
        scheme: "file",
        toString: () => `file://${activeDocument.path}`,
      },
    } as unknown as Monaco.editor.ITextModel;
    class Range {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    }
    const monaco = {
      Range,
      editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
    } as unknown as typeof Monaco;
    const deltaDecorations = vi.fn((_: string[], decorations: unknown[]) =>
      decorations.map((__, index) => `coverage-${index}`),
    );
    const editor = {
      deltaDecorations,
      getModel: vi.fn(() => model),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const host = window.document.createElement("div");
    const root = createRoot(host);

    function Harness() {
      useJsTestCoverageEditorDecorations({
        activeDocument,
        editor,
        monaco,
        report,
        rootPath: "/workspace",
        workspaceId: "workspace-a",
      });
      return null;
    }

    act(() => root.render(<Harness />));

    const renderedDecorations = deltaDecorations.mock.calls[0]?.[1] as
      Monaco.editor.IModelDeltaDecoration[] | undefined;
    expect(renderedDecorations).toHaveLength(lineCount);
    expect(renderedDecorations?.filter(({ options }) => options.after !== undefined)).toHaveLength(
      MAX_JS_TEST_COVERAGE_INLINE_HIT_COUNT_DECORATIONS,
    );
    expect(renderedDecorations?.[lineCount - 1]?.options.className).toBe(
      "js-test-coverage-line js-test-coverage-covered-line",
    );
    expect(renderedDecorations?.[lineCount - 1]?.options.hoverMessage).toEqual({
      value:
        "Test coverage: covered (1 hit). Inline hit counts are limited to the first 500 coverage lines.",
    });

    act(() => root.unmount());
  });
});
