import type * as Monaco from "monaco-editor";
import type { NavigationRequest } from "../application/navigationRequest";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import {
  activePhpDocumentContext,
  isPhpDocumentContextActive,
  modelPath,
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
  isPhpPresenterLinkCompletionContext?(source: string, offset: number): boolean;
  providePhpPresenterLinkDefinition?(
    source: string,
    offset: number,
    request?: NavigationRequest,
  ): Promise<boolean>;
  providePhpPresenterLinkCompletions?(
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
  const provideDefinition = context.providePhpPresenterLinkDefinition;

  if (!provideDefinition) {
    return false;
  }

  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return false;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);
  const request = phpDefinitionNavigationRequest(context, model, documentContext);

  try {
    return await provideDefinition(source, offset, request);
  } catch (error) {
    if (isPhpDocumentContextActive(context, documentContext)) {
      context.reportError(error);
    }

    return false;
  }
}

function phpDefinitionNavigationRequest(
  context: PhpPresenterLinkMonacoProviderContext,
  model: MonacoModel,
  documentContext: {
    path: string;
    rootPath: string;
    sessionId: number | null;
  },
): NavigationRequest {
  return {
    canNavigate: () => {
      if (context.getActiveDocument()?.path !== documentContext.path) {
        return false;
      }

      if (modelPath(model) !== documentContext.path) {
        return false;
      }

      return isPhpDocumentContextActive(context, documentContext);
    },
  };
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
 * Presenter-link completion for a PHP document. A neutral framework-owned
 * preflight may cheaply reject non-link PHP keystrokes; when it is omitted, the
 * provider callback remains authoritative and can return `null` for inactive
 * contexts. Returns `null` when the cursor is not on a link target or the active
 * framework does not own presenter links; returns an array (possibly empty)
 * when the framework owns the context.
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
  const ownsCompletionContext =
    context.isPhpPresenterLinkCompletionContext?.(source, offset);
  const provideCompletions = context.providePhpPresenterLinkCompletions;

  if (ownsCompletionContext === false || !provideCompletions) {
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
