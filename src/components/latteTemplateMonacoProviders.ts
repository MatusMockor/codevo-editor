import type * as Monaco from "monaco-editor";
import {
  isValidLatteBlockSymbolName,
  latteBlockSymbolOccurrenceAt,
  latteBlockSymbolOccurrences,
} from "../application/latteBlockSymbols";
import {
  sweepLatteBlockRename,
  type LatteBlockRenameSweepFile,
} from "../application/latteBlockRenameSweep";
import {
  collectLatteTemplateGraphDocuments,
  joinLatteWorkspacePath,
  latteCrossFileBlockDefinition,
  latteCrossFileBlockOccurrences,
  latteWorkspaceRelativePath,
  type LatteTemplateGraphDocument,
} from "../application/latteCrossFileBlocks";
import type {
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
  WorkspaceEditOpenModelCommitResult,
} from "../application/workspaceEditApplication";
import type { LatteBlockSourceSpan } from "../domain/latteBlockSyntax";
import { formatLatteSource } from "../domain/latteFormatting";
import type {
  LanguageServerTextEdit,
  LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";
import {
  createWorkspaceRootFromPath,
  parseWorkspacePath,
} from "../domain/workspacePath";
import { toWorkspaceMonacoUri } from "./phpMonacoDocumentContext";
import type {
  LatteCompletion,
  LatteCompletionKind,
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";
import {
  activeTemplateDocumentContext,
  codeActionOffsetRange,
  isLargeTemplateSmartDocument,
  isStoredWorkspaceRootActive,
  modelSource,
  offsetAtMonacoPosition,
  templateDefinitionNavigationRequest,
  templateCompletionFallbackRange,
  templateCodeActionContextFromMonaco,
  templateReplaceRange,
} from "./templateLanguageMonacoUtils";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export interface LatteCrossFileBlockMonacoContext
  extends TemplateLanguageMonacoProviderContext {
  applyWorkspaceEdit?(
    edit: LanguageServerWorkspaceEdit,
    applicationContext: WorkspaceEditApplicationContext,
  ): Promise<WorkspaceEditApplicationDecision>;
  listWorkspaceTemplateFiles?(rootPath: string): Promise<string[] | null>;
  readTemplateFileContent?(path: string): Promise<string | null>;
}

export function registerLatteTemplateMonacoProviders<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
): Disposable {
  const definition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("latte", {
        provideDefinition: (model, position) =>
          provideLatteDefinition(monaco, context, model, position),
      })
    : { dispose: () => undefined };
  const references = monaco.languages.registerReferenceProvider
    ? monaco.languages.registerReferenceProvider("latte", {
        provideReferences: (model, position, referenceContext) =>
          provideLatteReferences(
            monaco,
            context,
            model,
            position,
            referenceContext,
          ),
      })
    : { dispose: () => undefined };
  const rename = monaco.languages.registerRenameProvider
    ? monaco.languages.registerRenameProvider("latte", {
        provideRenameEdits: (model, position, newName) =>
          provideLatteRenameEdits(
            monaco,
            context,
            model,
            position,
            newName,
          ),
        resolveRenameLocation: (model, position) =>
          resolveLatteRenameLocation(monaco, context, model, position),
      })
    : { dispose: () => undefined };
  const completion = monaco.languages.registerCompletionItemProvider("latte", {
    triggerCharacters: ["{", "$", "-", ">", "|", "'", "\"", ".", "/", ":"],
    provideCompletionItems: (model, position) =>
      provideLatteCompletionItems(monaco, context, model, position),
  });
  const codeActions = monaco.languages.registerCodeActionProvider(
    "latte",
    {
      provideCodeActions: (model, range, actionContext) =>
        provideLatteCodeActions(
          monaco,
          context,
          handlers,
          model,
          range,
          actionContext,
        ),
    },
    { providedCodeActionKinds: ["quickfix"] },
  );
  const formatting = monaco.languages.registerDocumentFormattingEditProvider
    ? monaco.languages.registerDocumentFormattingEditProvider("latte", {
        provideDocumentFormattingEdits: (model, options) =>
          provideLatteDocumentFormattingEdits(monaco, context, model, options),
      })
    : { dispose: () => undefined };

  return {
    dispose: () => {
      definition.dispose();
      references.dispose();
      rename.dispose();
      completion.dispose();
      codeActions.dispose();
      formatting.dispose();
    },
  };
}

function provideLatteDocumentFormattingEdits(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  options: Monaco.languages.FormattingOptions,
): Monaco.languages.TextEdit[] {
  const documentContext = activeTemplateDocumentContext(context, model, "latte");

  if (!documentContext) {
    return [];
  }

  const source = modelSource(model, documentContext.activeDocument.content);

  if (isLargeTemplateSmartDocument(context, source)) {
    return [];
  }

  const formatted = formatLatteSource(source, {
    indentUnit: latteIndentUnit(options),
  });

  if (formatted === source) {
    return [];
  }

  return [{ range: latteFullSourceRange(monaco, source), text: formatted }];
}

function latteIndentUnit(options: Monaco.languages.FormattingOptions): string {
  if (!options.insertSpaces) {
    return "\t";
  }

  return " ".repeat(Math.max(1, options.tabSize));
}

function latteFullSourceRange(monaco: MonacoApi, source: string): Monaco.Range {
  const lines = source.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return new monaco.Range(1, 1, lines.length, lastLine.length + 1);
}

export function toMonacoLatteCompletion(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  fallbackRange: Monaco.IRange,
  completion: LatteCompletion,
  index: number,
): Monaco.languages.CompletionItem {
  const range =
    completion.replaceStart != null && completion.replaceEnd != null
      ? templateReplaceRange(
          monaco,
          model,
          source,
          completion.replaceStart,
          completion.replaceEnd,
        )
      : fallbackRange;

  const item: Monaco.languages.CompletionItem = {
    detail: completion.detail,
    insertText: completion.insertText,
    kind: monacoLatteCompletionKind(monaco, completion.kind),
    label: completion.label,
    range,
    sortText: `0_${String(index).padStart(4, "0")}`,
  };

  if (!completion.insertSnippet) {
    return item;
  }

  return {
    ...item,
    insertText: completion.insertSnippet,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  };
}

async function provideLatteDefinition(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  const documentContext = activeTemplateDocumentContext(context, model, "latte");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);

  if (isLargeTemplateSmartDocument(context, source)) {
    return null;
  }

  const offset = offsetAtMonacoPosition(source, position);
  const occurrence = latteBlockSymbolOccurrenceAt(source, offset);

  if (occurrence) {
    if (occurrence.declarationSpan) {
      const ancestor =
        occurrence.kind === "declaration"
          ? await latteAncestorDeclarationLocation(
              monaco,
              context,
              documentContext,
              source,
              occurrence.name,
            )
          : null;

      return [
        ancestor ??
          latteSymbolLocation(monaco, model, source, occurrence.declarationSpan),
      ];
    }

    const declaration = latteBlockSymbolOccurrences(
      source,
      occurrence.name,
    ).find((candidate) => candidate.kind === "declaration");

    if (declaration) {
      return [latteSymbolLocation(monaco, model, source, declaration.span)];
    }

    const ancestor = await latteAncestorDeclarationLocation(
      monaco,
      context,
      documentContext,
      source,
      occurrence.name,
    );

    return ancestor ? [ancestor] : null;
  }

  const request = templateDefinitionNavigationRequest(
    context,
    model,
    documentContext.rootPath,
    documentContext.path,
  );

  try {
    await context
      .getTemplateLanguageProviders()
      .latte.provideDefinition(source, offset, request);
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }
  }

  return null;
}

async function provideLatteReferences(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  referenceContext: Monaco.languages.ReferenceContext,
): Promise<Monaco.languages.Location[] | null> {
  const symbolContext = activeLatteSymbolContext(context, model, position);

  if (!symbolContext) {
    return null;
  }

  const { documentContext, occurrence, source } = symbolContext;
  const matchesReferenceContext = (candidate: { kind: string }) =>
    referenceContext.includeDeclaration || candidate.kind !== "declaration";
  const sameFileLocations = latteBlockSymbolOccurrences(source, occurrence.name)
    .filter(matchesReferenceContext)
    .map((candidate) => latteSymbolLocation(monaco, model, source, candidate.span));
  const documents = await latteTemplateGraphDocuments(
    monaco,
    context,
    documentContext,
    source,
  );

  if (!documents) {
    return sameFileLocations;
  }

  const crossFileLocations = latteCrossFileBlockOccurrences(
    documents.slice(1),
    occurrence.name,
  )
    .filter(({ occurrence: candidate }) => matchesReferenceContext(candidate))
    .flatMap(({ document, occurrence: candidate }) => {
      const location = latteCrossFileSymbolLocation(
        monaco,
        documentContext.rootPath,
        document,
        candidate.span,
      );

      return location ? [location] : [];
    });

  return [...sameFileLocations, ...crossFileLocations];
}

const LATTE_RENAME_STALE_REASON =
  "The workspace changed while computing the Latte block rename.";
const LATTE_RENAME_CHANGED_REASON =
  "A template changed while computing the Latte block rename.";

interface LatteRenamePlanEntry {
  absolutePath: string;
  file: LatteBlockRenameSweepFile;
  model: MonacoModel | null;
  versionId: number | null;
}

async function provideLatteRenameEdits(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
): Promise<Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection> {
  if (!isValidLatteBlockSymbolName(newName)) {
    return latteRenameRejection("Enter a valid Latte block name.");
  }

  const symbolContext = activeLatteSymbolContext(context, model, position);

  if (!symbolContext) {
    return latteRenameRejection("No same-file Latte block at this position.");
  }

  const { documentContext, occurrence, source } = symbolContext;
  const crossFile = await latteCrossFileRenameEdits(
    monaco,
    context,
    model,
    documentContext,
    source,
    occurrence.name,
    newName,
  );

  if (crossFile) {
    return crossFile;
  }

  return sameFileLatteRenameEdits(monaco, model, source, occurrence.name, newName);
}

function sameFileLatteRenameEdits(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  name: string,
  newName: string,
): Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection {
  const versionId = model.getVersionId?.();

  return {
    edits: latteBlockSymbolOccurrences(source, name).map((candidate) => ({
      resource: model.uri,
      textEdit: {
        range: templateReplaceRange(
          monaco,
          model,
          source,
          candidate.span.start,
          candidate.span.end,
        ),
        text: newName,
      },
      versionId,
    })),
  };
}

async function latteCrossFileRenameEdits(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  documentContext: LatteDocumentContext,
  source: string,
  name: string,
  newName: string,
): Promise<(Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection) | null> {
  const crossFileContext = context as LatteCrossFileBlockMonacoContext;
  const { listWorkspaceTemplateFiles, readTemplateFileContent } =
    crossFileContext;

  if (!listWorkspaceTemplateFiles || !readTemplateFileContent) {
    return null;
  }

  const { path, rootPath } = documentContext;
  const currentRelativePath = latteWorkspaceRelativePath(rootPath, path);

  if (!currentRelativePath) {
    return null;
  }

  const sweep = await sweepLatteBlockRename(
    {
      isRequestedRootActive: () =>
        isStoredWorkspaceRootActive(context, rootPath),
      listTemplateFiles: () =>
        listLatteSweepTemplates(listWorkspaceTemplateFiles, rootPath),
      readTemplateFile: (relativePath) =>
        relativePath === currentRelativePath
          ? Promise.resolve(source)
          : readLatteTemplateSource(
              monaco,
              rootPath,
              relativePath,
              readTemplateFileContent,
            ),
    },
    currentRelativePath,
    name,
  );

  if (sweep.kind === "unavailable") {
    return null;
  }

  if (sweep.kind === "rejected") {
    return latteRenameRejection(sweep.reason);
  }

  if (!isStoredWorkspaceRootActive(context, rootPath)) {
    return latteRenameRejection(LATTE_RENAME_STALE_REASON);
  }

  const files = sweep.files;

  if (files.length === 0) {
    return null;
  }

  if (files.length === 1 && files[0]?.relativePath === currentRelativePath) {
    return null;
  }

  if (!files.some((file) => file.relativePath === currentRelativePath)) {
    return latteRenameRejection(LATTE_RENAME_CHANGED_REASON);
  }

  const plan: LatteRenamePlanEntry[] = [];

  for (const file of files) {
    const absolutePath = joinLatteWorkspacePath(rootPath, file.relativePath);
    const openModel =
      file.relativePath === currentRelativePath
        ? model
        : openLatteModel(monaco, rootPath, absolutePath);

    if (!openModel) {
      plan.push({ absolutePath, file, model: null, versionId: null });
      continue;
    }

    const staged = latteModelValueAndVersion(openModel);

    if (!staged || staged.value !== file.source) {
      return latteRenameRejection(LATTE_RENAME_CHANGED_REASON);
    }

    plan.push({
      absolutePath,
      file,
      model: openModel,
      versionId: staged.versionId,
    });
  }

  if (crossFileContext.applyWorkspaceEdit) {
    return applyLatteRenameThroughWorkspaceEdit(
      monaco,
      crossFileContext,
      rootPath,
      plan,
      newName,
    );
  }

  if (plan.every((entry) => entry.model !== null)) {
    return {
      edits: plan.flatMap((entry) => latteModelRenameEdits(monaco, entry, newName)),
    };
  }

  return latteRenameRejection(
    "The rename touches closed templates, and workspace edit support is unavailable.",
  );
}

async function applyLatteRenameThroughWorkspaceEdit(
  monaco: MonacoApi,
  context: LatteCrossFileBlockMonacoContext,
  rootPath: string,
  plan: LatteRenamePlanEntry[],
  newName: string,
): Promise<Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection> {
  const root = createWorkspaceRootFromPath(rootPath);

  if (!root.ok) {
    return latteRenameRejection(LATTE_RENAME_STALE_REASON);
  }

  const changes: Record<string, LanguageServerTextEdit[]> = {};

  for (const entry of plan) {
    const parsed = parseWorkspacePath(root.value, entry.absolutePath);

    if (!parsed.ok) {
      return latteRenameRejection(LATTE_RENAME_STALE_REASON);
    }

    changes[parsed.value.fileUri] = languageServerLatteRenameEdits(
      entry.file,
      newName,
    );
  }

  const staged = plan.filter((entry) => entry.model !== null);
  let commit: WorkspaceEditOpenModelCommitResult | undefined;
  const applyOpenModels = () => {
    if (commit) {
      return commit;
    }

    commit = commitLatteRenameToOpenModels(monaco, staged, newName);
    return commit;
  };

  const decision = await context.applyWorkspaceEdit?.(
    { changes },
    {
      applyOpenModels,
      openPaths: staged.map((entry) => entry.absolutePath),
      rootPath,
    },
  );

  if (!decision || decision.kind === "rejected") {
    return latteRenameRejection(
      "The Latte block rename could not be applied safely.",
    );
  }

  const finalCommit = applyOpenModels();

  if (finalCommit.kind === "rejected") {
    return latteRenameRejection(LATTE_RENAME_CHANGED_REASON);
  }

  return { edits: [] };
}

function commitLatteRenameToOpenModels(
  monaco: MonacoApi,
  staged: LatteRenamePlanEntry[],
  newName: string,
): WorkspaceEditOpenModelCommitResult {
  for (const entry of staged) {
    if (!entry.model) {
      continue;
    }

    const current = latteModelValueAndVersion(entry.model);

    if (
      !current ||
      current.value !== entry.file.source ||
      (entry.versionId !== null && current.versionId !== entry.versionId)
    ) {
      return {
        kind: "rejected",
        path: entry.absolutePath,
        reason: "invalidOpenModelEdits",
      };
    }
  }

  for (const entry of staged) {
    entry.model?.pushEditOperations?.(
      [],
      entry.file.occurrences.map((occurrence) => ({
        range: latteSourceRange(monaco, entry.file.source, occurrence.span),
        text: newName,
      })),
      () => null,
    );
  }

  return {
    documents: staged.map((entry) => ({
      content: entry.model?.getValue() ?? entry.file.source,
      path: entry.absolutePath,
      versionId: entry.model?.getVersionId?.() ?? 0,
    })),
    kind: "applied",
  };
}

function latteModelRenameEdits(
  monaco: MonacoApi,
  entry: LatteRenamePlanEntry,
  newName: string,
): Monaco.languages.IWorkspaceTextEdit[] {
  const renameModel = entry.model;

  if (!renameModel) {
    return [];
  }

  return entry.file.occurrences.map((occurrence) => ({
    resource: renameModel.uri,
    textEdit: {
      range: latteSourceRange(monaco, entry.file.source, occurrence.span),
      text: newName,
    },
    versionId: entry.versionId ?? undefined,
  }));
}

function languageServerLatteRenameEdits(
  file: LatteBlockRenameSweepFile,
  newName: string,
): LanguageServerTextEdit[] {
  return [...file.occurrences]
    .sort((left, right) => right.span.start - left.span.start)
    .map((occurrence) => ({
      newText: newName,
      range: {
        end: languageServerPositionAtOffset(file.source, occurrence.span.end),
        start: languageServerPositionAtOffset(file.source, occurrence.span.start),
      },
    }));
}

function languageServerPositionAtOffset(
  source: string,
  offset: number,
): { character: number; line: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    character: clamped - lineStart,
    line: before.split("\n").length - 1,
  };
}

async function listLatteSweepTemplates(
  listWorkspaceTemplateFiles: (rootPath: string) => Promise<string[] | null>,
  rootPath: string,
): Promise<string[] | null> {
  const listed = await listWorkspaceTemplateFiles(rootPath);

  if (listed === null) {
    return null;
  }

  return listed.flatMap((path) => {
    const relativePath = latteWorkspaceRelativePath(rootPath, path);

    return relativePath === null ? [] : [relativePath];
  });
}

async function readLatteTemplateSource(
  monaco: MonacoApi,
  rootPath: string,
  relativePath: string,
  readTemplateFileContent: (path: string) => Promise<string | null>,
): Promise<string | null> {
  const absolutePath = joinLatteWorkspacePath(rootPath, relativePath);
  const openSource = openLatteModelValue(monaco, rootPath, absolutePath);

  if (openSource !== null) {
    return openSource;
  }

  return (await readTemplateFileContent(absolutePath)) ?? null;
}

function latteModelValueAndVersion(
  model: MonacoModel,
): { value: string; versionId: number | null } | null {
  try {
    return {
      value: model.getValue(),
      versionId: model.getVersionId?.() ?? null,
    };
  } catch {
    return null;
  }
}

function latteRenameRejection(
  reason: string,
): Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection {
  return { edits: [], rejectReason: reason };
}

function resolveLatteRenameLocation(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): (Monaco.languages.RenameLocation & Monaco.languages.Rejection) | null {
  const symbolContext = activeLatteSymbolContext(context, model, position);

  if (!symbolContext) {
    return null;
  }

  const { occurrence, source } = symbolContext;

  return {
    range: templateReplaceRange(
      monaco,
      model,
      source,
      occurrence.span.start,
      occurrence.span.end,
    ),
    text: occurrence.name,
  };
}

function activeLatteSymbolContext(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
) {
  const documentContext = activeTemplateDocumentContext(context, model, "latte");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);

  if (isLargeTemplateSmartDocument(context, source)) {
    return null;
  }

  const offset = offsetAtMonacoPosition(source, position);
  const occurrence = latteBlockSymbolOccurrenceAt(source, offset);

  if (!occurrence) {
    return null;
  }

  return { documentContext, occurrence, source };
}

type LatteDocumentContext = NonNullable<
  ReturnType<typeof activeTemplateDocumentContext>
>;

async function latteTemplateGraphDocuments(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  documentContext: LatteDocumentContext,
  source: string,
): Promise<LatteTemplateGraphDocument[] | null> {
  const readTemplateFileContent = (context as LatteCrossFileBlockMonacoContext)
    .readTemplateFileContent;

  if (!readTemplateFileContent) {
    return null;
  }

  const { path, rootPath } = documentContext;
  const relativePath = latteWorkspaceRelativePath(rootPath, path);

  if (!relativePath) {
    return null;
  }

  const documents = await collectLatteTemplateGraphDocuments(
    {
      isRequestedRootActive: () => isStoredWorkspaceRootActive(context, rootPath),
      readTemplateFile: async (relative) => {
        const absolutePath = joinLatteWorkspacePath(rootPath, relative);
        const openSource = openLatteModelValue(monaco, rootPath, absolutePath);

        if (openSource !== null) {
          return openSource;
        }

        try {
          return (await readTemplateFileContent(absolutePath)) ?? null;
        } catch {
          return null;
        }
      },
    },
    relativePath,
    source,
  );

  if (!documents || !isStoredWorkspaceRootActive(context, rootPath)) {
    return null;
  }

  return documents;
}

async function latteAncestorDeclarationLocation(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  documentContext: LatteDocumentContext,
  source: string,
  name: string,
): Promise<Monaco.languages.Location | null> {
  const documents = await latteTemplateGraphDocuments(
    monaco,
    context,
    documentContext,
    source,
  );

  if (!documents) {
    return null;
  }

  const definition = latteCrossFileBlockDefinition(documents.slice(1), name);

  if (!definition) {
    return null;
  }

  return latteCrossFileSymbolLocation(
    monaco,
    documentContext.rootPath,
    definition.document,
    definition.span,
  );
}

function latteCrossFileSymbolLocation(
  monaco: MonacoApi,
  rootPath: string,
  document: LatteTemplateGraphDocument,
  span: LatteBlockSourceSpan,
): Monaco.languages.Location | null {
  const path = joinLatteWorkspacePath(rootPath, document.relativePath);
  const uri = toWorkspaceMonacoUri(monaco, rootPath, path);

  if (!uri) {
    return null;
  }

  return { range: latteSourceRange(monaco, document.source, span), uri };
}

function openLatteModel(
  monaco: MonacoApi,
  rootPath: string,
  path: string,
): MonacoModel | null {
  const uri = toWorkspaceMonacoUri(monaco, rootPath, path);

  if (!uri) {
    return null;
  }

  try {
    return monaco.editor?.getModel?.(uri) ?? null;
  } catch {
    return null;
  }
}

function openLatteModelValue(
  monaco: MonacoApi,
  rootPath: string,
  path: string,
): string | null {
  const model = openLatteModel(monaco, rootPath, path);

  if (!model) {
    return null;
  }

  try {
    return model.getValue();
  } catch {
    return null;
  }
}

function latteSourceRange(
  monaco: MonacoApi,
  source: string,
  span: LatteBlockSourceSpan,
): Monaco.Range {
  const start = lattePositionAtOffset(source, span.start);
  const end = lattePositionAtOffset(source, span.end);

  return new monaco.Range(
    start.lineNumber,
    start.column,
    end.lineNumber,
    end.column,
  );
}

function lattePositionAtOffset(
  source: string,
  offset: number,
): { column: number; lineNumber: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}

function latteSymbolLocation(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  span: { end: number; start: number },
): Monaco.languages.Location {
  return {
    range: templateReplaceRange(monaco, model, source, span.start, span.end),
    uri: model.uri,
  };
}

async function provideLatteCompletionItems(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  const documentContext = activeTemplateDocumentContext(context, model, "latte");

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
      .latte.provideCompletions(source, position);

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return { suggestions: [] };
    }

    return {
      suggestions: completions.map((completion, index) =>
        toMonacoLatteCompletion(
          monaco,
          model,
          source,
          fallbackRange,
          completion,
          index,
        ),
      ),
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return { suggestions: [] };
  }
}

async function provideLatteCodeActions<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
): Promise<Monaco.languages.CodeActionList> {
  if (!latteQuickFixKindRequested(actionContext.only)) {
    return emptyLatteCodeActions();
  }

  const documentContext = activeTemplateDocumentContext(context, model, "latte");

  if (!documentContext) {
    return emptyLatteCodeActions();
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offsetRange = codeActionOffsetRange(source, range);
  const diagnosticContext = templateCodeActionContextFromMonaco(
    actionContext.markers,
  );

  try {
    const provider = context.getTemplateLanguageProviders().latte;
    const descriptors = diagnosticContext
      ? await provider.provideCodeActions(source, offsetRange, diagnosticContext)
      : await provider.provideCodeActions(source, offsetRange);

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return emptyLatteCodeActions();
    }

    return {
      actions: descriptors.map((descriptor) =>
        handlers.toCodeAction(monaco, context, model, descriptor),
      ),
      dispose: () => undefined,
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return emptyLatteCodeActions();
  }
}

function latteQuickFixKindRequested(only: string | undefined): boolean {
  return !only || only.startsWith("quickfix");
}

function emptyLatteCodeActions(): Monaco.languages.CodeActionList {
  return { actions: [], dispose: () => undefined };
}

function monacoLatteCompletionKind(
  monaco: MonacoApi,
  kind: LatteCompletionKind,
): Monaco.languages.CompletionItemKind {
  if (kind === "block") {
    return monaco.languages.CompletionItemKind.Reference;
  }

  if (kind === "template") {
    return monaco.languages.CompletionItemKind.File;
  }

  if (kind === "variable") {
    return monaco.languages.CompletionItemKind.Variable;
  }

  if (kind === "member") {
    return monaco.languages.CompletionItemKind.Field;
  }

  if (kind === "filter") {
    return monaco.languages.CompletionItemKind.Function;
  }

  if (kind === "link") {
    return monaco.languages.CompletionItemKind.Method;
  }

  if (kind === "component") {
    return monaco.languages.CompletionItemKind.Module;
  }

  if (kind === "translation") {
    return monaco.languages.CompletionItemKind.Value;
  }

  if (kind === "snippet") {
    return monaco.languages.CompletionItemKind.Value;
  }

  return monaco.languages.CompletionItemKind.Keyword;
}
