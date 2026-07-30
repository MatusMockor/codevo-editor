import type * as Monaco from "monaco-editor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { MAX_MONACO_DIAGNOSTIC_ITEMS } from "./editorDiagnosticMonacoMappings";
import { createEditorRuntimeMarkerReconciler } from "./editorRuntimeModels";

function fakeModel(path: string): Monaco.editor.ITextModel {
  return {
    uri: {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    },
  } as Monaco.editor.ITextModel;
}

function fakeMonaco(initialModels: Monaco.editor.ITextModel[]) {
  const models = [...initialModels];
  const createListeners = new Set<(model: Monaco.editor.ITextModel) => void>();
  const disposeListeners = new Set<(model: Monaco.editor.ITextModel) => void>();
  const getModels = vi.fn(() => models);
  const setModelMarkers = vi.fn();
  const monaco = {
    editor: {
      getModels,
      onDidCreateModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
        createListeners.add(listener);
        return { dispose: () => createListeners.delete(listener) };
      },
      onWillDisposeModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
        disposeListeners.add(listener);
        return { dispose: () => disposeListeners.delete(listener) };
      },
      setModelMarkers,
    },
  } as unknown as typeof Monaco;

  return {
    addModel(model: Monaco.editor.ITextModel) {
      models.push(model);
      for (const listener of createListeners) listener(model);
    },
    disposeModel(model: Monaco.editor.ITextModel) {
      for (const listener of disposeListeners) listener(model);
      const index = models.indexOf(model);
      if (index >= 0) models.splice(index, 1);
    },
    listenerCounts: () => [createListeners.size, disposeListeners.size],
    getModels,
    monaco,
    setModelMarkers,
  };
}

const diagnostic: LanguageServerDiagnostic = {
  character: 0,
  line: 0,
  message: "Problem",
  severity: "error",
  source: "typescript",
};

const markerData = () => ({
  endColumn: 2,
  endLineNumber: 1,
  message: "Problem",
  severity: 8,
  startColumn: 1,
  startLineNumber: 1,
});

const toMarker = vi.fn(markerData);

describe("createEditorRuntimeMarkerReconciler", () => {
  beforeEach(() => {
    toMarker.mockClear();
  });

  it("maps and publishes at most the Monaco diagnostic budget", () => {
    const path = "/workspace/src/index.ts";
    const model = fakeModel(path);
    const harness = fakeMonaco([model]);
    const diagnostics = Array<LanguageServerDiagnostic>(100_000).fill(diagnostic);
    const projection = vi.fn(markerData);

    createEditorRuntimeMarkerReconciler(harness.monaco, null, { [path]: diagnostics }, projection);

    expect(projection).toHaveBeenCalledTimes(MAX_MONACO_DIAGNOSTIC_ITEMS);
    expect(harness.setModelMarkers).toHaveBeenCalledOnce();
    expect(harness.setModelMarkers.mock.calls[0]?.slice(0, 2)).toEqual([
      model,
      "php-language-server",
    ]);
    expect(harness.setModelMarkers.mock.calls[0]?.[2]).toHaveLength(MAX_MONACO_DIAGNOSTIC_ITEMS);
  });

  it("scans once and updates only models indexed under the changed path", () => {
    const models = Array.from({ length: 4_096 }, (_, index) =>
      fakeModel(`/workspace/src/file-${index}.ts`),
    );
    const harness = fakeMonaco(models);
    let diagnostics: Readonly<Record<string, readonly LanguageServerDiagnostic[]>> = {};
    const reconciler = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace",
      diagnostics,
      toMarker,
    );
    harness.setModelMarkers.mockClear();

    for (let update = 0; update < 1_000; update += 1) {
      const path = `/workspace/src/file-${update % models.length}.ts`;
      diagnostics = { ...diagnostics, [path]: [diagnostic] };
      reconciler.reconcile(diagnostics, toMarker);
    }

    expect(harness.getModels).toHaveBeenCalledOnce();
    expect(harness.setModelMarkers).toHaveBeenCalledTimes(1_000);
  });

  it("does no key or model scan for an unchanged snapshot and marker projection", () => {
    const path = "/workspace/src/index.ts";
    const harness = fakeMonaco([fakeModel(path)]);
    const diagnostics = new Proxy(
      { [path]: [diagnostic] },
      {
        ownKeys: () => {
          throw new Error("unchanged diagnostics keys were scanned");
        },
      },
    );
    const reconciler = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace",
      diagnostics,
      toMarker,
    );

    expect(() => reconciler.reconcile(diagnostics, toMarker)).not.toThrow();
    expect(harness.getModels).toHaveBeenCalledOnce();
  });

  it("subscribes before the initial scan so a concurrently created model is indexed once", () => {
    const path = "/workspace/src/concurrent.ts";
    const model = fakeModel(path);
    let createListener: ((model: Monaco.editor.ITextModel) => void) | null = null;
    const setModelMarkers = vi.fn();
    const monaco = {
      editor: {
        getModels: () => {
          createListener?.(model);
          return [model];
        },
        onDidCreateModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
          createListener = listener;
          return { dispose: () => (createListener = null) };
        },
        onWillDisposeModel: () => ({ dispose: () => undefined }),
        setModelMarkers,
      },
    } as unknown as typeof Monaco;

    createEditorRuntimeMarkerReconciler(monaco, "/workspace", { [path]: [diagnostic] }, toMarker);

    expect(setModelMarkers).toHaveBeenCalledOnce();
  });

  it("applies the current snapshot to new models and forgets disposed models", () => {
    const path = "/workspace/src/new.ts";
    const harness = fakeMonaco([]);
    const reconciler = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace",
      { [path]: [diagnostic] },
      toMarker,
    );
    const model = fakeModel(path);

    harness.addModel(model);
    expect(harness.setModelMarkers).toHaveBeenLastCalledWith(model, "php-language-server", [
      expect.objectContaining({ message: "Problem" }),
    ]);

    harness.disposeModel(model);
    harness.setModelMarkers.mockClear();
    reconciler.reconcile({ [path]: [] }, toMarker);
    expect(harness.setModelMarkers).not.toHaveBeenCalled();
  });

  it("uses the model disposal lifecycle when the global Monaco hook is unavailable", () => {
    const path = "/workspace/src/model-owned.ts";
    let disposeListener: (() => void) | null = null;
    const model = {
      ...fakeModel(path),
      onWillDispose: (listener: () => void) => {
        disposeListener = listener;
        return { dispose: () => (disposeListener = null) };
      },
    } as Monaco.editor.ITextModel;
    const setModelMarkers = vi.fn();
    const monaco = {
      editor: {
        getModels: () => [model],
        onDidCreateModel: () => ({ dispose: () => undefined }),
        setModelMarkers,
      },
    } as unknown as typeof Monaco;
    const reconciler = createEditorRuntimeMarkerReconciler(
      monaco,
      "/workspace",
      { [path]: [diagnostic] },
      toMarker,
    );

    const emitDispose = disposeListener as (() => void) | null;
    emitDispose?.();
    setModelMarkers.mockClear();
    reconciler.reconcile({ [path]: [] }, toMarker);

    expect(setModelMarkers).not.toHaveBeenCalled();
    expect(disposeListener).toBeNull();
  });

  it("disposes exact listeners idempotently and rejects foreign-root models", () => {
    const harness = fakeMonaco([fakeModel("/foreign/index.ts")]);
    const reconciler = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace",
      {},
      toMarker,
    );

    expect(harness.setModelMarkers).not.toHaveBeenCalled();
    expect(harness.listenerCounts()).toEqual([1, 1]);

    reconciler.dispose();
    reconciler.dispose();
    expect(harness.listenerCounts()).toEqual([0, 0]);

    harness.addModel(fakeModel("/workspace/late.ts"));
    expect(harness.setModelMarkers).not.toHaveBeenCalled();
  });

  it("does not revive stale listeners across a workspace A-B-A transition", () => {
    const harness = fakeMonaco([]);
    const firstA = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace-a",
      {},
      toMarker,
    );
    firstA.dispose();
    const workspaceB = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace-b",
      {},
      toMarker,
    );
    workspaceB.dispose();
    createEditorRuntimeMarkerReconciler(harness.monaco, "/workspace-a", {}, toMarker);
    harness.setModelMarkers.mockClear();

    const recreatedAModel = fakeModel("/workspace-a/src/index.ts");
    harness.addModel(recreatedAModel);

    expect(harness.listenerCounts()).toEqual([1, 1]);
    expect(harness.setModelMarkers).toHaveBeenCalledOnce();
    expect(harness.setModelMarkers).toHaveBeenCalledWith(
      recreatedAModel,
      "php-language-server",
      [],
    );
  });

  it("clears live markers on disposal without clearing a newer reconciler's ownership", () => {
    const path = "/workspace/src/index.ts";
    const model = fakeModel(path);
    const harness = fakeMonaco([model]);
    const stale = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace",
      { [path]: [diagnostic] },
      toMarker,
    );
    const current = createEditorRuntimeMarkerReconciler(
      harness.monaco,
      "/workspace",
      { [path]: [diagnostic] },
      toMarker,
    );
    harness.setModelMarkers.mockClear();

    stale.dispose();
    expect(harness.setModelMarkers).not.toHaveBeenCalled();

    current.dispose();
    expect(harness.setModelMarkers).toHaveBeenCalledOnce();
    expect(harness.setModelMarkers).toHaveBeenCalledWith(model, "php-language-server", []);
  });

  it("preserves newer marker ownership established by a reentrant marker callback", () => {
    const path = "/workspace/src/reentrant.ts";
    const model = fakeModel(path);
    const markerCalls: unknown[][] = [];
    let nestedPublish = true;
    let current: ReturnType<typeof createEditorRuntimeMarkerReconciler> | undefined;
    const monaco = {
      editor: {
        getModels: () => [model],
        onDidCreateModel: () => ({ dispose: () => undefined }),
        onWillDisposeModel: () => ({ dispose: () => undefined }),
        setModelMarkers: (...args: unknown[]) => {
          markerCalls.push(args);
          if (nestedPublish) {
            nestedPublish = false;
            current = createEditorRuntimeMarkerReconciler(
              monaco as unknown as typeof Monaco,
              "/workspace",
              { [path]: [diagnostic] },
              toMarker,
            );
          }
        },
      },
    } as unknown as typeof Monaco;

    const stale = createEditorRuntimeMarkerReconciler(
      monaco,
      "/workspace",
      { [path]: [diagnostic] },
      toMarker,
    );
    markerCalls.length = 0;

    stale.dispose();
    expect(markerCalls).toHaveLength(0);

    current?.dispose();
    expect(markerCalls).toHaveLength(1);
    expect(markerCalls[0]?.[2]).toEqual([]);
  });

  it("rolls back every installed listener when initial marker publication throws", () => {
    const createDispose = vi.fn(() => {
      throw new Error("create listener cleanup failed");
    });
    const modelDispose = vi.fn();
    const monaco = {
      editor: {
        getModels: () => [fakeModel("/workspace/index.ts")],
        onDidCreateModel: () => ({ dispose: createDispose }),
        onWillDisposeModel: () => ({ dispose: modelDispose }),
        setModelMarkers: () => {
          throw new Error("marker publication failed");
        },
      },
    } as unknown as typeof Monaco;

    expect(() => createEditorRuntimeMarkerReconciler(monaco, "/workspace", {}, toMarker)).toThrow(
      "marker publication failed",
    );
    expect(createDispose).toHaveBeenCalledOnce();
    expect(modelDispose).toHaveBeenCalledOnce();
  });
});
