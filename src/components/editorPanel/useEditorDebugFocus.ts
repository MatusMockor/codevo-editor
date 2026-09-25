import { useEffect, useRef } from "react";
import type { AgentWorkbenchLayoutAction } from "../../domain/agentWorkbenchLayout";
import {
  editorDebugFocusReducer,
  initialEditorDebugFocusState,
  type EditorDebugFocusEffect,
  type EditorDebugFocusEvent,
  type EditorDebugFocusState,
} from "../../domain/editorDebugFocus";

export interface EditorDebugFocusInput {
  readonly ownerKey: string | null;
  readonly sessionId: number | null;
  readonly maximized: boolean;
  dispatch(action: AgentWorkbenchLayoutAction): void;
}

export function useEditorDebugFocus({
  dispatch,
  maximized,
  ownerKey,
  sessionId,
}: EditorDebugFocusInput): void {
  const stateRef = useRef<EditorDebugFocusState>(initialEditorDebugFocusState);
  const expectedMaximizedRef = useRef<boolean | null>(null);
  const lastMaximizedRef = useRef(maximized);
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  useEffect(() => {
    const apply = (event: EditorDebugFocusEvent): EditorDebugFocusEffect => {
      const step = editorDebugFocusReducer(stateRef.current, event);
      stateRef.current = step.state;
      return step.effect;
    };
    const previousOwner = stateRef.current.ownerKey;
    apply({ kind: "owner", ownerKey });
    if (previousOwner !== ownerKey) expectedMaximizedRef.current = null;
    if (maximized !== lastMaximizedRef.current) {
      lastMaximizedRef.current = maximized;
      if (expectedMaximizedRef.current === maximized) {
        expectedMaximizedRef.current = null;
      } else {
        apply({ kind: "layoutChanged" });
      }
    }
    const effect = apply({ kind: "session", sessionId, maximized });
    if (effect === "maximize") {
      expectedMaximizedRef.current = true;
      dispatchRef.current({ kind: "openSurface", surface: "editor" });
      dispatchRef.current({ kind: "maximizeRightPanel" });
      return;
    }
    if (effect === "restore" && maximized) {
      expectedMaximizedRef.current = false;
      dispatchRef.current({ kind: "toggleMaximized" });
    }
  }, [maximized, ownerKey, sessionId]);
}
