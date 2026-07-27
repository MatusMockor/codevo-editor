// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { JsTestCoverageReport } from "../domain/jsTestCoverage";
import type { EditorDocument } from "../domain/workspace";
import { MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS } from "./jsTestCoverageDecorationWindow";
import { useJsTestCoverageEditorDecorations } from "./useJsTestCoverageEditorDecorations";

describe("useJsTestCoverageEditorDecorations", () => {
  it("refreshes a bounded coverage window when the Monaco viewport changes", async () => {
    const lineCount = 20_000;
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
    const modelDeltaDecorations = vi.fn((_: string[], decorations: unknown[]) =>
      decorations.map((__, index) => `coverage-${index}`),
    );
    const model = {
      deltaDecorations: modelDeltaDecorations,
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
    let visibleRange = { endLineNumber: 10_020, startLineNumber: 10_000 };
    let onScroll: (() => void) | null = null;
    const editor = {
      getModel: vi.fn(() => model),
      getVisibleRanges: vi.fn(() => [visibleRange]),
      onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
      onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidScrollChange: vi.fn((listener: () => void) => {
        onScroll = listener;
        return { dispose: vi.fn() };
      }),
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

    await act(async () => root.render(<Harness />));

    const renderedDecorations = modelDeltaDecorations.mock.calls[0]?.[1] as
      Monaco.editor.IModelDeltaDecoration[] | undefined;
    expect(renderedDecorations).toHaveLength(101);
    expect(renderedDecorations?.filter(({ options }) => options.after !== undefined)).toHaveLength(
      101,
    );
    expect(renderedDecorations?.[0]?.range.startLineNumber).toBe(9_960);
    expect(renderedDecorations?.[100]?.range.startLineNumber).toBe(10_060);
    expect(renderedDecorations?.[100]?.options.className).toBe(
      "js-test-coverage-line js-test-coverage-covered-line",
    );
    expect(renderedDecorations?.[100]?.options.hoverMessage).toEqual({
      value:
        "Test coverage: covered (1 hit). Inline hit counts are limited in large coverage reports.",
    });

    visibleRange = { endLineNumber: 15_010, startLineNumber: 15_000 };
    await act(async () => {
      onScroll?.();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const refreshed = modelDeltaDecorations.mock.calls[1]?.[1] as
      Monaco.editor.IModelDeltaDecoration[] | undefined;
    expect(refreshed?.[0]?.range.startLineNumber).toBe(14_960);
    expect(refreshed?.[refreshed.length - 1]?.range.startLineNumber).toBe(15_050);
    expect(
      refreshed?.filter(({ options }) => options.after !== undefined).length,
    ).toBeLessThanOrEqual(MAX_VISIBLE_JS_TEST_COVERAGE_HIT_COUNTS);

    act(() => root.unmount());
    expect(
      modelDeltaDecorations.mock.calls[modelDeltaDecorations.mock.calls.length - 1]?.[1],
    ).toEqual([]);
  });

  it("clears decorations on their owning model across an A to B to A switch", async () => {
    const report: JsTestCoverageReport = {
      branches: { covered: 0, percentage: null, total: 0 },
      files: ["a.ts", "b.ts"].map((path) => ({
        branches: { covered: 0, percentage: null, total: 0 },
        firstUncoveredLine: null,
        functions: { covered: 0, percentage: null, total: 0 },
        lines: [{ hits: 1, lineNumber: 1 }],
        path,
        summary: { covered: 1, percentage: 100, total: 1 },
      })),
      functions: { covered: 0, percentage: null, total: 0 },
      summary: { covered: 2, percentage: 100, total: 2 },
      truncated: false,
    };
    const documentA = editorDocument("/workspace/a.ts");
    const documentB = editorDocument("/workspace/b.ts");
    const modelA = coverageModel(documentA.path, "a");
    const modelB = coverageModel(documentB.path, "b");
    let activeModel = modelA.model;
    const editor = {
      getModel: vi.fn(() => activeModel),
      getVisibleRanges: vi.fn(() => [{ endLineNumber: 1, startLineNumber: 1 }]),
      onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
      onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
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
    const host = window.document.createElement("div");
    const root = createRoot(host);

    function Harness({ activeDocument }: { readonly activeDocument: EditorDocument }) {
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

    await act(async () => root.render(<Harness activeDocument={documentA} />));
    expect(modelA.deltaDecorations).toHaveBeenLastCalledWith([], expect.any(Array));

    activeModel = modelB.model;
    await act(async () => root.render(<Harness activeDocument={documentB} />));
    expect(modelA.deltaDecorations).toHaveBeenLastCalledWith(["a-0"], []);
    expect(modelB.deltaDecorations).toHaveBeenLastCalledWith([], expect.any(Array));

    activeModel = modelA.model;
    await act(async () => root.render(<Harness activeDocument={documentA} />));
    expect(modelB.deltaDecorations).toHaveBeenLastCalledWith(["b-0"], []);
    expect(modelA.deltaDecorations).toHaveBeenLastCalledWith([], expect.any(Array));

    act(() => root.unmount());
  });

  it("fails closed when a partial Monaco model has no model-owned decoration API", async () => {
    const activeDocument = editorDocument("/workspace/a.ts");
    const report: JsTestCoverageReport = {
      branches: { covered: 0, percentage: null, total: 0 },
      files: [
        {
          branches: { covered: 0, percentage: null, total: 0 },
          firstUncoveredLine: null,
          functions: { covered: 0, percentage: null, total: 0 },
          lines: [{ hits: 1, lineNumber: 1 }],
          path: "a.ts",
          summary: { covered: 1, percentage: 100, total: 1 },
        },
      ],
      functions: { covered: 0, percentage: null, total: 0 },
      summary: { covered: 1, percentage: 100, total: 1 },
      truncated: false,
    };
    const partialModel = {
      getLineCount: vi.fn(() => 1),
      getLineLength: vi.fn(() => 1),
      isDisposed: vi.fn(() => false),
      uri: {
        fsPath: activeDocument.path,
        path: activeDocument.path,
        scheme: "file",
        toString: () => `file://${activeDocument.path}`,
      },
    } as unknown as Monaco.editor.ITextModel;
    const editorDeltaDecorations = vi.fn();
    const editor = {
      deltaDecorations: editorDeltaDecorations,
      getModel: vi.fn(() => partialModel),
      getVisibleRanges: vi.fn(() => [{ endLineNumber: 1, startLineNumber: 1 }]),
      onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
      onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const monaco = {
      Range: class {},
      editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
    } as unknown as typeof Monaco;
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

    await act(async () => root.render(<Harness />));
    expect(editorDeltaDecorations).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

function editorDocument(path: string): EditorDocument {
  return {
    content: "",
    language: "typescript",
    name: path.split("/").pop() ?? path,
    path,
    savedContent: "",
  };
}

function coverageModel(path: string, prefix: string) {
  const deltaDecorations = vi.fn((_: string[], decorations: unknown[]) =>
    decorations.map((__, index) => `${prefix}-${index}`),
  );
  const model = {
    deltaDecorations,
    getLineCount: vi.fn(() => 1),
    getLineLength: vi.fn(() => 10),
    isDisposed: vi.fn(() => false),
    uri: {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    },
  } as unknown as Monaco.editor.ITextModel;
  return { deltaDecorations, model };
}
