import type * as Monaco from "monaco-editor";
import { nettePresenterLinkCompletionContextAt } from "../domain/latteLinkNavigation";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import {
  activePhpDocumentContext,
  isPhpDocumentContextActive,
  modelSource,
  offsetAtMonacoPosition,
} from "./phpMonacoDocumentContext";
import {
  toMonacoLatteCompletion,
  type LatteCompletion,
} from "./templateLanguageMonacoProviders";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export interface PhpPresenterLinkMonacoProviderContext {
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
  providePhpPresenterLinkDefinition?(
    source: string,
    offset: number,
  ): Promise<boolean>;
  providePhpPresenterLinkCompletions?(
    source: string,
    offset: number,
  ): Promise<LatteCompletion[] | null>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkDefinition}. Kept as a
   * temporary compatibility alias while Nette-specific callers migrate.
   */
  provideNettePhpLinkDefinition?(
    source: string,
    offset: number,
  ): Promise<boolean>;
  /**
   * @deprecated Use {@link providePhpPresenterLinkCompletions}. Kept as a
   * temporary compatibility alias while Nette-specific callers migrate.
   */
  provideNettePhpLinkCompletions?(
    source: string,
    offset: number,
  ): Promise<LatteCompletion[] | null>;
  reportError(error: unknown): void;
}

/**
 * @deprecated Use {@link PhpPresenterLinkMonacoProviderContext}.
 */
export type NettePhpLinkMonacoProviderContext =
  PhpPresenterLinkMonacoProviderContext;

/**
 * Attempts Nette presenter-link navigation (`$this->link('Presenter:action')`,
 * `->redirect(...)`, ...) for a PHP document, ahead of the Laravel string-literal
 * / phpactor resolvers. Returns `true` when the request was handled (the
 * controller opened the presenter at its action method), so the caller stops and
 * Monaco does not navigate. Inert outside a Nette semantic project (the
 * controller callback gates on the framework profile + tier). Per-project
 * isolation is enforced inside the controller callback and guarded here before
 * reporting errors.
 */
export async function providePhpPresenterLinkDefinition(
  context: PhpPresenterLinkMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<boolean> {
  const provideDefinition =
    context.providePhpPresenterLinkDefinition ??
    context.provideNettePhpLinkDefinition;

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
 * `$this->link('...')` / `->redirect(...)` / `->forward(...)` / ... presenter
 * link completion for a PHP document (Nette). The domain's pure
 * `nettePresenterLinkCompletionContextAt` check runs first (a single bounded
 * regex scan), so non-link PHP keystrokes never reach the controller. Returns
 * `null` when the cursor is not on a link target or the active framework is not
 * Nette; returns an array (possibly empty) when Nette owns the context.
 */
export async function phpPresenterLinkCompletionSuggestions(
  monaco: MonacoApi,
  context: PhpPresenterLinkMonacoProviderContext,
  model: MonacoModel,
  source: string,
  position: MonacoPosition,
  range: Monaco.IRange,
  request: { rootPath: string; sessionId: number | null },
): Promise<Monaco.languages.CompletionItem[] | null> {
  const offset = offsetAtMonacoPosition(source, position);
  const linkCompletionContext = nettePresenterLinkCompletionContextAt(
    source,
    offset,
    "php",
  );
  const provideCompletions =
    context.providePhpPresenterLinkCompletions ??
    context.provideNettePhpLinkCompletions;

  if (!linkCompletionContext || !provideCompletions) {
    return null;
  }

  try {
    const completions = await provideCompletions(source, offset);

    if (completions === null) {
      return null;
    }

    if (!isPhpDocumentContextActive(context, request)) {
      return [];
    }

    return completions.map((completion, index) =>
      toMonacoLatteCompletion(monaco, model, source, range, completion, index),
    );
  } catch (error) {
    if (isPhpDocumentContextActive(context, request)) {
      context.reportError(error);
    }

    return [];
  }
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
