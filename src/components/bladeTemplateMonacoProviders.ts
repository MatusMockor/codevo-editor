import type * as Monaco from "monaco-editor";
import {
  normalizeUserSnippets,
  snippetCompletionSuggestions,
} from "../domain/snippets";
import type {
  BladeCompletion,
  BladeCompletionKind,
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
  templateReplaceRange,
} from "./templateLanguageMonacoUtils";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export function registerBladeTemplateMonacoProviders<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
): Disposable {
  const definition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("blade", {
        provideDefinition: (model, position) =>
          provideBladeDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const completion = monaco.languages.registerCompletionItemProvider("blade", {
    // `$` opens the view-variable list and `>` completes `->` member access
    // during natural typing.
    triggerCharacters: ["@", "'", "\"", "-", ".", "$", ">"],
    provideCompletionItems: (model, position) =>
      provideBladeCompletionItems(monaco, context, model, position),
  });
  const codeActions = monaco.languages.registerCodeActionProvider(
    "blade",
    {
      provideCodeActions: (model, range, actionContext) =>
        provideBladeCodeActions(
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

export function toMonacoBladeCompletion(
  monaco: MonacoApi,
  model: MonacoModel,
  source: string,
  fallbackRange: Monaco.IRange,
  completion: BladeCompletion,
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
    kind: monacoBladeCompletionKind(monaco, completion.kind),
    label: completion.label,
    range,
    sortText: `0_${String(index).padStart(4, "0")}`,
  };
}

async function provideBladeDefinition(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  const documentContext = activeTemplateDocumentContext(context, model, "blade");

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
      .blade.provideDefinition(source, offset, request);
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }
  }

  return null;
}

async function provideBladeCompletionItems(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.CompletionList> {
  const documentContext = activeTemplateDocumentContext(context, model, "blade");

  if (!documentContext) {
    return { suggestions: [] };
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const word = model.getWordUntilPosition(position);
  const fallbackRange = templateCompletionFallbackRange(position, word);
  const snippetSuggestions = bladeSnippetSuggestions(
    monaco,
    context,
    model,
    position,
    word,
  );

  try {
    const completions = await context
      .getTemplateLanguageProviders()
      .blade.provideCompletions(source, position);

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return { suggestions: [] };
    }

    return {
      suggestions: [
        ...completions.map((completion, index) =>
          toMonacoBladeCompletion(
            monaco,
            model,
            source,
            fallbackRange,
            completion,
            index,
          ),
        ),
        ...snippetSuggestions,
      ],
    };
  } catch (error) {
    if (isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      context.reportError(error);
    }

    return { suggestions: [] };
  }
}

async function provideBladeCodeActions<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
  model: MonacoModel,
  range: Monaco.Range,
  actionContext: Monaco.languages.CodeActionContext,
): Promise<Monaco.languages.CodeActionList> {
  if (
    !bladeQuickFixKindRequested(actionContext.only)
  ) {
    return emptyBladeCodeActions();
  }

  const documentContext = activeTemplateDocumentContext(context, model, "blade");

  if (!documentContext) {
    return emptyBladeCodeActions();
  }

  const source = modelSource(model, documentContext.activeDocument.content);

  try {
    const descriptors = await context
      .getTemplateLanguageProviders()
      .blade.provideCodeActions(source, codeActionOffsetRange(source, range));

    if (!isStoredWorkspaceRootActive(context, documentContext.rootPath)) {
      return emptyBladeCodeActions();
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

    return emptyBladeCodeActions();
  }
}

function bladeSnippetSuggestions(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
  word: { endColumn: number; startColumn: number; word?: string },
): Monaco.languages.CompletionItem[] {
  const typedWord = typeof word.word === "string" ? word.word : "";
  const line = model.getLineContent?.(position.lineNumber) ?? "";
  const hasLeadingAt = line[word.startColumn - 2] === "@";
  const typed = hasLeadingAt ? `@${typedWord}` : typedWord;
  const startColumn = hasLeadingAt
    ? Math.max(1, word.startColumn - 1)
    : word.startColumn;
  const range = {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn,
    startLineNumber: position.lineNumber,
  };

  return snippetCompletionSuggestions(
    monaco,
    "blade",
    typed,
    range,
    normalizeUserSnippets(context.getUserSnippets?.() ?? []),
  ) as Monaco.languages.CompletionItem[];
}

function bladeQuickFixKindRequested(only: string | undefined): boolean {
  return !only || only.startsWith("quickfix");
}

function emptyBladeCodeActions(): Monaco.languages.CodeActionList {
  return { actions: [], dispose: () => undefined };
}

function monacoBladeCompletionKind(
  monaco: MonacoApi,
  kind: BladeCompletionKind,
): Monaco.languages.CompletionItemKind {
  if (kind === "view") {
    return monaco.languages.CompletionItemKind.File;
  }

  if (kind === "component") {
    return monaco.languages.CompletionItemKind.Field;
  }

  if (kind === "variable") {
    return monaco.languages.CompletionItemKind.Variable;
  }

  if (kind === "helper") {
    return monaco.languages.CompletionItemKind.Function;
  }

  if (kind === "member") {
    return monaco.languages.CompletionItemKind.Method;
  }

  return monaco.languages.CompletionItemKind.Keyword;
}
