import type * as Monaco from "monaco-editor";
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocument,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export interface PhpMonacoDocumentContextProvider {
  getActiveDocument(): EditorDocument | null;
  getRuntimeStatus(): LanguageServerRuntimeStatus | null;
  getWorkspaceRoot?(): string | null;
}

export interface PhpMonacoDocumentContext {
  activeDocument: EditorDocument;
  path: string;
  rootPath: string;
  sessionId: number | null;
}

export function activePhpDocumentContext(
  context: PhpMonacoDocumentContextProvider,
  model: MonacoModel,
): PhpMonacoDocumentContext | null {
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

export function modelSource(model: MonacoModel, fallbackSource: string): string {
  try {
    return model.getValue();
  } catch {
    return fallbackSource;
  }
}

export function isLargeActivePhpDocument(
  context: PhpMonacoDocumentContextProvider,
  model: MonacoModel,
  policy: LargeSmartDocumentPolicy = defaultLargeSmartDocumentPolicy,
): boolean {
  const documentContext = activePhpDocumentContext(context, model);

  return Boolean(
    documentContext &&
      isLargeSmartDocument(documentContext.activeDocument, policy),
  );
}

/**
 * Converts a 1-based Monaco position into a 0-based character offset into
 * `source`. Lines beyond the source resolve to its end; columns beyond a line
 * clamp to that line's end.
 */
export function offsetAtMonacoPosition(
  source: string,
  position: MonacoPosition,
): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);
  let offset = 0;

  for (let line = 0; line < targetLine && line < lines.length; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  if (targetLine >= lines.length) {
    return source.length;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}

export function isPhpDocumentContextActive(
  context: PhpMonacoDocumentContextProvider,
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

export function isStoredLanguageServerPayloadActive(
  context: PhpMonacoDocumentContextProvider,
  rootPath: string,
  sessionId: number,
): boolean {
  if (!isStoredWorkspaceRootActive(context, rootPath)) {
    return false;
  }

  return runningRuntimeSessionIdForRoot(context, rootPath) === sessionId;
}

export function isStoredWorkspaceRootActive(
  context: Pick<PhpMonacoDocumentContextProvider, "getWorkspaceRoot">,
  rootPath: string,
): boolean {
  const activeRootPath = context.getWorkspaceRoot?.() ?? null;

  return Boolean(activeRootPath && workspaceRootKeysEqual(activeRootPath, rootPath));
}

export function runningRuntimeSessionIdForRoot(
  context: Pick<PhpMonacoDocumentContextProvider, "getRuntimeStatus">,
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

export function modelPath(model: MonacoModel): string | null {
  const uri = model.uri;

  if (uri.fsPath) {
    return uri.fsPath;
  }

  if (uri.path) {
    return decodeURIComponent(uri.path);
  }

  return null;
}
