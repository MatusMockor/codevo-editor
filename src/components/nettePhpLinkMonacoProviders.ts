import type * as Monaco from "monaco-editor";
import type { PhpPresenterLinkMonacoProviderContext } from "./phpPresenterLinkMonacoProviders";
import {
  phpPresenterLinkCompletionSuggestions,
  providePhpPresenterLinkDefinition,
} from "./phpPresenterLinkMonacoProviders";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export type { PhpPresenterLinkMonacoProviderContext };
export {
  phpPresenterLinkCompletionSuggestions,
  providePhpPresenterLinkDefinition,
} from "./phpPresenterLinkMonacoProviders";

/**
 * @deprecated Use {@link PhpPresenterLinkMonacoProviderContext}.
 */
export type NettePhpLinkMonacoProviderContext =
  PhpPresenterLinkMonacoProviderContext;

/**
 * @deprecated Use {@link providePhpPresenterLinkDefinition}.
 */
export async function provideNettePhpPresenterLinkDefinition(
  context: PhpPresenterLinkMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<boolean> {
  return providePhpPresenterLinkDefinition(context, model, position);
}

/**
 * @deprecated Use {@link phpPresenterLinkCompletionSuggestions}.
 */
export async function phpNettePresenterLinkCompletionSuggestions(
  monaco: MonacoApi,
  context: PhpPresenterLinkMonacoProviderContext,
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
