import { useCallback, useSyncExternalStore } from "react";
import {
  getEditorDocumentDirtySnapshot,
  getEditorOwnerDirtyCountSnapshot,
  subscribeEditorDocumentDirtyProjection,
  subscribeEditorOwnerDirtyCountProjection,
  type EditorDocumentDirtyProjection,
  type EditorDocumentDirtySnapshot,
  type EditorOwnerDirtyCountProjection,
  type EditorOwnerDirtyCountSnapshot,
} from "./editorSessionDirtyProjection";

export function useEditorDocumentDirtySnapshot(
  projection: EditorDocumentDirtyProjection | null,
): EditorDocumentDirtySnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeEditorDocumentDirtyProjection(projection, listener),
    [projection],
  );
  const getSnapshot = useCallback(() => getEditorDocumentDirtySnapshot(projection), [projection]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useEditorOwnerDirtyCountSnapshot(
  projection: EditorOwnerDirtyCountProjection | null,
): EditorOwnerDirtyCountSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => subscribeEditorOwnerDirtyCountProjection(projection, listener),
    [projection],
  );
  const getSnapshot = useCallback(() => getEditorOwnerDirtyCountSnapshot(projection), [projection]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
