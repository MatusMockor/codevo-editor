import type * as Monaco from "monaco-editor";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "../../application/phpCodeActionTypes";
import type { LanguageServerCodeAction } from "../../domain/languageServerFeatures";
import { offsetAtMonacoPosition } from "../phpMonacoDocumentContext";
import type { LanguageServerMonacoProviderContext } from "./languageServerProviderContext";

type MonacoPosition = Monaco.Position;

export function phpSourceCodeActionKindRequested(only: string | undefined): boolean {
  if (!only) {
    return true;
  }

  return (
    only.startsWith("quickfix") ||
    only.startsWith("refactor") ||
    phpOrganizeImportsKindRequested(only)
  );
}

function phpOrganizeImportsKindRequested(only: string): boolean {
  return (
    only === "source" ||
    only === "source.organizeImports" ||
    only.startsWith("source.organizeImports.")
  );
}

export function phpCodeActionOffsetRange(source: string, range: Monaco.Range): PhpCodeActionRange {
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

export function canApplyPhpWorkspaceEditDescriptor(
  context: LanguageServerMonacoProviderContext,
  descriptor: PhpCodeActionDescriptor,
): boolean {
  if (!descriptor.workspaceEdit) {
    return true;
  }

  return Boolean(
    context.applyWorkspaceEdit &&
    (descriptor.workspaceRoot ?? context.getWorkspaceRoot?.() ?? null),
  );
}

export function isLanguageServerActionAlreadyResolved(action: LanguageServerCodeAction): boolean {
  return Boolean(action.edit) || Boolean(action.command);
}

export function isUnsupportedCodeActionResolveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  return /codeAction\/resolve.*not found|not found.*codeAction\/resolve/i.test(message);
}
