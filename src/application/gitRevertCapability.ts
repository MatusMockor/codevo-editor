import type { GitChangedFile } from "../domain/git";
import { isDirty, type EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export function canRevertGitChangeForDocuments(
  change: GitChangedFile,
  documents: Readonly<Record<string, EditorDocument>>,
): boolean {
  const directDocument = documents[change.path];
  if (directDocument) {
    return !isDirty(directDocument);
  }

  const matchingDocument = Object.values(documents).find((document) =>
    workspaceRootKeysEqual(document.path, change.path),
  );
  return !matchingDocument || !isDirty(matchingDocument);
}
