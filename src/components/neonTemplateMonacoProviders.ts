import type * as Monaco from "monaco-editor";
import {
  neonRenameTargetAt,
  neonSymbolOccurrencesAt,
  planNeonSymbolRename,
} from "../domain/neonSymbolEdits";
import {
  neonCrossFileSymbolFactsAt,
  planNeonCrossFileSymbolRename,
  snapshotNeonCrossFileRepository,
  type NeonCrossFileRepository,
  type NeonCrossFileRenamePlan,
} from "../application/neonCrossFileSymbolSweep";
import type { TemplateWorkspaceRenameOpenModel } from "../application/templateWorkspaceRenameTransaction";
import type { NeonWorkspaceRenameOpenDocumentCapture } from "../application/neonWorkspaceRenameService";
import type {
  NeonCompletion,
  NeonCompletionKind,
  TemplateLanguageMonacoProviderContext,
} from "./templateLanguageMonacoTypes";
import {
  activeTemplateDocumentContext,
  isLargeTemplateSmartDocument,
  isStoredWorkspaceRootActive,
  modelSource,
  offsetAtMonacoPosition,
  templateDefinitionNavigationRequest,
  templateCompletionFallbackRange,
  templateReplaceRange,
} from "./templateLanguageMonacoUtils";
import { registerNeonSemanticDiagnostics } from "./neonSemanticDiagnosticsMonacoAdapter";
import { toWorkspaceMonacoUri } from "./phpMonacoDocumentContext";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export function registerNeonTemplateMonacoProviders(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
): Disposable {
  const definition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("neon", {
        provideDefinition: (model, position) => provideNeonDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const completion = monaco.languages.registerCompletionItemProvider("neon", {
    triggerCharacters: ["\\", ":", " ", "-", "%", "@"],
    provideCompletionItems: (model, position) =>
      provideNeonCompletionItems(monaco, context, model, position),
  });
  const references = monaco.languages.registerReferenceProvider?.("neon", {
    provideReferences: (model, position, referenceContext, token) =>
      provideNeonReferences(monaco, context, model, position, referenceContext, token),
  }) ?? { dispose: () => undefined };
  let requestGeneration = 0;
  let disposed = false;
  const rename = monaco.languages.registerRenameProvider?.("neon", {
    resolveRenameLocation: (model, position, token) =>
      resolveNeonRenameLocation(monaco, context, model, position, token),
    provideRenameEdits: (model, position, newName, token) =>
      provideNeonRenameEdits(
        monaco,
        context,
        model,
        position,
        newName,
        token,
        ++requestGeneration,
        () => (disposed ? -1 : requestGeneration),
      ),
  }) ?? { dispose: () => undefined };
  const semanticDiagnostics = registerNeonSemanticDiagnostics(monaco, context);

  return {
    dispose: () => {
      disposed = true;
      requestGeneration += 1;
      definition.dispose();
      completion.dispose();
      references.dispose();
      rename.dispose();
      semanticDiagnostics.dispose();
    },
  };
}

const RENAME_UNAVAILABLE = "NEON workspace rename is unavailable or stale.";

async function provideNeonReferences(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  referenceContext: Monaco.languages.ReferenceContext,
  token: Monaco.CancellationToken,
): Promise<Monaco.languages.Location[] | null> {
  const local = localNeonSource(context, model);
  if (!local) return null;
  if (!local.rootPath)
    return localReferences(monaco, model, local.source, position, referenceContext);
  const captured = captureRequest(monaco, context, model, local.rootPath, token);
  if (!captured) return null;
  try {
    const snapshot = await snapshotNeonCrossFileRepository(captured.repository);
    if (!captured.isCurrent()) return null;
    const offset = offsetAtMonacoPosition(local.source, position);
    const facts = neonCrossFileSymbolFactsAt(snapshot, offset, referenceContext.includeDeclaration);
    if (!facts || snapshot.status !== "complete") return null;
    const byPath = new Map(
      snapshot.component.map((document) => [pathKey(document.path), document]),
    );
    return facts.occurrences.flatMap((occurrence) => {
      const document = byPath.get(pathKey(occurrence.path));
      const uri = workspaceUri(monaco, local.rootPath!, occurrence.path);
      return document && uri
        ? [{ uri, range: rangeFromSource(monaco, document.source, occurrence.span) }]
        : [];
    });
  } catch (error) {
    if (captured.isCurrent()) safeReport(context, error);
    return null;
  }
}

async function resolveNeonRenameLocation(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  token: Monaco.CancellationToken,
): Promise<Monaco.languages.RenameLocation & Monaco.languages.Rejection> {
  const local = localNeonSource(context, model);
  if (!local) return renameRejection(position, "NEON rename is unavailable.");
  if (!local.rootPath) return localRenameLocation(monaco, model, local.source, position);
  const captured = captureRequest(monaco, context, model, local.rootPath, token);
  if (!captured) return renameRejection(position, RENAME_UNAVAILABLE);
  try {
    const snapshot = await snapshotNeonCrossFileRepository(captured.repository);
    if (!captured.isCurrent() || snapshot.status !== "complete") {
      return renameRejection(position, RENAME_UNAVAILABLE);
    }
    const facts = neonCrossFileSymbolFactsAt(
      snapshot,
      offsetAtMonacoPosition(local.source, position),
      true,
    );
    if (!facts || facts.declarationCount !== 1) {
      return renameRejection(position, "This NEON symbol cannot be renamed safely.");
    }
    return {
      range: templateReplaceRange(
        monaco,
        model,
        local.source,
        facts.selectedSpan.start,
        facts.selectedSpan.end,
      ),
      text: facts.symbol.name,
    };
  } catch (error) {
    if (captured.isCurrent()) safeReport(context, error);
    return renameRejection(position, RENAME_UNAVAILABLE);
  }
}

async function provideNeonRenameEdits(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
  token: Monaco.CancellationToken,
  generation: number,
  currentGeneration: () => number | boolean,
): Promise<Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection> {
  const local = localNeonSource(context, model);
  if (!local) return renameEditsRejection("NEON rename is unavailable.");
  if (!local.rootPath) return localRenameEdits(monaco, model, local.source, position, newName);
  const captured = captureRequest(
    monaco,
    context,
    model,
    local.rootPath,
    token,
    () => currentGeneration() === generation,
  );
  if (!captured) return renameEditsRejection(RENAME_UNAVAILABLE);
  try {
    const snapshot = await snapshotNeonCrossFileRepository(captured.repository);
    if (!captured.isCurrent()) return renameEditsRejection(RENAME_UNAVAILABLE);
    const plan = planNeonCrossFileSymbolRename(
      snapshot,
      offsetAtMonacoPosition(local.source, position),
      newName,
    );
    if (plan.kind !== "ready") return renameEditsRejection(RENAME_UNAVAILABLE);
    const service = context.getNeonWorkspaceRenameService?.() ?? null;
    const createCapture = context.createNeonWorkspaceRenameCapture;
    if (!service || !createCapture || !context.applyNeonWorkspaceEdit) {
      return renameEditsRejection(RENAME_UNAVAILABLE);
    }
    const openDocuments = openRenameDocuments(monaco, plan);
    const active = openDocuments.find(({ path }) => pathKey(path) === pathKey(plan.activePath));
    if (!active) return renameEditsRejection(RENAME_UNAVAILABLE);
    const capture = await createCapture({
      activePath: plan.activePath,
      activeUri: active.uri,
      activeVersionId: active.versionId,
      generation,
      isCurrent: captured.isCurrent,
      openDocuments,
      plan,
      rootPath: plan.rootPath,
    });
    if (!capture || !captured.isCurrent()) return renameEditsRejection(RENAME_UNAVAILABLE);
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested?.(() => controller.abort());
    if (token.isCancellationRequested) controller.abort();
    try {
      const result = await service.rename({
        applyWorkspaceEdit: context.applyNeonWorkspaceEdit,
        capture,
        plan,
        signal: controller.signal,
        toFileUri: (path) => workspaceUri(monaco, plan.rootPath, path)?.toString() ?? "",
      });
      return result.kind === "accepted" ? { edits: [] } : renameEditsRejection(RENAME_UNAVAILABLE);
    } finally {
      try {
        cancellation?.dispose();
      } catch {
        // A third-party cancellation disposable must not change an accepted rename.
      }
    }
  } catch (error) {
    if (captured.isCurrent()) safeReport(context, error);
    return renameEditsRejection(RENAME_UNAVAILABLE);
  }
}

function localReferences(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  position: MonacoPosition,
  context: Monaco.languages.ReferenceContext,
): Monaco.languages.Location[] {
  return neonSymbolOccurrencesAt(
    source,
    offsetAtMonacoPosition(source, position),
    context.includeDeclaration,
  ).map(({ span }) => ({
    range: templateReplaceRange(monaco, model, source, span.start, span.end),
    uri: model.uri,
  }));
}

function localRenameLocation(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  position: MonacoPosition,
): Monaco.languages.RenameLocation & Monaco.languages.Rejection {
  const target = neonRenameTargetAt(source, offsetAtMonacoPosition(source, position));
  return target
    ? {
        range: templateReplaceRange(
          monaco,
          model,
          source,
          target.selectedSpan.start,
          target.selectedSpan.end,
        ),
        text: target.placeholder,
      }
    : renameRejection(position, "This NEON symbol cannot be renamed safely.");
}

function localRenameEdits(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  position: MonacoPosition,
  newName: string,
): Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection {
  const plan = planNeonSymbolRename(source, offsetAtMonacoPosition(source, position), newName);
  return plan
    ? {
        edits: plan.edits.map(({ newText, span }) => ({
          resource: model.uri,
          textEdit: {
            range: templateReplaceRange(monaco, model, source, span.start, span.end),
            text: newText,
          },
          versionId: model.getVersionId(),
        })),
      }
    : renameEditsRejection("This NEON rename is unsafe or stale.");
}

function renameRejection(
  position: MonacoPosition,
  reason: string,
): Monaco.languages.RenameLocation & Monaco.languages.Rejection {
  return { range: emptyRange(position), text: "", rejectReason: reason };
}

function renameEditsRejection(
  reason: string,
): Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection {
  return { edits: [], rejectReason: reason };
}

function localNeonSource(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
): { readonly rootPath: string | null; readonly source: string } | null {
  const workspace = localNeonDocument(context, model);
  if (workspace) return workspace;
  if ((context.getWorkspaceRoot?.() ?? null) !== null) return null;
  const active = context.getActiveDocument();
  if (!active || active.language !== "neon") return null;
  const source = modelSource(model, active.content);
  return isLargeTemplateSmartDocument(context, source) ? null : { rootPath: null, source };
}

function captureRequest(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  rootPath: string,
  token: Monaco.CancellationToken,
  additionalCurrent: () => boolean = () => true,
): {
  readonly isCurrent: () => boolean;
  readonly repository: NeonCrossFileRepository;
} | null {
  const factory = context.createNeonSemanticDiagnosticsRepository;
  const active = context.getActiveDocument();
  if (!factory || !active) return null;
  const openModels = (monaco.editor.getModels?.() ?? []).filter(
    (candidate) => candidate.getLanguageId() === "neon" && modelPath(candidate),
  );
  if (openModels.length > 16) return null;
  if (!openModels.includes(model)) openModels.unshift(model);
  const versions = new Map(openModels.map((candidate) => [candidate, candidate.getVersionId()]));
  const path = active.path;
  const isCurrent = () =>
    !token.isCancellationRequested &&
    additionalCurrent() &&
    [...versions].every(([candidate, version]) => candidate.getVersionId() === version) &&
    isStoredWorkspaceRootActive(context, rootPath);
  const openOverlays = new Map<string, string>();
  for (const openModel of openModels) {
    const openPath = modelPath(openModel);
    if (openPath) openOverlays.set(openPath, openModel.getValue());
  }
  try {
    const repository = factory({ activePath: path, isCurrent, openOverlays, rootPath });
    return repository ? { isCurrent, repository } : null;
  } catch (error) {
    if (isCurrent()) safeReport(context, error);
    return null;
  }
}

function safeReport(context: TemplateLanguageMonacoProviderContext, error: unknown): void {
  try {
    context.reportError(error);
  } catch {
    // Error reporting is observational; providers must keep their fail-closed contract.
  }
}

function openRenameDocuments(
  monaco: MonacoApi,
  plan: Extract<NeonCrossFileRenamePlan, { kind: "ready" }>,
): NeonWorkspaceRenameOpenDocumentCapture[] {
  const touched = new Set(plan.edits.map(({ path }) => pathKey(path)));
  return (monaco.editor.getModels?.() ?? []).flatMap((model) => {
    const path = modelPath(model);
    if (!path || !touched.has(pathKey(path))) return [];
    const snapshot = { content: model.getValue(), versionId: model.getVersionId() };
    return [
      {
        content: snapshot.content,
        model: monacoRenameModel(model),
        path,
        uri: model.uri.toString(),
        versionId: snapshot.versionId,
      },
    ];
  });
}

function monacoRenameModel(model: MonacoModel): TemplateWorkspaceRenameOpenModel {
  return {
    read: () => ({ content: model.getValue(), versionId: model.getVersionId() }),
    replace: (expected, content) => {
      if (model.getValue() !== expected.content || model.getVersionId() !== expected.versionId) {
        return null;
      }
      try {
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: content }],
          () => null,
        );
      } catch {
        return null;
      }
      return { content: model.getValue(), versionId: model.getVersionId() };
    },
  };
}

function modelPath(model: MonacoModel): string | null {
  const path = model.uri.fsPath || model.uri.path;
  return path || null;
}

function pathKey(path: string): string {
  const normalized = path.split("\\").join("/");
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function workspaceUri(monaco: MonacoApi, rootPath: string, path: string): Monaco.Uri | null {
  return toWorkspaceMonacoUri(monaco, rootPath, path);
}

function rangeFromSource(
  monaco: MonacoApi,
  source: string,
  span: { readonly start: number; readonly end: number },
): Monaco.IRange {
  const start = positionAtOffset(source, span.start);
  const end = positionAtOffset(source, span.end);
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

function positionAtOffset(source: string, offset: number): MonacoPosition {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return {
    column: offset - lineStart + 1,
    lineNumber: before.split("\n").length,
  } as MonacoPosition;
}

function localNeonDocument(context: TemplateLanguageMonacoProviderContext, model: MonacoModel) {
  const documentContext = activeTemplateDocumentContext(context, model, "neon");
  if (!documentContext) return null;
  const source = modelSource(model, documentContext.activeDocument.content);
  if (isLargeTemplateSmartDocument(context, source)) return null;
  return { rootPath: documentContext.rootPath, source };
}

function emptyRange(position: MonacoPosition): Monaco.IRange {
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: position.column,
    endColumn: position.column,
  };
}

export function toMonacoNeonCompletion(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  fallbackRange: Monaco.IRange,
  completion: NeonCompletion,
  index: number,
): Monaco.languages.CompletionItem {
  const range =
    completion.replaceStart != null && completion.replaceEnd != null
      ? templateReplaceRange(monaco, model, source, completion.replaceStart, completion.replaceEnd)
      : fallbackRange;

  return {
    detail: completion.detail,
    insertText: completion.insertText,
    kind: monacoNeonCompletionKind(monaco, completion.kind),
    label: completion.label,
    range,
    sortText: `0_${String(index).padStart(4, "0")}`,
  };
}

async function provideNeonDefinition(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  const documentContext = activeTemplateDocumentContext(context, model, "neon");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);

  if (isLargeTemplateSmartDocument(context, source)) {
    return null;
  }

  const offset = offsetAtMonacoPosition(source, position);
  const request = templateDefinitionNavigationRequest(
    context,
    model,
    documentContext.rootPath,
    documentContext.path,
  );

  try {
    await context.getTemplateLanguageProviders().neon.provideDefinition(source, offset, request);
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }
  }

  return null;
}

async function provideNeonCompletionItems(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  const documentContext = activeTemplateDocumentContext(context, model, "neon");

  if (!documentContext) {
    return { suggestions: [] };
  }

  const source = modelSource(model, documentContext.activeDocument.content);

  if (isLargeTemplateSmartDocument(context, source)) {
    return { suggestions: [] };
  }

  const word = model.getWordUntilPosition(position);
  const fallbackRange = templateCompletionFallbackRange(position, word);

  try {
    const completions = await context
      .getTemplateLanguageProviders()
      .neon.provideCompletions(source, position);

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return { suggestions: [] };
    }

    return {
      suggestions: completions.map((completion, index) =>
        toMonacoNeonCompletion(monaco, model, source, fallbackRange, completion, index),
      ),
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return { suggestions: [] };
  }
}

function monacoNeonCompletionKind(
  monaco: MonacoApi,
  kind: NeonCompletionKind,
): Monaco.languages.CompletionItemKind {
  if (kind === "parameter") {
    return monaco.languages.CompletionItemKind.Variable;
  }

  if (kind === "service") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (kind === "method") {
    return monaco.languages.CompletionItemKind.Method;
  }

  return monaco.languages.CompletionItemKind.Class;
}
