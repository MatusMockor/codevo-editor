import type * as Monaco from "monaco-editor";
import type {
  NeonCompletion,
  NeonCompletionKind,
  TemplateLanguageMonacoProviderContext,
} from "./templateLanguageMonacoTypes";
import {
  activeTemplateDocumentContext,
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

export function registerNeonTemplateMonacoProviders(
  monaco: MonacoApi,
  context: TemplateLanguageMonacoProviderContext,
): Disposable {
  const definition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("neon", {
        provideDefinition: (model, position) =>
          provideNeonDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const completion = monaco.languages.registerCompletionItemProvider("neon", {
    triggerCharacters: ["\\", ":", " ", "-", "%", "@"],
    provideCompletionItems: (model, position) =>
      provideNeonCompletionItems(monaco, context, model, position),
  });

  return {
    dispose: () => {
      definition.dispose();
      completion.dispose();
    },
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
      .neon.provideDefinition(source, offset, request);
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
        toMonacoNeonCompletion(
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
