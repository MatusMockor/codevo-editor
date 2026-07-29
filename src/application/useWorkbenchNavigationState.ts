import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigationHistoryLifecycle } from "./useNavigationHistoryLifecycle";
import type { EditorPosition, EditorRevealTarget } from "../domain/languageServerFeatures";
import type { NavigationHistory } from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import {
  createEditorCursorPositionRef,
  type EditorCursorPositionRef,
} from "./editorCursorBindings";
import type { EditorCursorStorePort } from "./editorCursorStore";

export interface WorkbenchNavigationState {
  readonly activeEditorPosition: EditorPosition | null;
  activeEditorPositionRef: EditorCursorPositionRef;
  clearEditorRevealTarget: (handledTarget?: EditorRevealTarget) => void;
  editorRevealTarget: EditorRevealTarget | null;
  navigationHistory: NavigationHistory;
  recentFiles: RecentFileEntry[];
  recentFilesSwitcherOpen: boolean;
  recentLocations: RecentLocation[];
  recentLocationsPanelOpen: boolean;
  resetActiveEditorPosition: () => void;
  resetHistory: () => void;
  restoreHistory: (history: NavigationHistory) => void;
  setEditorRevealTarget: Dispatch<SetStateAction<EditorRevealTarget | null>>;
  setNavigationHistory: Dispatch<SetStateAction<NavigationHistory>>;
  setRecentFiles: Dispatch<SetStateAction<RecentFileEntry[]>>;
  setRecentFilesSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  setRecentLocations: Dispatch<SetStateAction<RecentLocation[]>>;
  setRecentLocationsPanelOpen: Dispatch<SetStateAction<boolean>>;
  updateActiveEditorPosition: (position: EditorPosition) => void;
}

interface UseWorkbenchNavigationStateOptions {
  cursorStore: EditorCursorStorePort;
}

export function useWorkbenchNavigationState({
  cursorStore,
}: UseWorkbenchNavigationStateOptions): WorkbenchNavigationState {
  const [editorRevealTarget, setEditorRevealTarget] = useState<EditorRevealTarget | null>(null);
  const { navigationHistory, resetHistory, restoreHistory, setNavigationHistory } =
    useNavigationHistoryLifecycle();
  const [activeEditorPositionRef] = useState(() => createEditorCursorPositionRef(cursorStore));
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [recentFilesSwitcherOpen, setRecentFilesSwitcherOpen] = useState(false);
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
  const [recentLocationsPanelOpen, setRecentLocationsPanelOpen] = useState(false);

  const resetActiveEditorPosition = useCallback(() => {
    const snapshot = cursorStore.getActiveSnapshot();
    if (snapshot.status === "available") cursorStore.deactivate(snapshot.authority);
  }, [cursorStore]);

  const updateActiveEditorPosition = useCallback(
    (position: EditorPosition) => {
      const snapshot = cursorStore.getActiveSnapshot();
      if (snapshot.status === "available") cursorStore.publish(snapshot.authority, position);
    },
    [cursorStore],
  );

  const clearEditorRevealTarget = useCallback((handledTarget?: EditorRevealTarget) => {
    setEditorRevealTarget((current) => {
      if (handledTarget && current !== handledTarget) {
        return current;
      }

      return null;
    });
  }, []);

  return Object.defineProperty(
    {
      activeEditorPosition: null,
      activeEditorPositionRef,
      clearEditorRevealTarget,
      editorRevealTarget,
      navigationHistory,
      recentFiles,
      recentFilesSwitcherOpen,
      recentLocations,
      recentLocationsPanelOpen,
      resetActiveEditorPosition,
      resetHistory,
      restoreHistory,
      setEditorRevealTarget,
      setNavigationHistory,
      setRecentFiles,
      setRecentFilesSwitcherOpen,
      setRecentLocations,
      setRecentLocationsPanelOpen,
      updateActiveEditorPosition,
    },
    "activeEditorPosition",
    {
      enumerable: true,
      get: () => activeEditorPositionRef.current,
    },
  );
}
