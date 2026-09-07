import { useCallback, useSyncExternalStore } from "react";
import {
  getEditorDocumentDirtySnapshot,
  subscribeEditorOwnerDirtyCountProjection,
  type EditorDocumentDirtyProjection,
  type EditorOwnerDirtyCountProjection,
} from "./editorSessionDirtyProjection";

export function useAgentCheckoutDirtyRevision(
  documents: readonly { readonly path: string }[] | undefined,
  resolve: ((path: string) => EditorDocumentDirtyProjection | null) | undefined,
  owner: EditorOwnerDirtyCountProjection | null,
): string {
  const subscribe = useCallback(
    (listener: () => void) => subscribeEditorOwnerDirtyCountProjection(owner, listener),
    [owner],
  );
  const snapshot = useCallback(() => {
    if (!documents || !resolve) return "";
    return documents
      .slice(0, 256)
      .map(({ path }) => {
        const projection = resolve(path);
        if (!projection) return "-";
        const state = getEditorDocumentDirtySnapshot(projection);
        if (state.status === "unavailable") return "?";
        return state.dirty ? "1" : "0";
      })
      .join("");
  }, [documents, resolve]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
