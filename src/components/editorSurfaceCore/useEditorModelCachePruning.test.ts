import type * as Monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { createEditorModelPathIndex } from "./useEditorModelCachePruning";

interface ModelHarness {
  readonly dispose: () => void;
  readonly model: Monaco.editor.ITextModel;
}

interface MonacoHarness {
  readonly emitCreated: (model: Monaco.editor.ITextModel) => void;
  readonly getModels: ReturnType<typeof vi.fn<() => Monaco.editor.ITextModel[]>>;
  readonly monaco: typeof Monaco;
}

describe("editor model cache pruning index", () => {
  it("scans a large model set once and handles rapid lifecycle updates incrementally", () => {
    const initialModels = Array.from({ length: 4_096 }, (_, index) =>
      createModel(`/workspace/src/model-${index}.ts`),
    );
    const harness = createMonacoHarness(initialModels.map(({ model }) => model));
    const onLastModelClosed = vi.fn();
    const onSnapshot = vi.fn();
    const index = createEditorModelPathIndex(harness.monaco, "/workspace", {
      onLastModelClosed,
      onSnapshot,
    });

    expect(harness.getModels).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot.mock.calls[0]?.[0]).toHaveLength(4_096);

    const rapidlyChanged = Array.from({ length: 1_000 }, (_, index) =>
      createModel(`/workspace/generated/rapid-${index}.ts`),
    );
    rapidlyChanged.forEach(({ model }) => harness.emitCreated(model));
    rapidlyChanged.forEach(({ dispose }) => dispose());

    expect(harness.getModels).toHaveBeenCalledTimes(1);
    expect(onLastModelClosed).toHaveBeenCalledTimes(1_000);
    index.dispose();
  });

  it("clears a path only after the final exact model is disposed", () => {
    const first = createModel("/workspace/src/shared.ts");
    const second = createModel("/workspace/src/shared.ts");
    const harness = createMonacoHarness([first.model, second.model]);
    const onLastModelClosed = vi.fn();
    const index = createEditorModelPathIndex(harness.monaco, "/workspace", {
      onLastModelClosed,
      onSnapshot: vi.fn(),
    });

    first.dispose();
    expect(onLastModelClosed).not.toHaveBeenCalled();

    second.dispose();
    expect(onLastModelClosed).toHaveBeenCalledOnce();
    expect(onLastModelClosed).toHaveBeenCalledWith("/workspace/src/shared.ts");
    index.dispose();
  });

  it("ignores foreign models and stale A-B-A lifecycle callbacks after disposal", () => {
    const firstA = createModel("/workspace-a/src/first.ts");
    const foreignB = createModel("/workspace-b/src/foreign.ts");
    const firstHarness = createMonacoHarness([firstA.model, foreignB.model]);
    const firstClosed = vi.fn();
    const firstSnapshot = vi.fn();
    const firstIndex = createEditorModelPathIndex(firstHarness.monaco, "/workspace-a", {
      onLastModelClosed: firstClosed,
      onSnapshot: firstSnapshot,
    });

    expect(firstSnapshot.mock.calls[0]?.[0]).toEqual(new Set(["/workspace-a/src/first.ts"]));
    firstIndex.dispose();
    firstA.dispose();
    foreignB.dispose();
    expect(firstClosed).not.toHaveBeenCalled();

    const secondA = createModel("/workspace-a/src/second.ts");
    const secondHarness = createMonacoHarness([secondA.model]);
    const secondClosed = vi.fn();
    const secondIndex = createEditorModelPathIndex(secondHarness.monaco, "/workspace-a", {
      onLastModelClosed: secondClosed,
      onSnapshot: vi.fn(),
    });

    secondA.dispose();
    expect(secondClosed).toHaveBeenCalledWith("/workspace-a/src/second.ts");
    expect(firstClosed).not.toHaveBeenCalled();
    secondIndex.dispose();
  });

  it("bounds compatibility rescans to hosts without creation lifecycle events", () => {
    const first = createModel("/workspace/src/first.ts");
    const second = createModel("/workspace/src/second.ts");
    let models = [first.model];
    const getModels = vi.fn(() => [...models]);
    const monaco = { editor: { getModels } } as unknown as typeof Monaco;
    const onLastModelClosed = vi.fn();
    const index = createEditorModelPathIndex(monaco, "/workspace", {
      onLastModelClosed,
      onSnapshot: vi.fn(),
    });

    models = [second.model];
    index.refreshFallback();

    expect(getModels).toHaveBeenCalledTimes(2);
    expect(onLastModelClosed).toHaveBeenCalledOnce();
    expect(onLastModelClosed).toHaveBeenCalledWith("/workspace/src/first.ts");
    index.dispose();
  });

  it("keeps path bookkeeping and full teardown exact when foreign disposables throw", () => {
    const disposeListeners = new Set<() => void>();
    const modelSubscriptionDispose = vi.fn(() => {
      throw new Error("model subscription teardown failed");
    });
    const model = {
      isDisposed: () => false,
      onWillDispose: (listener: () => void) => {
        disposeListeners.add(listener);
        return { dispose: modelSubscriptionDispose };
      },
      uri: {
        fsPath: "/workspace/src/throwing.ts",
        path: "/workspace/src/throwing.ts",
        scheme: "file",
        toString: () => "file:///workspace/src/throwing.ts",
      },
    } as unknown as Monaco.editor.ITextModel;
    const creationSubscriptionDispose = vi.fn(() => {
      throw new Error("creation subscription teardown failed");
    });
    const monaco = {
      editor: {
        getModels: () => [model],
        onDidCreateModel: () => ({ dispose: creationSubscriptionDispose }),
      },
    } as unknown as typeof Monaco;
    const onLastModelClosed = vi.fn();
    const index = createEditorModelPathIndex(monaco, "/workspace", {
      onLastModelClosed,
      onSnapshot: vi.fn(),
    });

    for (const listener of [...disposeListeners]) {
      listener();
    }
    expect(index.isPathOpen("/workspace/src/throwing.ts")).toBe(false);
    expect(onLastModelClosed).toHaveBeenCalledWith("/workspace/src/throwing.ts");

    expect(() => index.dispose()).not.toThrow();
    expect(creationSubscriptionDispose).toHaveBeenCalledOnce();
    expect(modelSubscriptionDispose).toHaveBeenCalledOnce();
  });

  it("rolls back every acquired subscription when initial snapshot publication throws", () => {
    const modelSubscriptionDispose = vi.fn();
    const model = {
      isDisposed: () => false,
      onWillDispose: () => ({ dispose: modelSubscriptionDispose }),
      uri: {
        fsPath: "/workspace/src/rollback.ts",
        path: "/workspace/src/rollback.ts",
        scheme: "file",
        toString: () => "file:///workspace/src/rollback.ts",
      },
    } as unknown as Monaco.editor.ITextModel;
    const creationSubscriptionDispose = vi.fn();
    const monaco = {
      editor: {
        getModels: () => [model],
        onDidCreateModel: () => ({ dispose: creationSubscriptionDispose }),
      },
    } as unknown as typeof Monaco;

    expect(() =>
      createEditorModelPathIndex(monaco, "/workspace", {
        onLastModelClosed: vi.fn(),
        onSnapshot: () => {
          throw new Error("snapshot publication failed");
        },
      }),
    ).toThrow("snapshot publication failed");
    expect(creationSubscriptionDispose).toHaveBeenCalledOnce();
    expect(modelSubscriptionDispose).toHaveBeenCalledOnce();
  });
});

function createModel(path: string): ModelHarness {
  let disposed = false;
  const disposeListeners = new Set<() => void>();
  const model = {
    isDisposed: () => disposed,
    onWillDispose: (listener: () => void) => {
      disposeListeners.add(listener);
      return { dispose: () => disposeListeners.delete(listener) };
    },
    uri: {
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    },
  } as unknown as Monaco.editor.ITextModel;

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      for (const listener of [...disposeListeners]) {
        listener();
      }
      disposed = true;
    },
    model,
  };
}

function createMonacoHarness(initialModels: Monaco.editor.ITextModel[]): MonacoHarness {
  const models = [...initialModels];
  const createListeners = new Set<(model: Monaco.editor.ITextModel) => void>();
  const getModels = vi.fn(() => [...models]);
  const monaco = {
    editor: {
      getModels,
      onDidCreateModel: (listener: (model: Monaco.editor.ITextModel) => void) => {
        createListeners.add(listener);
        return { dispose: () => createListeners.delete(listener) };
      },
    },
  } as unknown as typeof Monaco;

  return {
    emitCreated: (model) => {
      models.push(model);
      for (const listener of createListeners) {
        listener(model);
      }
    },
    getModels,
    monaco,
  };
}
