import type * as Monaco from "monaco-editor";
import type { NavigationRequest } from "../application/navigationRequest";
import type { PhpCodeActionRange } from "../application/phpCodeActionTypes";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { TemplateLanguageMonacoProviderContext } from "./templateLanguageMonacoTypes";
import {
  modelMatchesWorkspacePath,
} from "./phpMonacoDocumentContext";

type MonacoModel = Monaco.editor.ITextModel;
type MonacoPosition = Monaco.Position;

export function activeTemplateDocumentContext(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  language: "blade" | "latte" | "neon",
) {
  const activeDocument = context.getActiveDocument();
  const rootPath = context.getWorkspaceRoot?.() ?? null;

  if (!activeDocument || !rootPath) {
    return null;
  }

  if (activeDocument.language !== language) {
    return null;
  }

  if (!modelMatchesWorkspacePath(model, rootPath, activeDocument.path)) {
    return null;
  }

  const path = activeDocument.path;

  return { activeDocument, path, rootPath };
}

export function codeActionOffsetRange(
  source: string,
  range: Monaco.Range,
): PhpCodeActionRange {
  const start = offsetAtMonacoPosition(source, {
    column: range.startColumn,
    lineNumber: range.startLineNumber,
  } as MonacoPosition);
  const end = offsetAtMonacoPosition(source, {
    column: range.endColumn,
    lineNumber: range.endLineNumber,
  } as MonacoPosition);

  return start <= end ? { end, start } : { end: start, start: end };
}

export function isStoredWorkspaceRootActive(
  context: TemplateLanguageMonacoProviderContext,
  rootPath: string,
): boolean {
  const activeRootPath = context.getWorkspaceRoot?.() ?? null;

  return Boolean(activeRootPath && workspaceRootKeysEqual(activeRootPath, rootPath));
}

export function templateDefinitionNavigationRequest(
  context: TemplateLanguageMonacoProviderContext,
  model: MonacoModel,
  rootPath: string,
  path: string,
): NavigationRequest {
  const version = modelVersion(model);

  return {
    canNavigate: () => {
      const activeDocument = context.getActiveDocument();

      if (activeDocument?.path !== path) {
        return false;
      }

      if (!isStoredWorkspaceRootActive(context, rootPath)) {
        return false;
      }

      if (!modelMatchesWorkspacePath(model, rootPath, path)) {
        return false;
      }

      return modelVersion(model) === version;
    },
  };
}

export function modelSource(model: MonacoModel, fallbackSource: string): string {
  try {
    return model.getValue();
  } catch {
    return fallbackSource;
  }
}

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

export function templateCompletionFallbackRange(
  position: MonacoPosition,
  word: { endColumn: number; startColumn: number },
): Monaco.IRange {
  return {
    endColumn: word.endColumn,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    startLineNumber: position.lineNumber,
  };
}

export function templateReplaceRange(
  monaco: typeof Monaco,
  model: MonacoModel,
  source: string,
  startOffset: number,
  endOffset: number,
): Monaco.IRange {
  const start = monacoPositionAtOffset(model, source, startOffset);
  const end = monacoPositionAtOffset(model, source, endOffset);

  return new monaco.Range(
    start.lineNumber,
    start.column,
    end.lineNumber,
    end.column,
  );
}

function modelVersion(model: MonacoModel): number | null {
  const versionProvider = (
    model as MonacoModel & {
      getVersionId?: () => number;
    }
  ).getVersionId;

  return versionProvider?.() ?? null;
}

function monacoPositionAtOffset(
  model: MonacoModel,
  source: string,
  offset: number,
): { column: number; lineNumber: number } {
  const positionAt = (
    model as MonacoModel & {
      getPositionAt?: (value: number) => MonacoPosition;
    }
  ).getPositionAt;

  if (typeof positionAt === "function") {
    const position = positionAt.call(model, offset);

    return { column: position.column, lineNumber: position.lineNumber };
  }

  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber };
}
