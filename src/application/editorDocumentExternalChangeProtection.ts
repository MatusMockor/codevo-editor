import {
  getEditorDocumentDirtySnapshot,
  type EditorDocumentDirtyProjection,
} from "./editorSessionDirtyProjection";

export type ResolveEditorDocumentDirtyProjection = (
  path: string,
) => EditorDocumentDirtyProjection | null;

export function editorDocumentExternalChangeProtection(
  projection: EditorDocumentDirtyProjection | null,
): string | null {
  if (projection === null) return null;
  const snapshot = getEditorDocumentDirtySnapshot(projection);
  if (snapshot.status === "unavailable")
    return "The file changed on disk, but its editor state could not be checked. The open buffer was kept.";
  if (snapshot.dirty)
    return "The file changed on disk. Your unsaved editor changes were kept. Save or close the file before reloading it.";
  return null;
}
