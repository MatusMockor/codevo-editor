import type * as Monaco from "monaco-editor";
import {
  isValidLatteBlockSymbolName,
  latteBlockSymbolOccurrenceAt,
  latteBlockSymbolOccurrences,
} from "../application/latteBlockSymbols";
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
    triggerCharacters: ["{", "$", "-", ">", "|", "'", "\"", ".", "/"],
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

  return {
    dispose: () => {
      definition.dispose();
      references.dispose();
      rename.dispose();
      completion.dispose();
      codeActions.dispose();
    },
  };
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

  return {
    detail: completion.detail,
    insertText: completion.insertText,
    kind: monacoLatteCompletionKind(monaco, completion.kind),
    label: completion.label,
    range,
    sortText: `0_${String(index).padStart(4, "0")}`,
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
      return [
        latteSymbolLocation(
          monaco,
          model,
          source,
          occurrence.declarationSpan,
        ),
      ];
    }

    const declaration = latteBlockSymbolOccurrences(
      source,
      occurrence.name,
    ).find((candidate) => candidate.kind === "declaration");

    if (!declaration) {
      return null;
    }

    return [latteSymbolLocation(monaco, model, source, declaration.span)];
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

function provideLatteReferences(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  referenceContext: Monaco.languages.ReferenceContext,
): Monaco.languages.Location[] | null {
  const symbolContext = activeLatteSymbolContext(context, model, position);

  if (!symbolContext) {
    return null;
  }

  const { occurrence, source } = symbolContext;

  return latteBlockSymbolOccurrences(source, occurrence.name)
    .filter(
      (candidate) =>
        referenceContext.includeDeclaration || candidate.kind !== "declaration",
    )
    .map((candidate) => latteSymbolLocation(monaco, model, source, candidate.span));
}

function provideLatteRenameEdits(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  newName: string,
): Monaco.languages.ProviderResult<
  Monaco.languages.WorkspaceEdit & Monaco.languages.Rejection
> {
  if (!isValidLatteBlockSymbolName(newName)) {
    return { edits: [], rejectReason: "Enter a valid Latte block name." };
  }

  const symbolContext = activeLatteSymbolContext(context, model, position);

  if (!symbolContext) {
    return { edits: [], rejectReason: "No same-file Latte block at this position." };
  }

  const { occurrence, source } = symbolContext;
  const versionId = model.getVersionId?.();

  return {
    edits: latteBlockSymbolOccurrences(source, occurrence.name).map(
      (candidate) => ({
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
      }),
    ),
  };
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

  return { occurrence, source };
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
