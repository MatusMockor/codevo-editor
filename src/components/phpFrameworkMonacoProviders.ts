import type * as Monaco from "monaco-editor";
import type { NavigationRequest } from "../application/navigationRequest";
import {
  activePhpDocumentContext,
  isPhpDocumentContextActive,
  modelPath,
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
    request?: NavigationRequest,
  ): Promise<boolean>;
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
  context: PhpFrameworkMonacoProviderContext,
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

function frameworkStringLiteralDefinitionProvider(
  context: PhpFrameworkMonacoProviderContext,
) {
  return context.providePhpFrameworkDefinition;
}

function presenterLinkDefinitionProvider(
  context: PhpFrameworkMonacoProviderContext,
) {
  return (
    context.providePhpPresenterLinkDefinition ??
    context.provideNettePhpLinkDefinition
  );
}
