import type * as Monaco from "monaco-editor";
import { nettePresenterLinkCompletionContextAt } from "../domain/latteLinkNavigation";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  toMonacoLatteCompletion,
  type LatteCompletion,
} from "./templateLanguageMonacoProviders";

type MonacoApi = typeof Monaco;
type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export interface NettePhpLinkMonacoProviderContext {
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
  provideNettePhpLinkDefinition?(
    source: string,
    offset: number,
  ): Promise<boolean>;
  provideNettePhpLinkCompletions?(
    source: string,
    offset: number,
  ): Promise<LatteCompletion[] | null>;
  reportError(error: unknown): void;
}

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
export async function provideNettePhpPresenterLinkDefinition(
  context: NettePhpLinkMonacoProviderContext,
  model: MonacoModel,
  position: MonacoPosition,
): Promise<boolean> {
  if (!context.provideNettePhpLinkDefinition) {
    return false;
  }

  const documentContext = activePhpDocumentContext(context, model);

  if (!documentContext) {
    return false;
  }

  const source = modelSource(model, documentContext.activeDocument.content);
  const offset = offsetAtMonacoPosition(source, position);

  try {
    return await context.provideNettePhpLinkDefinition(source, offset);
  } catch (error) {
    if (isPhpDocumentContextActive(context, documentContext)) {
      context.reportError(error);
    }

    return false;
  }
}

/**
 * `$this->link('...')` / `->redirect(...)` / `->forward(...)` / ... presenter
 * link completion for a PHP document (Nette). The domain's pure
 * `nettePresenterLinkCompletionContextAt` check runs first (a single bounded
 * regex scan), so non-link PHP keystrokes never reach the controller. Returns
 * `null` when the cursor is not on a link target or the active framework is not
 * Nette; returns an array (possibly empty) when Nette owns the context.
 */
export async function phpNettePresenterLinkCompletionSuggestions(
  monaco: MonacoApi,
  context: NettePhpLinkMonacoProviderContext,
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

  if (!linkCompletionContext || !context.provideNettePhpLinkCompletions) {
    return null;
  }

  try {
    const completions = await context.provideNettePhpLinkCompletions(
      source,
      offset,
    );

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

function activePhpDocumentContext(
  context: NettePhpLinkMonacoProviderContext,
  model: MonacoModel,
) {
  const activeDocument = context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!activeDocument || !rootPath) {
    return null;
  }

  if (activeDocument.language !== "php") {
    return null;
  }

  const path = modelPath(model);

  if (path !== activeDocument.path) {
    return null;
  }

  return {
    activeDocument,
    path,
    rootPath,
    sessionId: runningRuntimeSessionIdForRoot(context, rootPath),
  };
}

function modelSource(model: MonacoModel, fallbackSource: string): string {
  try {
    return model.getValue();
  } catch {
    return fallbackSource;
  }
}

function offsetAtMonacoPosition(source: string, position: MonacoPosition): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);
  let offset = 0;

  for (let index = 0; index < Math.min(targetLine, lines.length); index += 1) {
    offset += lines[index].length + 1;
  }

  if (targetLine >= lines.length) {
    return source.length;
  }

  return Math.min(offset + Math.max(0, position.column - 1), source.length);
}

function isPhpDocumentContextActive(
  context: NettePhpLinkMonacoProviderContext,
  request: { rootPath: string; sessionId: number | null },
): boolean {
  return request.sessionId == null
    ? isStoredWorkspaceRootActive(context, request.rootPath)
    : isStoredLanguageServerPayloadActive(
        context,
        request.rootPath,
        request.sessionId,
      );
}

function isStoredLanguageServerPayloadActive(
  context: NettePhpLinkMonacoProviderContext,
  rootPath: string,
  sessionId: number,
): boolean {
  if (!isStoredWorkspaceRootActive(context, rootPath)) {
    return false;
  }

  return runningRuntimeSessionIdForRoot(context, rootPath) === sessionId;
}

function isStoredWorkspaceRootActive(
  context: NettePhpLinkMonacoProviderContext,
  rootPath: string,
): boolean {
  const activeRootPath = context.getWorkspaceRoot?.() ?? null;

  return Boolean(activeRootPath && workspaceRootKeysEqual(activeRootPath, rootPath));
}

function runningRuntimeSessionIdForRoot(
  context: NettePhpLinkMonacoProviderContext,
  rootPath: string,
): number | null {
  const status = context.getRuntimeStatus();

  if (
    status?.kind === "running" &&
    Boolean(status.rootPath) &&
    workspaceRootKeysEqual(status.rootPath, rootPath)
  ) {
    return status.sessionId;
  }

  return null;
}

function modelPath(model: MonacoModel): string | null {
  const uri = model.uri;

  if (uri.fsPath) {
    return uri.fsPath;
  }

  if (uri.path) {
    return decodeURIComponent(uri.path);
  }

  return null;
}
