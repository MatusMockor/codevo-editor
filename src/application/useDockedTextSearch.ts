import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { BottomPanelView } from "../domain/bottomPanel";

export interface DockedTextSearchDependencies {
  bottomPanelViewRef: MutableRefObject<BottomPanelView>;
  bottomPanelVisible: boolean;
  setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
  setTextSearchOpen: Dispatch<SetStateAction<boolean>>;
  workspaceKey: string;
}

interface PreviousBottomPanel {
  view: Exclude<BottomPanelView, "search">;
  visible: boolean;
}

const MAX_REMEMBERED_BOTTOM_PANELS = 32;

export function useDockedTextSearchOpen({
  bottomPanelViewRef,
  bottomPanelVisible,
  setBottomPanelView,
  setBottomPanelVisible,
  setTextSearchOpen,
  workspaceKey,
}: DockedTextSearchDependencies): (open: boolean) => void {
  const previousBottomPanelByWorkspaceRef = useRef(new Map<string, PreviousBottomPanel>());

  return useCallback(
    (open: boolean) => {
      if (open) {
        if (bottomPanelViewRef.current !== "search") {
          previousBottomPanelByWorkspaceRef.current.delete(workspaceKey);
          previousBottomPanelByWorkspaceRef.current.set(workspaceKey, {
            view: bottomPanelViewRef.current,
            visible: bottomPanelVisible,
          });
          if (previousBottomPanelByWorkspaceRef.current.size > MAX_REMEMBERED_BOTTOM_PANELS) {
            const oldestWorkspaceKey = previousBottomPanelByWorkspaceRef.current
              .keys()
              .next().value;
            if (oldestWorkspaceKey !== undefined) {
              previousBottomPanelByWorkspaceRef.current.delete(oldestWorkspaceKey);
            }
          }
        }

        bottomPanelViewRef.current = "search";
        setTextSearchOpen(true);
        setBottomPanelView("search");
        setBottomPanelVisible(true);
        return;
      }

      setTextSearchOpen(false);

      if (bottomPanelViewRef.current !== "search") {
        return;
      }

      const previousBottomPanel = previousBottomPanelByWorkspaceRef.current.get(workspaceKey);
      const nextView = previousBottomPanel?.view ?? "problems";
      bottomPanelViewRef.current = nextView;
      previousBottomPanelByWorkspaceRef.current.delete(workspaceKey);
      setBottomPanelView(nextView);
      setBottomPanelVisible(previousBottomPanel?.visible ?? false);
    },
    [
      bottomPanelViewRef,
      bottomPanelVisible,
      setBottomPanelView,
      setBottomPanelVisible,
      setTextSearchOpen,
      workspaceKey,
    ],
  );
}
