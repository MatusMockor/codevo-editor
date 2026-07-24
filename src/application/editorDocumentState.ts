import type { EditorDocument } from "../domain/workspace";

export function isCleanWritableDocument(document: EditorDocument | null): boolean {
  return document !== null && !document.readOnly && document.content === document.savedContent;
}
