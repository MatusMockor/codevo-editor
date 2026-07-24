import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { WorkspaceDescriptor } from "../domain/workspace";
import { canShowWorkspaceExpressRoutes } from "./useWorkbenchCommandRegistry";

interface WorkbenchFrameworkPanelsOptions {
  readonly currentWorkspaceRootRef: RefObject<string | null>;
  readonly setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  readonly setBottomPanelVisible: Dispatch<SetStateAction<boolean>>;
  readonly setJsTestRunRequestVersion: Dispatch<SetStateAction<number>>;
  readonly setPhpTestRunRequestVersion: Dispatch<SetStateAction<number>>;
  readonly workspaceDescriptor: WorkspaceDescriptor | null;
}

export function useWorkbenchFrameworkPanels({
  currentWorkspaceRootRef,
  setBottomPanelView,
  setBottomPanelVisible,
  setJsTestRunRequestVersion,
  setPhpTestRunRequestVersion,
  workspaceDescriptor,
}: WorkbenchFrameworkPanelsOptions) {
  const show = useCallback(
    (view: BottomPanelView | "routes" | "testResults") => {
      setBottomPanelView(view as BottomPanelView);
      setBottomPanelVisible(true);
    },
    [setBottomPanelView, setBottomPanelVisible],
  );
  const openArtisanRoutesPanel = useCallback(() => show("routes"), [show]);
  const openExpressRoutesPanel = useCallback(() => {
    if (canShowWorkspaceExpressRoutes(currentWorkspaceRootRef.current, workspaceDescriptor)) {
      show("expressRoutes");
    }
  }, [currentWorkspaceRootRef, show, workspaceDescriptor]);
  const openPhpTestResultsPanel = useCallback(() => {
    show("testResults");
    setPhpTestRunRequestVersion((current) => current + 1);
  }, [setPhpTestRunRequestVersion, show]);
  const openJsTestResultsPanel = useCallback(() => {
    show("testResults");
    setJsTestRunRequestVersion((current) => current + 1);
  }, [setJsTestRunRequestVersion, show]);
  return {
    openArtisanRoutesPanel,
    openExpressRoutesPanel,
    openJsTestResultsPanel,
    openPhpTestResultsPanel,
  };
}
