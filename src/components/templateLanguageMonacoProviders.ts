import type * as Monaco from "monaco-editor";
import type {
  NeonCompletion,
  NeonCompletionKind,
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";
import {
  activeTemplateDocumentContext,
  isStoredWorkspaceRootActive,
  modelSource,
  offsetAtMonacoPosition,
  templateCompletionFallbackRange,
  templateReplaceRange,
} from "./templateLanguageMonacoUtils";
import { registerBladeTemplateMonacoProviders } from "./bladeTemplateMonacoProviders";
import { registerLatteTemplateMonacoProviders } from "./latteTemplateMonacoProviders";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;
type Disposable = Monaco.IDisposable;

export type {
  BladeCompletion,
  BladeCompletionKind,
  LatteCompletion,
  LatteCompletionKind,
  NeonCompletion,
  NeonCompletionKind,
  TemplateLanguageMonacoProviderContext,
  TemplateLanguageMonacoProviderHandlers,
} from "./templateLanguageMonacoTypes";
export { toMonacoBladeCompletion } from "./bladeTemplateMonacoProviders";
export { toMonacoLatteCompletion } from "./latteTemplateMonacoProviders";

export function registerTemplateLanguageMonacoProviders<
  Context extends TemplateLanguageMonacoProviderContext,
>(
  monaco: MonacoApi,
  context: Context,
  handlers: TemplateLanguageMonacoProviderHandlers<Context>,
): Disposable {
  const blade = registerBladeTemplateMonacoProviders(monaco, context, handlers);
  const latte = registerLatteTemplateMonacoProviders(monaco, context);
  const neonDefinition = monaco.languages.registerDefinitionProvider
    ? monaco.languages.registerDefinitionProvider("neon", {
        provideDefinition: (model, position) =>
          provideNeonDefinition(context, model, position),
      })
    : { dispose: () => undefined };
  const neonCompletion = monaco.languages.registerCompletionItemProvider(
    "neon",
    {
      triggerCharacters: ["\\", ":", " ", "-", "%", "@"],
      provideCompletionItems: (model, position) =>
        provideNeonCompletionItems(monaco, context, model, position),
    },
  );

  return {
    dispose: () => {
      blade.dispose();
      latte.dispose();
      neonDefinition.dispose();
      neonCompletion.dispose();
    },
  };
}

async function provideNeonDefinition(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<Monaco.languages.Location[] | null> {
  if (!context.provideNeonDefinition) {
    return null;
  }

  const documentContext = activeTemplateDocumentContext(context, model, "neon");

  if (!documentContext) {
    return null;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);

  try {
    await context.provideNeonDefinition(source, offset);
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
  if (!context.provideNeonCompletions) {
    return { suggestions: [] };
  }

  const documentContext = activeTemplateDocumentContext(context, model, "neon");

  if (!documentContext) {
    return { suggestions: [] };
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const word = model.getWordUntilPosition(position);
  const fallbackRange = templateCompletionFallbackRange(position, word);

  try {
    const completions = await context.provideNeonCompletions(source, position);

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
