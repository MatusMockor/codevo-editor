import { useCallback, useEffect, useRef } from "react";
import type { AgentWorkbenchLayoutAction } from "../../domain/agentWorkbenchLayout";
import type { EditorDrawerView } from "../../domain/editorDrawer";

export function useEditorSurfaceReveal(
  dispatch: (action: AgentWorkbenchLayoutAction) => void,
): () => void {
  const dispatchRef = useRef(dispatch);
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);
  return useCallback(() => {
    dispatchRef.current({ kind: "openSurface", surface: "editor" });
  }, []);
}

export interface EditorDrawerRevealInput {
  readonly ownerKey: string | null;
  readonly drawerView: EditorDrawerView | null;
  reveal(): void;
}

interface ObservedDrawer {
  readonly ownerKey: string | null;
  readonly open: boolean;
}

export function useEditorDrawerReveal({
  drawerView,
  ownerKey,
  reveal,
}: EditorDrawerRevealInput): void {
  const observedRef = useRef<ObservedDrawer | null>(null);
  const revealRef = useRef(reveal);
  useEffect(() => {
    revealRef.current = reveal;
  }, [reveal]);
  const open = drawerView !== null;
  useEffect(() => {
    const previous = observedRef.current;
    observedRef.current = { ownerKey, open };
    if (previous === null || previous.ownerKey !== ownerKey) return;
    if (previous.open || !open) return;
    revealRef.current();
  }, [open, ownerKey]);
}
