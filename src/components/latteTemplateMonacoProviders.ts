import type * as Monaco from "monaco-editor";
import type {
  LatteCompletion,
  LatteCompletionKind,
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";
import {
  activeTemplateDocumentContext,
  codeActionOffsetRange,
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
          provideLatteDefinition(context, model, position),
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
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  const documentContext = activeTemplateDocumentContext(context, model, "latte");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);
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

  return monaco.languages.CompletionItemKind.Keyword;
}
