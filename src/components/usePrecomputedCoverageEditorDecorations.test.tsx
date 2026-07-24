// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import {
  usePrecomputedCoverageEditorDecorations,
  type PrecomputedCoverageDecorationOwner,
  type PrecomputedCoverageDecorationPublication,
  type PrecomputedCoverageEditorDecorationOptions,
} from "./usePrecomputedCoverageEditorDecorations";

describe("usePrecomputedCoverageEditorDecorations", () => {
  it("renders only valid exact-owner lines and clears on model version change", () => {
    const harness = createHarness();
    harness.render();
    const rendered = harness.editor.deltaDecorations.mock.calls.find(
      ([, decorations]) => decorations.length > 0,
    )?.[1];
    expect(rendered).toHaveLength(2);
    expect(rendered?.map(({ range }) => range.startLineNumber)).toEqual([1, 2]);
    expect(rendered?.map(({ options }) => options.linesDecorationsClassName)).toEqual([
      "coverage-gutter coverage-covered-gutter",
      "coverage-gutter coverage-uncovered-gutter",
    ]);

    harness.model.version += 1;
    act(() => harness.fireContentChange());
    expect(harness.editor.deltaDecorations).toHaveBeenLastCalledWith(expect.any(Array), []);
    harness.unmount();
  });

  it("fails closed for owner, revision, path and model drift and cleans up on unmount", () => {
    const harness = createHarness();
    harness.render({ activeOwner: { ownerKey: "other", revision: 4 } });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);

    harness.render({ activeOwner: { ownerKey: "workspace", revision: 5 } });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);

    harness.render({
      publication: {
        ...harness.publication,
        documentPath: "/workspace/other.php",
      },
    });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);

    const otherModel = createModel("/workspace/example.php");
    harness.render({ model: otherModel as never });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);

    harness.render();
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(1);
    act(() => harness.fireModelChange());
    expect(harness.editor.deltaDecorations).toHaveBeenLastCalledWith(expect.any(Array), []);
    harness.unmount();
    expect(harness.editor.deltaDecorations).toHaveBeenLastCalledWith(expect.any(Array), []);
    expect(harness.dispose).toHaveBeenCalledOnce();
    expect(harness.disposeModel).toHaveBeenCalledOnce();
  });

  it("fails closed for duplicate or unsorted visible lines", () => {
    const harness = createHarness();
    harness.render({
      publication: {
        ...harness.publication,
        lines: [
          { hits: 1, lineNumber: 1, status: "covered" },
          { hits: 0, lineNumber: 1, status: "uncovered" },
        ],
      },
    });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);
    harness.render({
      publication: {
        ...harness.publication,
        lines: [
          { hits: 0, lineNumber: 2, status: "uncovered" },
          { hits: 1, lineNumber: 1, status: "covered" },
        ],
      },
    });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);
    harness.unmount();
  });

  it.each([
    { hits: 0, lineNumber: 3, status: "uncovered" as const },
    { hits: -1, lineNumber: 1, status: "uncovered" as const },
    { hits: 0, lineNumber: 1, status: "covered" as const },
    { hits: 1, lineNumber: 1, status: "uncovered" as const },
  ])("fails the whole publication closed for an invalid line %#", (invalid) => {
    const harness = createHarness();
    harness.render({
      publication: {
        ...harness.publication,
        lines: [{ hits: 2, lineNumber: 1, status: "covered" }, invalid],
      },
    });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);
    harness.unmount();
  });

  it("fails closed for forged non-array and null line publications", () => {
    const harness = createHarness();
    for (const lines of [null, [null]]) {
      harness.render({
        publication: {
          ...harness.publication,
          lines,
        } as unknown as PrecomputedCoverageDecorationPublication,
      });
      expect(harness.nonEmptyDecorationCalls()).toHaveLength(0);
    }
    harness.unmount();
  });

  it("accepts an injected canonical model matcher and fails closed if it throws", () => {
    const harness = createHarness();
    const matcher = vi.fn(() => true);
    harness.render({
      modelMatchesDocument: matcher,
      publication: { ...harness.publication, documentPath: "/canonical/example.php" },
    });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(1);
    expect(matcher).toHaveBeenCalledWith(harness.model, "/canonical/example.php");

    harness.render({
      modelMatchesDocument: () => {
        throw new Error("matcher");
      },
    });
    expect(harness.nonEmptyDecorationCalls()).toHaveLength(1);
    harness.unmount();
  });
});

function createHarness() {
  const host = document.createElement("div");
  const root = createRoot(host);
  const model = createModel("/workspace/example.php");
  let contentChange: (() => void) | null = null;
  let modelChange: (() => void) | null = null;
  const dispose = vi.fn();
  const disposeModel = vi.fn();
  let nextDecoration = 0;
  const editor = {
    deltaDecorations: vi.fn((_old: string[], decorations: Monaco.editor.IModelDeltaDecoration[]) =>
      decorations.map(() => `coverage-${++nextDecoration}`),
    ),
    getModel: () => model,
    onDidChangeModelContent: (listener: () => void) => {
      contentChange = listener;
      return { dispose };
    },
    onDidChangeModel: (listener: () => void) => {
      modelChange = listener;
      return { dispose: disposeModel };
    },
  };
  const monaco = {
    editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 } },
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
  };
  const activeOwner: PrecomputedCoverageDecorationOwner = {
    ownerKey: "workspace",
    revision: 4,
  };
  const publication: PrecomputedCoverageDecorationPublication = {
    ...activeOwner,
    documentPath: "/workspace/example.php",
    lines: [
      { hits: 2, lineNumber: 1, status: "covered" },
      { hits: 0, lineNumber: 2, status: "uncovered" },
    ],
  };
  const defaults = {
    activeOwner,
    editor: editor as unknown as Monaco.editor.IStandaloneCodeEditor,
    model: model as unknown as Monaco.editor.ITextModel,
    monaco: monaco as unknown as typeof Monaco,
    publication,
  };
  let options: PrecomputedCoverageEditorDecorationOptions = defaults;
  function Harness() {
    usePrecomputedCoverageEditorDecorations(options);
    return null;
  }
  return {
    dispose,
    disposeModel,
    editor,
    fireContentChange: () => contentChange?.(),
    fireModelChange: () => modelChange?.(),
    model,
    nonEmptyDecorationCalls: () =>
      editor.deltaDecorations.mock.calls.filter(([, decorations]) => decorations.length > 0),
    publication,
    render(overrides: Partial<typeof options> = {}) {
      options = { ...defaults, ...overrides };
      act(() => root.render(<Harness />));
    },
    unmount: () => act(() => root.unmount()),
  };
}

function createModel(path: string) {
  return {
    version: 1,
    getLineCount: () => 2,
    getVersionId() {
      return this.version;
    },
    isDisposed: () => false,
    uri: { fsPath: path, path, scheme: "file", toString: () => `file://${path}` },
  };
}
