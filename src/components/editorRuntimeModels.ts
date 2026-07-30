import type * as Monaco from "monaco-editor";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { modelMatchesWorkspacePath, modelPath } from "./phpMonacoDocumentContext";
import { MAX_MONACO_DIAGNOSTIC_ITEMS } from "./editorDiagnosticMonacoMappings";
import { monacoModelRegistry, type MonacoRuntimeRetentionPublisher } from "./monacoModelRegistry";

export const EDITOR_PLACEHOLDER_MODEL_PATH = "inmemory://workbench/empty";
interface RuntimeMarkerOwnership {
  readonly reconciler: object;
}

const runtimeMarkerOwners = new WeakMap<Monaco.editor.ITextModel, RuntimeMarkerOwnership>();

export interface EditorRuntimeModelRetention {
  activePath: string | null;
  retainPaths: readonly string[];
}

function modelMatchesProject(
  model: Monaco.editor.ITextModel,
  workspaceRoot: string | null,
  path: string,
): boolean {
  return workspaceRoot
    ? modelMatchesWorkspacePath(model, workspaceRoot, path)
    : modelPath(model) === path;
}

export interface EditorRuntimeMarkerReconciler extends Monaco.IDisposable {
  readonly monacoApi: typeof Monaco;
  readonly workspaceRoot: string | null;
  reconcile(
    diagnosticsByPath: Readonly<Record<string, readonly LanguageServerDiagnostic[]>>,
    toMarker: (diagnostic: LanguageServerDiagnostic) => Monaco.editor.IMarkerData,
  ): void;
}

export function createEditorRuntimeMarkerReconciler(
  monacoApi: typeof Monaco,
  workspaceRoot: string | null,
  diagnosticsByPath: Readonly<Record<string, readonly LanguageServerDiagnostic[]>>,
  toMarker: (diagnostic: LanguageServerDiagnostic) => Monaco.editor.IMarkerData,
): EditorRuntimeMarkerReconciler {
  const modelsByPath = new Map<string, Set<Monaco.editor.ITextModel>>();
  const indexedPaths = new WeakMap<Monaco.editor.ITextModel, string>();
  const modelDisposeListeners = new Map<Monaco.editor.ITextModel, Monaco.IDisposable>();
  let currentDiagnosticsByPath = diagnosticsByPath;
  let currentToMarker = toMarker;
  let disposed = false;
  let createModelListener: Monaco.IDisposable = { dispose: () => undefined };
  let disposeModelListener: Monaco.IDisposable = { dispose: () => undefined };
  const markerOwner = {};
  const hasCreateModelListener = typeof monacoApi.editor.onDidCreateModel === "function";
  const hasGlobalDisposeListener = typeof monacoApi.editor.onWillDisposeModel === "function";

  const disposeBestEffort = (disposable: Monaco.IDisposable): void => {
    try {
      disposable.dispose();
    } catch {
      // One failed Monaco listener must not strand the remaining lifecycle subscriptions.
    }
  };

  const publish = (model: Monaco.editor.ITextModel, path: string): void => {
    const diagnostics = currentDiagnosticsByPath[path] ?? [];
    const retainedCount = Math.min(diagnostics.length, MAX_MONACO_DIAGNOSTIC_ITEMS);
    const markers = new Array<Monaco.editor.IMarkerData>(retainedCount);
    for (let index = 0; index < retainedCount; index += 1) {
      markers[index] = currentToMarker(diagnostics[index]!);
    }
    const previousOwnership = runtimeMarkerOwners.get(model);
    const writeOwnership = { reconciler: markerOwner };
    runtimeMarkerOwners.set(model, writeOwnership);
    try {
      monacoApi.editor.setModelMarkers(model, "php-language-server", markers);
    } catch (error) {
      if (runtimeMarkerOwners.get(model) === writeOwnership) {
        if (previousOwnership) {
          runtimeMarkerOwners.set(model, previousOwnership);
        } else {
          runtimeMarkerOwners.delete(model);
        }
      }
      throw error;
    }
  };

  const clearOwnedMarkers = (model: Monaco.editor.ITextModel): void => {
    const previousOwnership = runtimeMarkerOwners.get(model);
    if (previousOwnership?.reconciler !== markerOwner) {
      return;
    }
    const clearOwnership = { reconciler: markerOwner };
    runtimeMarkerOwners.set(model, clearOwnership);
    try {
      monacoApi.editor.setModelMarkers(model, "php-language-server", []);
      if (runtimeMarkerOwners.get(model) === clearOwnership) {
        runtimeMarkerOwners.delete(model);
      }
    } catch {
      if (runtimeMarkerOwners.get(model) === clearOwnership) {
        runtimeMarkerOwners.set(model, previousOwnership);
      }
      // A disposed Monaco model must not prevent exact listener and index cleanup.
    }
  };

  const unindexModel = (model: Monaco.editor.ITextModel): void => {
    const path = indexedPaths.get(model);
    if (!path) {
      return;
    }
    const models = modelsByPath.get(path);
    models?.delete(model);
    if (models?.size === 0) {
      modelsByPath.delete(path);
    }
    indexedPaths.delete(model);
    if (runtimeMarkerOwners.get(model)?.reconciler === markerOwner) {
      runtimeMarkerOwners.delete(model);
    }
    const modelDisposeListener = modelDisposeListeners.get(model);
    modelDisposeListeners.delete(model);
    if (modelDisposeListener) {
      disposeBestEffort(modelDisposeListener);
    }
  };

  const indexModel = (model: Monaco.editor.ITextModel): void => {
    if (disposed || indexedPaths.has(model)) {
      return;
    }
    const path = modelPath(model);
    if (!path || !modelMatchesProject(model, workspaceRoot, path)) {
      return;
    }
    const models = modelsByPath.get(path) ?? new Set<Monaco.editor.ITextModel>();
    models.add(model);
    modelsByPath.set(path, models);
    indexedPaths.set(model, path);
    if (!hasGlobalDisposeListener && typeof model.onWillDispose === "function") {
      modelDisposeListeners.set(
        model,
        model.onWillDispose(() => unindexModel(model)),
      );
    }
    publish(model, path);
  };

  const disposeOwnedListeners = (): void => {
    disposeBestEffort(createModelListener);
    disposeBestEffort(disposeModelListener);
    for (const listener of modelDisposeListeners.values()) {
      disposeBestEffort(listener);
    }
    modelDisposeListeners.clear();
  };

  const scanCurrentModels = (): void => {
    const models = monacoApi.editor.getModels();
    if (!hasCreateModelListener) {
      const liveModels = new Set(models);
      for (const indexedModels of modelsByPath.values()) {
        for (const model of indexedModels) {
          if (!liveModels.has(model)) {
            unindexModel(model);
          }
        }
      }
    }
    models.forEach(indexModel);
  };

  try {
    if (hasCreateModelListener) {
      createModelListener = monacoApi.editor.onDidCreateModel(indexModel);
    }
    if (hasGlobalDisposeListener) {
      disposeModelListener = monacoApi.editor.onWillDisposeModel(unindexModel);
    }
    scanCurrentModels();
  } catch (error) {
    disposed = true;
    disposeOwnedListeners();
    for (const models of modelsByPath.values()) {
      for (const model of models) {
        clearOwnedMarkers(model);
      }
    }
    modelsByPath.clear();
    throw error;
  }

  return {
    monacoApi,
    workspaceRoot,
    reconcile(nextDiagnosticsByPath, nextToMarker) {
      if (disposed) {
        return;
      }
      if (!hasCreateModelListener) {
        scanCurrentModels();
      }
      if (currentDiagnosticsByPath === nextDiagnosticsByPath && currentToMarker === nextToMarker) {
        return;
      }
      const previousDiagnosticsByPath = currentDiagnosticsByPath;
      const markerProjectionChanged = currentToMarker !== nextToMarker;
      currentDiagnosticsByPath = nextDiagnosticsByPath;
      currentToMarker = nextToMarker;

      if (markerProjectionChanged) {
        for (const models of modelsByPath.values()) {
          for (const model of models) {
            const path = indexedPaths.get(model);
            if (path) {
              publish(model, path);
            }
          }
        }
        return;
      }

      const changedPaths = new Set<string>([
        ...Object.keys(previousDiagnosticsByPath),
        ...Object.keys(nextDiagnosticsByPath),
      ]);
      for (const path of changedPaths) {
        if (previousDiagnosticsByPath[path] === nextDiagnosticsByPath[path]) {
          continue;
        }
        for (const model of modelsByPath.get(path) ?? []) {
          publish(model, path);
        }
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeOwnedListeners();
      for (const models of modelsByPath.values()) {
        for (const model of models) {
          clearOwnedMarkers(model);
        }
      }
      modelsByPath.clear();
    },
  };
}

export function disposeUnretainedEditorRuntimeModels(
  monacoApi: typeof Monaco,
  workspaceRoot: string | null,
  memberships: readonly EditorRuntimeModelRetention[],
  disposedModels: WeakSet<Monaco.editor.ITextModel> = new WeakSet(),
  retentionPublisher?: MonacoRuntimeRetentionPublisher,
): void {
  const retainPaths = new Set<string>([EDITOR_PLACEHOLDER_MODEL_PATH]);
  const modelRegistry = monacoModelRegistry(monacoApi);

  memberships.forEach((membership) => {
    membership.retainPaths.forEach((path) => retainPaths.add(path));
    if (membership.activePath) {
      retainPaths.add(membership.activePath);
    }
  });
  retentionPublisher?.replace(workspaceRoot, retainPaths);

  monacoApi.editor.getModels().forEach((model) => {
    const path = modelPath(model);

    if (
      !path ||
      !modelMatchesProject(model, workspaceRoot, path) ||
      retainPaths.has(path) ||
      model.isAttachedToEditor?.() ||
      modelRegistry.hasActiveLease(model) ||
      disposedModels.has(model)
    ) {
      return;
    }

    disposedModels.add(model);
    model.dispose();
  });
}
