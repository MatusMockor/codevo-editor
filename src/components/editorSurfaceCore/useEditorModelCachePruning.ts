import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type * as Monaco from "monaco-editor";
import type { LanguageServerDocumentSymbol } from "../../domain/languageServerFeatures";
import type { PhpSyntaxDiagnostic } from "../../domain/phpSyntaxDiagnostics";
import { modelMatchesProject } from "../editorSurfaceModelIdentity";
import { modelPath } from "../phpMonacoDocumentContext";
import { pruneClosedPaths } from "./modelViewState";

type PathCache<Value> = Record<string, Value>;

interface ModelPathIndexCallbacks {
  readonly onLastModelClosed: (path: string) => void;
  readonly onSnapshot: (openPaths: ReadonlySet<string>) => void;
}

export interface EditorModelPathIndex {
  dispose(): void;
  isPathOpen(path: string): boolean;
  refreshFallback(): void;
}

export interface EditorModelCachePruningOptions {
  readonly activeDocumentPath: string | null | undefined;
  readonly breadcrumbSymbolsByPath: PathCache<readonly LanguageServerDocumentSymbol[]>;
  readonly monaco: typeof Monaco | null;
  readonly onLocalPhpDiagnosticsChange: (path: string, diagnostics: never[]) => void;
  readonly phpInspectionDiagnosticCountsByPath: PathCache<number>;
  readonly setBreadcrumbSymbolsByPath: Dispatch<
    SetStateAction<PathCache<LanguageServerDocumentSymbol[]>>
  >;
  readonly setPhpInspectionDiagnosticCountsByPath: Dispatch<SetStateAction<PathCache<number>>>;
  readonly setSyntaxDiagnosticsByPath: Dispatch<SetStateAction<PathCache<PhpSyntaxDiagnostic[]>>>;
  readonly syntaxDiagnosticsByPath: PathCache<readonly PhpSyntaxDiagnostic[]>;
  readonly workspaceAuthority: object | null;
  readonly workspaceRoot: string | null;
}

/**
 * Tracks workspace model paths once and updates the index from Monaco lifecycle
 * events. Diagnostic and breadcrumb cache updates therefore never need to scan
 * every model. Minimal test hosts without model creation events retain an
 * explicit active-document fallback.
 */
export function useEditorModelCachePruning({
  activeDocumentPath,
  breadcrumbSymbolsByPath,
  monaco,
  onLocalPhpDiagnosticsChange,
  phpInspectionDiagnosticCountsByPath,
  setBreadcrumbSymbolsByPath,
  setPhpInspectionDiagnosticCountsByPath,
  setSyntaxDiagnosticsByPath,
  syntaxDiagnosticsByPath,
  workspaceAuthority,
  workspaceRoot,
}: EditorModelCachePruningOptions): void {
  const currentCachesRef = useRef({
    breadcrumbSymbolsByPath,
    onLocalPhpDiagnosticsChange,
    phpInspectionDiagnosticCountsByPath,
    syntaxDiagnosticsByPath,
  });
  currentCachesRef.current = {
    breadcrumbSymbolsByPath,
    onLocalPhpDiagnosticsChange,
    phpInspectionDiagnosticCountsByPath,
    syntaxDiagnosticsByPath,
  };

  const indexRef = useRef<EditorModelPathIndex | null>(null);

  useEffect(() => {
    if (!monaco) {
      indexRef.current = null;
      return;
    }

    let lifecycleActive = true;
    let flushScheduled = false;
    const pendingClosedPaths = new Set<string>();
    const flushClosedPaths = () => {
      flushScheduled = false;
      if (!lifecycleActive || pendingClosedPaths.size === 0) {
        return;
      }

      const closedPaths = new Set(
        [...pendingClosedPaths].filter((path) => !index.isPathOpen(path)),
      );
      pendingClosedPaths.clear();
      if (closedPaths.size === 0) {
        return;
      }
      setSyntaxDiagnosticsByPath((current) => removeCachedPaths(current, closedPaths));
      setPhpInspectionDiagnosticCountsByPath((current) => removeCachedPaths(current, closedPaths));
      setBreadcrumbSymbolsByPath((current) => removeCachedPaths(current, closedPaths));
      for (const path of closedPaths) {
        currentCachesRef.current.onLocalPhpDiagnosticsChange(path, []);
      }
    };
    const queuePathPruning = (path: string) => {
      pendingClosedPaths.add(path);
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flushClosedPaths);
      }
    };

    const index = createEditorModelPathIndex(monaco, workspaceRoot, {
      onLastModelClosed: queuePathPruning,
      onSnapshot: (openPaths) => {
        const caches = currentCachesRef.current;
        const localDiagnosticPaths = new Set([
          ...Object.keys(caches.syntaxDiagnosticsByPath),
          ...Object.keys(caches.phpInspectionDiagnosticCountsByPath),
        ]);
        for (const path of localDiagnosticPaths) {
          if (!openPaths.has(path)) {
            caches.onLocalPhpDiagnosticsChange(path, []);
          }
        }

        setSyntaxDiagnosticsByPath((current) => pruneClosedPaths(current, new Set(openPaths)));
        setPhpInspectionDiagnosticCountsByPath((current) =>
          pruneClosedPaths(current, new Set(openPaths)),
        );
        setBreadcrumbSymbolsByPath((current) => pruneClosedPaths(current, new Set(openPaths)));
      },
    });
    indexRef.current = index;

    return () => {
      lifecycleActive = false;
      pendingClosedPaths.clear();
      if (indexRef.current === index) {
        indexRef.current = null;
      }
      index.dispose();
    };
  }, [
    monaco,
    setBreadcrumbSymbolsByPath,
    setPhpInspectionDiagnosticCountsByPath,
    setSyntaxDiagnosticsByPath,
    workspaceAuthority,
    workspaceRoot,
  ]);

  useEffect(() => {
    void activeDocumentPath;
    indexRef.current?.refreshFallback();
  }, [activeDocumentPath]);
}

export function createEditorModelPathIndex(
  monaco: typeof Monaco,
  workspaceRoot: string | null,
  callbacks: ModelPathIndexCallbacks,
): EditorModelPathIndex {
  const registrations = new Map<
    Monaco.editor.ITextModel,
    { readonly path: string; readonly subscription: Monaco.IDisposable }
  >();
  const modelCountsByPath = new Map<string, number>();
  let active = true;

  const unregister = (model: Monaco.editor.ITextModel, notify: boolean) => {
    const registration = registrations.get(model);
    if (!registration) {
      return;
    }

    registrations.delete(model);
    disposeBestEffort(registration.subscription);
    const nextCount = (modelCountsByPath.get(registration.path) ?? 1) - 1;
    if (nextCount > 0) {
      modelCountsByPath.set(registration.path, nextCount);
      return;
    }

    modelCountsByPath.delete(registration.path);
    if (active && notify) {
      callbacks.onLastModelClosed(registration.path);
    }
  };

  const register = (model: Monaco.editor.ITextModel) => {
    if (registrations.has(model) || model.isDisposed?.()) {
      return;
    }

    const path = modelPath(model);
    if (!path || !modelMatchesProject(model, workspaceRoot, path)) {
      return;
    }

    const subscription =
      typeof model.onWillDispose === "function"
        ? model.onWillDispose(() => {
            if (active) {
              unregister(model, true);
            }
          })
        : { dispose: () => undefined };
    registrations.set(model, { path, subscription });
    modelCountsByPath.set(path, (modelCountsByPath.get(path) ?? 0) + 1);
  };

  const tracksCreations = typeof monaco.editor.onDidCreateModel === "function";
  const creationSubscription = tracksCreations
    ? monaco.editor.onDidCreateModel((model) => {
        if (active) {
          register(model);
        }
      })
    : { dispose: () => undefined };

  try {
    monaco.editor.getModels().forEach(register);
    callbacks.onSnapshot(new Set(modelCountsByPath.keys()));
  } catch (error) {
    active = false;
    disposeBestEffort(creationSubscription);
    for (const model of [...registrations.keys()]) {
      unregister(model, false);
    }
    modelCountsByPath.clear();
    throw error;
  }

  return {
    dispose: () => {
      if (!active) {
        return;
      }
      active = false;
      disposeBestEffort(creationSubscription);
      for (const model of [...registrations.keys()]) {
        unregister(model, false);
      }
      modelCountsByPath.clear();
    },
    isPathOpen: (path) => active && (modelCountsByPath.get(path) ?? 0) > 0,
    refreshFallback: () => {
      if (!active || tracksCreations) {
        return;
      }

      const liveModels = new Set(monaco.editor.getModels());
      for (const model of [...registrations.keys()]) {
        if (!liveModels.has(model) || model.isDisposed?.()) {
          unregister(model, true);
        }
      }
      liveModels.forEach(register);
    },
  };
}

function disposeBestEffort(disposable: Monaco.IDisposable): void {
  try {
    disposable.dispose();
  } catch {
    // Lifecycle bookkeeping is authoritative. A foreign Monaco disposable
    // cannot strand a phantom model/path registration during teardown.
  }
}

function removeCachedPaths<Value>(
  cache: PathCache<Value>,
  closedPaths: ReadonlySet<string>,
): PathCache<Value> {
  if (![...closedPaths].some((path) => Object.prototype.hasOwnProperty.call(cache, path))) {
    return cache;
  }

  const next = { ...cache };
  for (const path of closedPaths) {
    delete next[path];
  }
  return next;
}
