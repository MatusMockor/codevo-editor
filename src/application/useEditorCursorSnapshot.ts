import { useCallback, useSyncExternalStore } from "react";
import type {
  EditorCursorLease,
  EditorCursorSnapshot,
  EditorCursorStorePort,
} from "./editorCursorStore";
import { UNAVAILABLE_EDITOR_CURSOR_SNAPSHOT } from "./editorCursorStore";

export function useActiveEditorCursorSnapshot(
  store: EditorCursorStorePort,
  enabled = true,
): EditorCursorSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? store.subscribeActive(listener) : () => {}),
    [enabled, store],
  );
  const getSnapshot = useCallback(
    () => (enabled ? store.getActiveSnapshot() : UNAVAILABLE_EDITOR_CURSOR_SNAPSHOT),
    [enabled, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useEditorGroupCursorSnapshot(
  store: EditorCursorStorePort,
  lease: EditorCursorLease | null,
  enabled = true,
): EditorCursorSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => (enabled && lease ? store.subscribeGroup(lease, listener) : () => {}),
    [enabled, lease, store],
  );
  const getSnapshot = useCallback(
    () => (enabled && lease ? store.getSnapshot(lease) : UNAVAILABLE_EDITOR_CURSOR_SNAPSHOT),
    [enabled, lease, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
