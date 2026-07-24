// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import type { JsTestExplorerCurrentFileIdentity } from "../domain/jsTestExplorerFilter";
import type { JsTestProblemsSnapshot } from "../domain/jsTestProblems";
import type { EditorDocument } from "../domain/workspace";
import { joinWorkspacePath } from "../domain/workspace";
import {
  createWorkspaceRoot,
  DEFAULT_WORKSPACE_PATH_POLICY,
  parseWorkspacePath,
} from "../domain/workspacePath";
import {
  useJsTestProblemEditorDecorations,
  type JsTestProblemEditorDecorationOptions,
} from "./useJsTestProblemEditorDecorations";

describe("useJsTestProblemEditorDecorations", () => {
  it("publishes one decoration per admitted line and clears only its returned ids", () => {
    const harness = createHarness();
    harness.render();

    expect(harness.nonEmptyCalls()).toHaveLength(1);
    expect(harness.nonEmptyCalls()[0]?.[0]).toEqual([]);
    expect(harness.nonEmptyCalls()[0]?.[1]).toHaveLength(2);

    harness.unmount();
    expect(harness.editor.deltaDecorations).toHaveBeenLastCalledWith(
      ["js-test-problem-1", "js-test-problem-2"],
      [],
    );
  });

  it.each([
    {
      label: "dirty document",
      override: (harness: ReturnType<typeof createHarness>) => ({
        activeDocument: { ...harness.document, content: `${harness.document.content}\nchanged` },
      }),
    },
    {
      label: "foreign owner",
      override: (harness: ReturnType<typeof createHarness>) => ({
        snapshot: {
          ...harness.snapshot,
          owner: { ...harness.snapshot.owner, workspaceId: "other" },
        },
      }),
    },
    {
      label: "wrong editor model",
      override: (harness: ReturnType<typeof createHarness>) => ({
        editor: { ...harness.editor, getModel: () => null },
      }),
    },
    {
      label: "disposed model",
      override: (harness: ReturnType<typeof createHarness>) => ({
        model: { ...harness.model, isDisposed: () => true },
      }),
    },
    {
      label: "foreign model path",
      override: (harness: ReturnType<typeof createHarness>) => ({
        model: { ...harness.model, uri: modelUri("/workspace/src/other.test.ts") },
      }),
    },
    {
      label: "stale model content",
      override: (harness: ReturnType<typeof createHarness>) => ({
        model: { ...harness.model, getValue: () => "stale" },
      }),
    },
  ])("fails closed for $label", ({ override }) => {
    const harness = createHarness();
    harness.render(override(harness) as Partial<JsTestProblemEditorDecorationOptions>);

    expect(harness.nonEmptyCalls()).toHaveLength(0);
    harness.unmount();
  });

  it("fails the whole projection closed when any selected line is outside the model", () => {
    const harness = createHarness({
      entries: [entry(1, "first"), entry(99, "outside")],
    });
    harness.render();

    expect(harness.nonEmptyCalls()).toHaveLength(0);
    harness.unmount();
  });

  it("clears an empty selection without touching optional model methods", () => {
    const harness = createHarness();
    const partialModel = {
      uri: modelUri("/workspace/src/example.test.ts"),
    } as unknown as Monaco.editor.ITextModel;

    expect(() =>
      harness.render({
        model: partialModel,
        snapshot: null,
      }),
    ).not.toThrow();
    expect(harness.nonEmptyCalls()).toHaveLength(0);
    harness.unmount();
  });

  it("fails closed when a partial editor omits its live-model method", () => {
    const harness = createHarness();
    const partialEditor = {
      deltaDecorations: harness.editor.deltaDecorations,
    } as unknown as Monaco.editor.IStandaloneCodeEditor;

    expect(() => harness.render({ editor: partialEditor })).not.toThrow();
    expect(harness.nonEmptyCalls()).toHaveLength(0);
    harness.unmount();
  });

  it("reconciles against the live model after an asynchronous editor model switch", () => {
    const harness = createHarness();
    harness.renderLiveModel();
    expect(harness.nonEmptyCalls()).toHaveLength(1);
    const replacement = {
      ...harness.model,
      getLineCount: () => 2,
      getLineLength: (lineNumber: number) => (lineNumber === 1 ? 8 : 9),
      getValue: () => harness.document.content,
      isDisposed: () => false,
      onWillDispose: () => ({ dispose: vi.fn() }),
      uri: modelUri(harness.document.path),
    };

    harness.replaceLiveModel(replacement as unknown as Monaco.editor.ITextModel);

    expect(harness.nonEmptyCalls()).toHaveLength(2);
    expect(harness.editor.deltaDecorations).toHaveBeenCalledWith(
      ["js-test-problem-1", "js-test-problem-2"],
      [],
    );
    harness.unmount();
  });

  it.each(["content", "model", "dispose"] as const)(
    "clears owned decorations immediately on %s invalidation",
    (event) => {
      const harness = createHarness();
      harness.render();
      expect(harness.nonEmptyCalls()).toHaveLength(1);

      harness.fire(event);
      expect(harness.editor.deltaDecorations).toHaveBeenLastCalledWith(
        ["js-test-problem-1", "js-test-problem-2"],
        [],
      );
      harness.unmount();
    },
  );

  it("replaces the previous generation without retaining stale decoration ids", () => {
    const harness = createHarness();
    harness.render();
    harness.render({
      snapshot: {
        ...harness.snapshot,
        entries: [entry(1, "replacement")],
        generation: harness.snapshot.generation + 1,
        total: 1,
      },
    });

    expect(harness.editor.deltaDecorations).toHaveBeenCalledWith(
      ["js-test-problem-1", "js-test-problem-2"],
      [],
    );
    expect(harness.nonEmptyCalls()).toHaveLength(2);
    expect(harness.nonEmptyCalls()[1]?.[0]).toEqual([]);
    harness.unmount();
  });
});

function createHarness(snapshotOverrides: Partial<JsTestProblemsSnapshot> = {}) {
  const host = window.document.createElement("div");
  const root = createRoot(host);
  const currentFileIdentity = identity("src/example.test.ts");
  const activeDocument: EditorDocument = {
    content: "first();\nsecond();",
    language: "typescript",
    name: "example.test.ts",
    path: "/workspace/src/example.test.ts",
    savedContent: "first();\nsecond();",
  };
  const snapshot: JsTestProblemsSnapshot = {
    entries: [entry(1, "first failed"), entry(2, "second failed")],
    generation: 4,
    owner: { rootKey: "/workspace", workspaceId: "workspace-id" },
    total: 2,
    truncated: false,
    ...snapshotOverrides,
  };
  let contentListener: (() => void) | null = null;
  let modelListener: (() => void) | null = null;
  let disposeListener: (() => void) | null = null;
  let nextId = 0;
  const model = {
    getLineCount: () => 2,
    getLineLength: (lineNumber: number) => (lineNumber === 1 ? 8 : 9),
    getValue: () => activeDocument.content,
    isDisposed: () => false,
    onWillDispose: (listener: () => void) => {
      disposeListener = listener;
      return { dispose: vi.fn() };
    },
    uri: modelUri(activeDocument.path),
  };
  let liveModel: Monaco.editor.ITextModel = model as unknown as Monaco.editor.ITextModel;
  const editor = {
    deltaDecorations: vi.fn((_old: string[], decorations: Monaco.editor.IModelDeltaDecoration[]) =>
      decorations.map(() => `js-test-problem-${++nextId}`),
    ),
    getModel: vi.fn(() => liveModel),
    onDidChangeModel: (listener: () => void) => {
      modelListener = listener;
      return { dispose: vi.fn() };
    },
    onDidChangeModelContent: (listener: () => void) => {
      contentListener = listener;
      return { dispose: vi.fn() };
    },
  };
  const monaco = {
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
    editor: {
      OverviewRulerLane: { Right: 4 },
      TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    },
  };
  const defaults: JsTestProblemEditorDecorationOptions = {
    activeDocument,
    currentFileIdentity,
    editor: editor as unknown as Monaco.editor.IStandaloneCodeEditor,
    model: model as unknown as Monaco.editor.ITextModel,
    monaco: monaco as unknown as typeof Monaco,
    rootPath: "/workspace",
    snapshot,
  };
  let options = defaults;
  let deriveLiveModel = false;
  function Harness() {
    useJsTestProblemEditorDecorations(
      deriveLiveModel ? { ...options, model: editor.getModel() } : options,
    );
    return null;
  }

  return {
    currentFileIdentity,
    document: activeDocument,
    editor,
    fire(event: "content" | "dispose" | "model") {
      if (event === "content") contentListener?.();
      if (event === "model") modelListener?.();
      if (event === "dispose") disposeListener?.();
    },
    model,
    nonEmptyCalls: () =>
      editor.deltaDecorations.mock.calls.filter(([, decorations]) => decorations.length > 0),
    render(overrides: Partial<JsTestProblemEditorDecorationOptions> = {}) {
      deriveLiveModel = false;
      options = { ...defaults, ...overrides };
      act(() => root.render(<Harness />));
    },
    renderLiveModel() {
      deriveLiveModel = true;
      options = defaults;
      act(() => root.render(<Harness />));
    },
    replaceLiveModel(replacement: Monaco.editor.ITextModel) {
      liveModel = replacement;
      act(() => modelListener?.());
    },
    snapshot,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function identity(relativeFilePath: string): JsTestExplorerCurrentFileIdentity {
  const root = createWorkspaceRoot("workspace-id", "/workspace", DEFAULT_WORKSPACE_PATH_POLICY);
  if (!root.ok) throw new Error(root.error.message);
  const path = parseWorkspacePath(
    root.value,
    joinWorkspacePath(root.value.nativePath, relativeFilePath),
  );
  if (!path.ok) throw new Error(path.error.message);
  return {
    pathKey: path.value.key,
    relativeFilePath,
    root: root.value,
  };
}

function entry(lineNumber: number, message: string) {
  return {
    filePath: "src/example.test.ts",
    lineNumber,
    message,
    name: "example",
    status: "failed" as const,
  };
}

function modelUri(path: string) {
  return {
    fsPath: path,
    path,
    scheme: "file",
    toString: () => `file://${path}`,
  };
}
