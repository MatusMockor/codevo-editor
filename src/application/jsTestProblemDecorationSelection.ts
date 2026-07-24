import {
  jsTestProblemLineDecorations,
  type JsTestProblemLineDecoration,
} from "../domain/jsTestProblemDecorations";
import type { JsTestExplorerCurrentFileIdentity } from "../domain/jsTestExplorerFilter";
import {
  jsTestProblemsOwnersEqual,
  validatedJsTestProblemsOwner,
  type JsTestProblemEntry,
  type JsTestProblemsSnapshot,
} from "../domain/jsTestProblems";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { parseWorkspacePath } from "../domain/workspacePath";

export interface ActiveJsTestProblemDecorationSelection {
  readonly activeDocument: EditorDocument | null;
  readonly currentFileIdentity: JsTestExplorerCurrentFileIdentity | null;
  readonly snapshot: JsTestProblemsSnapshot | null;
}

const EMPTY_DECORATIONS: readonly JsTestProblemLineDecoration[] = Object.freeze([]);
const SUPPORTED_LANGUAGES = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
]);

/**
 * Admits an immutable test-problem projection only for the exact clean active document and
 * workspace owner. Monaco/model concerns deliberately remain in the component adapter.
 */
export function selectJsTestProblemDecorations({
  activeDocument,
  currentFileIdentity,
  snapshot,
}: ActiveJsTestProblemDecorationSelection): readonly JsTestProblemLineDecoration[] {
  if (
    !validActiveDocument(activeDocument) ||
    !validCurrentFileIdentity(currentFileIdentity, activeDocument.path) ||
    !validSnapshot(snapshot) ||
    isDirty(activeDocument) ||
    !ownersMatch(snapshot, currentFileIdentity)
  ) {
    return EMPTY_DECORATIONS;
  }

  try {
    return immutableDecorations(jsTestProblemLineDecorations(snapshot, currentFileIdentity));
  } catch {
    return EMPTY_DECORATIONS;
  }
}

function validActiveDocument(document: EditorDocument | null): document is EditorDocument {
  return Boolean(
    document &&
    typeof document.path === "string" &&
    document.path.length > 0 &&
    typeof document.content === "string" &&
    typeof document.savedContent === "string" &&
    typeof document.language === "string" &&
    SUPPORTED_LANGUAGES.has(document.language),
  );
}

function validCurrentFileIdentity(
  identity: JsTestExplorerCurrentFileIdentity | null,
  activeDocumentPath: string,
): identity is JsTestExplorerCurrentFileIdentity {
  if (
    !identity ||
    typeof identity !== "object" ||
    typeof identity.pathKey !== "string" ||
    typeof identity.relativeFilePath !== "string" ||
    !identity.root ||
    typeof identity.root !== "object"
  ) {
    return false;
  }

  try {
    const activePath = parseWorkspacePath(identity.root, activeDocumentPath);
    return activePath.ok && activePath.value.key === identity.pathKey;
  } catch {
    return false;
  }
}

function validSnapshot(
  snapshot: JsTestProblemsSnapshot | null,
): snapshot is JsTestProblemsSnapshot {
  return Boolean(
    snapshot &&
    typeof snapshot === "object" &&
    Number.isSafeInteger(snapshot.generation) &&
    snapshot.generation >= 0 &&
    Array.isArray(snapshot.entries) &&
    snapshot.entries.every(validSnapshotEntry) &&
    Number.isSafeInteger(snapshot.total) &&
    snapshot.total >= snapshot.entries.length &&
    typeof snapshot.truncated === "boolean" &&
    (snapshot.generation > 0 || (snapshot.entries.length === 0 && snapshot.total === 0)) &&
    (snapshot.truncated || snapshot.total === snapshot.entries.length) &&
    snapshot.owner &&
    typeof snapshot.owner === "object",
  );
}

function validSnapshotEntry(entry: JsTestProblemEntry): boolean {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    typeof entry.filePath === "string" &&
    Number.isSafeInteger(entry.lineNumber) &&
    entry.lineNumber > 0 &&
    typeof entry.message === "string" &&
    (entry.name === null || typeof entry.name === "string") &&
    (entry.status === "error" || entry.status === "failed"),
  );
}

function ownersMatch(
  snapshot: JsTestProblemsSnapshot,
  identity: JsTestExplorerCurrentFileIdentity,
): boolean {
  try {
    const snapshotOwner = validatedJsTestProblemsOwner(snapshot.owner);
    if (
      snapshotOwner.workspaceId !== snapshot.owner.workspaceId ||
      snapshotOwner.rootKey !== snapshot.owner.rootKey
    ) {
      return false;
    }
    const documentOwner = validatedJsTestProblemsOwner({
      rootKey: identity.root.nativePath,
      workspaceId: identity.root.workspaceId,
    });
    return jsTestProblemsOwnersEqual(snapshotOwner, documentOwner);
  } catch {
    return false;
  }
}

function immutableDecorations(
  decorations: readonly JsTestProblemLineDecoration[],
): readonly JsTestProblemLineDecoration[] {
  if (!Array.isArray(decorations) || decorations.length === 0) return EMPTY_DECORATIONS;
  const immutable: JsTestProblemLineDecoration[] = [];
  for (const decoration of decorations) {
    if (
      !decoration ||
      typeof decoration !== "object" ||
      !Number.isSafeInteger(decoration.lineNumber) ||
      decoration.lineNumber <= 0 ||
      !Array.isArray(decoration.entries) ||
      decoration.entries.length === 0
    ) {
      return EMPTY_DECORATIONS;
    }
    immutable.push(
      Object.freeze({
        lineNumber: decoration.lineNumber,
        entries: Object.freeze([...decoration.entries]),
      }),
    );
  }
  return Object.freeze(immutable);
}
