import type * as Monaco from "monaco-editor";
import {
  activePhpDocumentContext,
  isPhpDocumentContextActive,
  modelSource,
  offsetAtMonacoPosition,
} from "./phpMonacoDocumentContext";
import {
  phpPresenterLinkCompletionSuggestions,
  providePhpPresenterLinkDefinition,
  type PhpPresenterLinkMonacoProviderContext,
} from "./nettePhpLinkMonacoProviders";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export interface PhpFrameworkMonacoProviderContext
  extends PhpPresenterLinkMonacoProviderContext {
  isPhpFrameworkStringCompletionContext?(
    source: string,
    position: MonacoPosition,
  ): boolean;
  /**
   * Resolves and navigates to the target of a framework-owned PHP string
   * literal (`config`, `view`, `__`/`trans`, `env`, etc.) located at `offset`.
   *
   * Because the editor hosts a single Monaco model and opens files through its
   * own tab system, the callback performs the navigation itself and resolves
   * `true` when it handled the request. The definition provider then returns
   * `null` so Monaco does not also attempt to navigate to a potentially
   * not-yet-open model.
   */
  providePhpFrameworkDefinition?(
    source: string,
    offset: number,
  ): Promise<boolean>;
  /**
   * @deprecated Use {@link providePhpFrameworkDefinition}. Kept as a narrow
   * compatibility alias for callers still named after the original Laravel-only
   * callback.
   */
  providePhpLaravelDefinition?(source: string, offset: number): Promise<boolean>;
}

export async function providePhpFrameworkDefinitionBeforeLsp(
  context: PhpFrameworkMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<boolean> {
  if (
    presenterLinkDefinitionProvider(context) &&
    (await providePhpPresenterLinkDefinition(context, model, position))
  ) {
    return true;
  }

  if (!frameworkStringLiteralDefinitionProvider(context)) {
    return false;
  }

  return providePhpFrameworkStringLiteralDefinition(context, model, position);
}

export async function phpFrameworkCompletionSuggestions(
  monaco: MonacoApi,
  context: PhpFrameworkMonacoProviderContext,
  model: MonacoModel,
  source: string,
  position: MonacoPosition,
  range: Monaco.IRange,
  request: { rootPath: string; sessionId: number | null },
): Promise<Monaco.languages.CompletionItem[] | null> {
  return phpPresenterLinkCompletionSuggestions(
    monaco,
    context,
    model,
    source,
    position,
    range,
    request,
  );
}

export function phpFrameworkStringCompletionOwnsContext(
  context: PhpFrameworkMonacoProviderContext,
  source: string,
  position: MonacoPosition,
): boolean {
  return Boolean(context.isPhpFrameworkStringCompletionContext?.(source, position));
}

async function providePhpFrameworkStringLiteralDefinition(
  context: PhpFrameworkMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<boolean> {
  const provideDefinition = frameworkStringLiteralDefinitionProvider(context);

  if (!provideDefinition) {
    return false;
  }

  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return false;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);

  try {
    return await provideDefinition(source, offset);
  } catch (error) {
    if (isPhpDocumentContextActive(context, documentContext)) {
      context.reportError(error);
    }

    return false;
  }
}

function frameworkStringLiteralDefinitionProvider(
  context: PhpFrameworkMonacoProviderContext,
) {
  return context.providePhpFrameworkDefinition ?? context.providePhpLaravelDefinition;
}

function presenterLinkDefinitionProvider(
  context: PhpFrameworkMonacoProviderContext,
) {
  return (
    context.providePhpPresenterLinkDefinition ??
    context.provideNettePhpLinkDefinition
  );
}
