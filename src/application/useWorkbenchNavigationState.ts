import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { useNavigationHistoryLifecycle } from "./useNavigationHistoryLifecycle";
import type {
  EditorPosition,
  EditorRevealTarget,
} from "../domain/languageServerFeatures";
import type { NavigationHistory } from "../domain/navigation";
import type { RecentFileEntry } from "../domain/recentFiles";
import type { RecentLocation } from "../domain/recentLocations";
import type { EditorDocument } from "../domain/workspace";

export interface WorkbenchNavigationState {
  activeEditorPosition: EditorPosition | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
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
  activeDocument: EditorDocument | null;
}

export function useWorkbenchNavigationState({
  activeDocument,
}: UseWorkbenchNavigationStateOptions): WorkbenchNavigationState {
  const [editorRevealTarget, setEditorRevealTarget] =
    useState<EditorRevealTarget | null>(null);
  const {
    navigationHistory,
    resetHistory,
    restoreHistory,
    setNavigationHistory,
  } = useNavigationHistoryLifecycle();
  const activeEditorPositionRef = useRef<EditorPosition | null>(null);
  const [activeEditorPosition, setActiveEditorPosition] =
    useState<EditorPosition | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [recentFilesSwitcherOpen, setRecentFilesSwitcherOpen] = useState(false);
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
  const [recentLocationsPanelOpen, setRecentLocationsPanelOpen] =
    useState(false);

  const resetActiveEditorPosition = useCallback(() => {
    activeEditorPositionRef.current = null;
    setActiveEditorPosition(null);
  }, []);

  const updateActiveEditorPosition = useCallback((position: EditorPosition) => {
    activeEditorPositionRef.current = position;
    setActiveEditorPosition((current) =>
      current &&
      current.lineNumber === position.lineNumber &&
      current.column === position.column
        ? current
        : position,
    );
  }, []);

  // Drop the rendered caret indicator when no document is active (last tab
  // closed). A new/switched tab repopulates it through the editor cursor event.
  useEffect(() => {
    if (activeDocument) {
      return;
    }

    resetActiveEditorPosition();
  }, [activeDocument, resetActiveEditorPosition]);

  return {
    activeEditorPosition,
    activeEditorPositionRef,
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
  };
}
