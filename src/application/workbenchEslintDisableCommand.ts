import {
  supportsEslintLineComment,
  type RetainedEslintDiagnostic,
} from "../domain/eslintDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export type EditorSurfaceEslintDisableRunner = (
  expectedContent: string,
  lineNumber: number,
  identifiers: string[],
) => number | null;

export function runEslintDisableAtCursor({
  currentRoot,
  requestedRoot,
  document,
  lineNumber,
  diagnostics,
  runner,
  setMessage,
  workspaceTrusted,
}: {
  currentRoot: string | null;
  requestedRoot: string | null;
  document: EditorDocument | null;
  lineNumber: number;
  diagnostics: readonly RetainedEslintDiagnostic[];
  runner: EditorSurfaceEslintDisableRunner | null;
  setMessage(message: string): void;
  workspaceTrusted: boolean;
}): number | null {
  if (!requestedRoot || !document || document.readOnly || !workspaceTrusted) {
    return null;
  }

  if (!supportsEslintLineComment(document.language)) {
    return null;
  }

  if (!workspaceRootKeysEqual(currentRoot, requestedRoot)) {
    return null;
  }

  if (document.content !== document.savedContent || !runner) {
    return null;
  }

  const identifiers = [
    ...new Set(
      diagnostics
        .filter((diagnostic) => diagnostic.line === lineNumber)
        .map((diagnostic) => diagnostic.identifier),
    ),
  ];

  if (identifiers.length === 0) {
    return null;
  }

  const appliedCount = runner(document.content, lineNumber, identifiers);

  if (!appliedCount) {
    return appliedCount;
  }

  const noun = appliedCount === 1 ? "rule" : "rules";
  setMessage(
    `ESLint: Disabled ${appliedCount} ${noun} (${identifiers.join(", ")})`,
  );
  return appliedCount;
}
