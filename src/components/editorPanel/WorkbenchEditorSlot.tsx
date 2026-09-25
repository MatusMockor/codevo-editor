import type { ReactNode } from "react";
import { debugViewsPlacement } from "../../domain/editorDebugFocus";
import { workbenchPanelPlacement } from "../../domain/editorDrawer";
import { DebugViewsRevealContext } from "../debug/DebugViewsRevealContext";
import type { WorkbenchBottomPanelHostProps } from "../WorkbenchBottomPanelHost";
import { EditorDebugToolbarContext } from "./EditorDebugToolbarContext";
import { EditorPanelLayout } from "./EditorPanelLayout";
import { useEditorDebugFocus } from "./useEditorDebugFocus";
import { useEditorDrawerReveal, useEditorSurfaceReveal } from "./useEditorSurfaceReveal";
import { WorkbenchEditorDrawerHost } from "./WorkbenchEditorDrawerHost";

export interface WorkbenchEditorSlotProps {
  readonly area: ReactNode;
  readonly panelHostProps: WorkbenchBottomPanelHostProps;
}

export function WorkbenchEditorSlot({ area, panelHostProps }: WorkbenchEditorSlotProps) {
  const { debugPanel, terminalOwnerKey, workbench } = panelHostProps;
  const { agentWorkbench } = workbench;
  const drawerView = workbenchPanelPlacement(
    workbench.bottomPanelView,
    workbench.bottomPanelVisible,
  ).drawer;
  const maximized =
    agentWorkbench.effectiveLayout !== "agent" || agentWorkbench.layout.rightPanelMaximized;
  const reveal = useEditorSurfaceReveal(agentWorkbench.dispatch);
  useEditorDrawerReveal({ drawerView, ownerKey: terminalOwnerKey, reveal });
  useEditorDebugFocus({
    dispatch: agentWorkbench.dispatch,
    maximized,
    ownerKey: terminalOwnerKey,
    sessionId: debugPanel.sessionId,
  });
  const debugViewsVisible =
    debugViewsPlacement({
      drawerView,
      maximized,
      phase: debugPanel.sessionActive ? "active" : "idle",
    }) === "side";
  const showDebugViews = debugViewsVisible
    ? null
    : () => {
        workbench.showBottomPanelView("debug");
        agentWorkbench.dispatch({ kind: "openSurface", surface: "editor" });
        agentWorkbench.dispatch({ kind: "maximizeRightPanel" });
      };
  return (
    <DebugViewsRevealContext.Provider value={showDebugViews}>
      <EditorDebugToolbarContext.Provider value={debugPanel.toolbar}>
        <EditorPanelLayout
          area={area}
          debugging={debugPanel.sessionActive}
          debugViews={debugViewsVisible ? debugPanel.regions.sections : null}
          message={workbench.message}
          renderDrawer={
            drawerView === null
              ? null
              : (frame) => (
                  <WorkbenchEditorDrawerHost
                    {...panelHostProps}
                    consoleHeader={debugPanel.regions.consoleHeader}
                    frame={frame}
                    view={drawerView}
                  />
                )
          }
        />
      </EditorDebugToolbarContext.Provider>
    </DebugViewsRevealContext.Provider>
  );
}
