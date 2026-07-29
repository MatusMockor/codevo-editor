import type { EditorPosition } from "../domain/languageServerFeatures";
import type { EditorCursorLease, EditorCursorStorePort } from "./editorCursorStore";

export interface EditorCursorPositionRef {
  readonly current: Readonly<EditorPosition> | null;
}

/**
 * Preserves the imperative position-ref contract used by navigation commands
 * without mirroring the cursor stream into React state. It is deliberately
 * read-only because an unscoped setter cannot retain pre-await authority.
 */
export function createEditorCursorPositionRef(
  store: EditorCursorStorePort,
): EditorCursorPositionRef {
  const target = {} as EditorCursorPositionRef;
  Object.defineProperty(target, "current", {
    configurable: false,
    enumerable: true,
    get: () => {
      const snapshot = store.getActiveSnapshot();
      return snapshot.status === "available" ? snapshot.position : null;
    },
  });
  return target;
}

export function bindEditorCursorPublisher(
  store: EditorCursorStorePort,
  lease: EditorCursorLease,
): (position: EditorPosition) => void {
  return (position) => {
    store.publish(lease, position);
  };
}
