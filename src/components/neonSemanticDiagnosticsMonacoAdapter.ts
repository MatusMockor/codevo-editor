import type * as Monaco from "monaco-editor";
import type { NeonSemanticDiagnostic } from "../domain/neonSemanticDiagnostics";
import type { TemplateLanguageMonacoProviderContext } from "./templateLanguageMonacoTypes";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type Disposable = Monaco.IDisposable;

export const NETTE_NEON_SEMANTIC_MARKER_OWNER = "nette-neon-semantic";
const MAX_OPEN_NEON_DIAGNOSTIC_MODELS = 16;

interface ModelSubscriptions {
  readonly change: Disposable;
  readonly dispose: Disposable;
}

/** Owns fresh-snapshot diagnostics and every marker/listener lifecycle fence. */
export function registerNeonSemanticDiagnostics(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
): Disposable {
  if (!monaco.editor) return { dispose: () => undefined };
  const subscriptions = new Map<MonacoModel, ModelSubscriptions>();
  let disposed = false;
  let generation = 0;
  let scheduled = false;
  let markerRoot: string | null = null;

  const clearModel = (model: MonacoModel): void => {
    monaco.editor.setModelMarkers(model, NETTE_NEON_SEMANTIC_MARKER_OWNER, []);
  };
  const clearAll = (): void => {
    for (const model of subscriptions.keys()) clearModel(model);
    markerRoot = null;
  };
  const schedule = (model: MonacoModel): void => {
    if (disposed || !isNeonModel(model)) return;
    generation += 1;
    let root: string | null;
    try {
      root = context.getWorkspaceRoot?.() ?? null;
    } catch (error) {
      clearAll();
      safeReport(context, error);
      return;
    }
    if (markerRoot !== null && markerRoot !== root) clearAll();
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void refresh(generation);
    });
  };
  const attach = (model: MonacoModel): void => {
    if (disposed || subscriptions.has(model) || !isNeonModel(model)) return;
    const change = model.onDidChangeContent(() => schedule(model));
    const dispose = model.onWillDispose(() => {
      generation += 1;
      clearModel(model);
      const owned = subscriptions.get(model);
      subscriptions.delete(model);
      owned?.change.dispose();
      owned?.dispose.dispose();
      const remaining = [...subscriptions.keys()][0];
      if (remaining) schedule(remaining);
    });
    subscriptions.set(model, { change, dispose });
    schedule(model);
  };
  const refresh = async (requestGeneration: number): Promise<void> => {
    let rootPath: string | null;
    try {
      rootPath = context.getWorkspaceRoot?.() ?? null;
    } catch (error) {
      clearAll();
      safeReport(context, error);
      return;
    }
    const versions = new Map(
      [...subscriptions.keys()].map((openModel) => [openModel, openModel.getVersionId()]),
    );
    const isCurrent = (): boolean => isCurrentRequest(requestGeneration, rootPath, versions);
    if (!rootPath || versions.size === 0 || versions.size > MAX_OPEN_NEON_DIAGNOSTIC_MODELS) {
      if (isCurrent()) clearAll();
      return;
    }
    const openOverlays = new Map<string, string>();
    for (const openModel of subscriptions.keys()) {
      const path = modelPath(openModel);
      if (path) openOverlays.set(path, openModel.getValue());
    }
    try {
      const provider = context.getTemplateLanguageProviders().neon.provideSemanticDiagnostics;
      const createRepository = context.createNeonSemanticDiagnosticsRepository;
      if (!provider || !createRepository) {
        if (isCurrent()) clearAll();
        return;
      }
      const loads = [...versions.keys()].flatMap((model) => {
        const activePath = modelPath(model);
        if (!activePath) return [];
        const repository = createRepository({ activePath, isCurrent, openOverlays, rootPath });
        return repository ? [provider(repository)] : [];
      });
      if (loads.length !== versions.size) {
        if (isCurrent()) clearAll();
        return;
      }
      const results = await Promise.all(loads);
      if (!isCurrent() || results.some((result) => result === null)) return;
      publish(dedupeDiagnostics(results.flatMap((result) => result ?? [])), rootPath);
    } catch (error) {
      if (!isCurrent()) return;
      clearAll();
      safeReport(context, error);
    }
  };
  const isCurrentRequest = (
    requestGeneration: number,
    rootPath: string | null,
    versions: ReadonlyMap<MonacoModel, number>,
  ): boolean =>
    !disposed &&
    requestGeneration === generation &&
    workspaceRootIs(context, rootPath) &&
    [...versions].every(
      ([model, version]) => subscriptions.has(model) && model.getVersionId() === version,
    );
  const publish = (diagnostics: readonly NeonSemanticDiagnostic[], rootPath: string): void => {
    const byPath = new Map<string, NeonSemanticDiagnostic[]>();
    for (const diagnostic of diagnostics) {
      const values = byPath.get(normalizePath(diagnostic.path)) ?? [];
      values.push(diagnostic);
      byPath.set(normalizePath(diagnostic.path), values);
    }
    for (const model of subscriptions.keys()) {
      const path = modelPath(model);
      const markers = path
        ? (byPath.get(normalizePath(path)) ?? []).map((diagnostic) =>
            toMarker(monaco, model, diagnostic),
          )
        : [];
      monaco.editor.setModelMarkers(model, NETTE_NEON_SEMANTIC_MARKER_OWNER, markers);
    }
    markerRoot = rootPath;
  };

  const createSubscription = monaco.editor.onDidCreateModel?.(attach) ?? {
    dispose: () => undefined,
  };
  for (const model of monaco.editor.getModels?.() ?? []) attach(model);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      createSubscription.dispose();
      clearAll();
      for (const owned of subscriptions.values()) {
        owned.change.dispose();
        owned.dispose.dispose();
      }
      subscriptions.clear();
    },
  };
}

function workspaceRootIs(
  context: TemplateLanguageMonacoProviderContext,
  expected: string | null,
): boolean {
  try {
    return (context.getWorkspaceRoot?.() ?? null) === expected;
  } catch {
    return false;
  }
}

function safeReport(context: TemplateLanguageMonacoProviderContext, error: unknown): void {
  try {
    context.reportError(error);
  } catch {
    // Error reporting is an injected boundary and must not leak a rejection.
  }
}

function dedupeDiagnostics(
  diagnostics: readonly NeonSemanticDiagnostic[],
): NeonSemanticDiagnostic[] {
  const byIdentity = new Map<string, NeonSemanticDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${normalizePath(diagnostic.path)}\0${diagnostic.span.start}\0${diagnostic.span.end}\0${diagnostic.code}`;
    if (!byIdentity.has(key)) byIdentity.set(key, diagnostic);
  }
  return [...byIdentity.values()].sort(
    (left, right) =>
      compareText(normalizePath(left.path), normalizePath(right.path)) ||
      left.span.start - right.span.start ||
      left.span.end - right.span.end ||
      compareText(left.code, right.code),
  );
}

function toMarker(
  monaco: MonacoApi,
  model: MonacoModel,
  diagnostic: NeonSemanticDiagnostic,
): Monaco.editor.IMarkerData {
  const start = model.getPositionAt(diagnostic.span.start);
  const end = model.getPositionAt(diagnostic.span.end);
  return {
    code: diagnostic.code,
    endColumn: end.column,
    endLineNumber: end.lineNumber,
    message: diagnostic.message,
    severity:
      diagnostic.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    source: "Nette NEON",
    startColumn: start.column,
    startLineNumber: start.lineNumber,
  };
}

function isNeonModel(model: MonacoModel): boolean {
  if (typeof model.getLanguageId !== "function") return false;
  try {
    return (
      model.getLanguageId() === "neon" && modelPath(model)?.toLowerCase().endsWith(".neon") === true
    );
  } catch {
    return false;
  }
}

function modelPath(model: MonacoModel): string | null {
  const path = model.uri.fsPath || model.uri.path;
  return path ? normalizePath(path) : null;
}

function normalizePath(path: string): string {
  const normalized = path.split("\\").join("/");
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
