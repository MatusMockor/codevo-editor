import type { DocumentSessionLiveCheckpoint } from "../domain/documentSession";
import type { EditorDocument } from "../domain/workspace";
import type { DocumentSessionOwnerInput } from "./documentSessionStorePort";

export function freezeDocument(document: EditorDocument): Readonly<EditorDocument> {
  return Object.freeze({
    ...document,
    revision:
      document.revision && typeof document.revision === "object"
        ? Object.freeze({ ...document.revision })
        : document.revision,
  });
}

export function estimatedDocumentBytes(document: Readonly<EditorDocument>): number {
  const revisionBytes = document.revision
    ? Object.values(document.revision).reduce((total, value) => total + String(value).length * 2, 0)
    : 0;
  return (
    (document.content.length +
      document.savedContent.length +
      document.path.length +
      document.name.length +
      document.language.length) *
      2 +
    revisionBytes
  );
}

export function freezeLiveCheckpoint(
  checkpoint: DocumentSessionLiveCheckpoint,
): DocumentSessionLiveCheckpoint {
  return Object.freeze({
    alternativeVersionId: checkpoint.alternativeVersionId,
    contentVersion: checkpoint.contentVersion,
    modelVersionId: checkpoint.modelVersionId,
    utf16Length: checkpoint.utf16Length,
  });
}

export function liveCheckpointsEqual(
  current: DocumentSessionLiveCheckpoint,
  candidate: DocumentSessionLiveCheckpoint,
): boolean {
  return (
    current.alternativeVersionId === candidate.alternativeVersionId &&
    current.contentVersion === candidate.contentVersion &&
    current.modelVersionId === candidate.modelVersionId &&
    current.utf16Length === candidate.utf16Length
  );
}

export function editorDocumentsEqual(
  current: Readonly<EditorDocument>,
  next: Readonly<EditorDocument>,
): boolean {
  return (
    current.path === next.path &&
    current.name === next.name &&
    current.language === next.language &&
    current.content === next.content &&
    current.savedContent === next.savedContent &&
    current.readOnly === next.readOnly &&
    workspaceFileRevisionsEqual(current.revision, next.revision)
  );
}

export function validOwnerInput(input: DocumentSessionOwnerInput): boolean {
  return (
    typeof input.ownerKey === "string" &&
    input.ownerKey.trim().length > 0 &&
    typeof input.canonicalRoot === "string" &&
    input.canonicalRoot.trim().length > 0 &&
    typeof input.rootPath === "string" &&
    input.rootPath.trim().length > 0
  );
}

export function workspaceFileRevisionsEqual(
  current: EditorDocument["revision"],
  next: EditorDocument["revision"],
): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  const currentEntries = Object.entries(current);
  const nextEntries = Object.entries(next);
  return (
    currentEntries.length === nextEntries.length &&
    currentEntries.every(([key, value]) => next[key as keyof typeof next] === value)
  );
}
