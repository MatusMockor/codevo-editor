import { useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { editor } from "monaco-editor";
import type { EditorCursorStorePort } from "../application/editorCursorStore";
import type { EditorSessionOwnerKey } from "../domain/editorSessionOwnerKey";
import type { EditorGroupId } from "../domain/editorGroups";
import type { EditorPosition } from "../domain/languageServerFeatures";

interface UseEditorCursorPublicationOptions {
  readonly activeDocumentPath: string | null;
  readonly cursorStore: EditorCursorStorePort | null | undefined;
  readonly editorApi: editor.IStandaloneCodeEditor | null;
  readonly groupId: EditorGroupId | null;
  readonly onPositionRef: RefObject<(position: EditorPosition) => void>;
  readonly ownerKey: EditorSessionOwnerKey | null;
  readonly setLegacyPosition: Dispatch<SetStateAction<EditorPosition | null>>;
  readonly trackingActive: boolean;
}

export function useEditorCursorPublication({
  activeDocumentPath,
  cursorStore,
  editorApi,
  groupId,
  onPositionRef,
  ownerKey,
  setLegacyPosition,
  trackingActive,
}: UseEditorCursorPublicationOptions): void {
  useLayoutEffect(() => {
    if (!editorApi) return;
    const lease =
      cursorStore && trackingActive && ownerKey && groupId && activeDocumentPath
        ? cursorStore.activate({ documentPath: activeDocumentPath, groupId, ownerKey })
        : null;
    const publish = (position: EditorPosition) => {
      if (cursorStore === null) return;
      if (cursorStore && (!lease || !cursorStore.publish(lease, position))) return;
      onPositionRef.current(position);
    };
    const accept = (position: EditorPosition) => {
      publish(position);
      if (cursorStore === undefined) {
        setLegacyPosition((previous) => (samePosition(previous, position) ? previous : position));
      }
    };
    const disposable = editorApi.onDidChangeCursorPosition((event) => accept(event.position));
    const position = editorApi.getPosition();
    if (position) accept(position);

    return () => {
      disposable.dispose();
      if (lease) cursorStore?.deactivate(lease);
    };
  }, [
    activeDocumentPath,
    cursorStore,
    editorApi,
    groupId,
    onPositionRef,
    ownerKey,
    setLegacyPosition,
    trackingActive,
  ]);
}

function samePosition(previous: EditorPosition | null, next: EditorPosition): boolean {
  return previous?.lineNumber === next.lineNumber && previous.column === next.column;
}
