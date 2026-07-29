import type { EditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorGroupId } from "../domain/editorGroups";
import type { EditorCursorAuthority } from "./editorCursorStore";

export function editorCursorAuthority(
  ownerKey: EditorSessionOwnerKey | null,
  groupId: EditorGroupId,
  documentPath: string | null,
): EditorCursorAuthority | null {
  return ownerKey && documentPath ? { documentPath, groupId, ownerKey } : null;
}

export function cursorSnapshotMatchesAuthority(
  snapshot: { readonly authority: EditorCursorAuthority },
  authority: EditorCursorAuthority,
): boolean {
  return (
    snapshot.authority.ownerKey === authority.ownerKey &&
    snapshot.authority.groupId === authority.groupId &&
    snapshot.authority.documentPath === authority.documentPath
  );
}
