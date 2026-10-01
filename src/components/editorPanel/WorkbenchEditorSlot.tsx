import type { ReactNode } from "react";
import { workbenchPanelPlacement } from "../../domain/editorDrawer";
import type { WorkbenchBottomPanelHostProps } from "../WorkbenchBottomPanelHost";
import { EditorPanelLayout } from "./EditorPanelLayout";
import { useEditorDrawerReveal, useEditorSurfaceReveal } from "./useEditorSurfaceReveal";
import { WorkbenchEditorDrawerHost } from "./WorkbenchEditorDrawerHost";

export interface WorkbenchEditorSlotProps {
  readonly area: ReactNode;
  readonly panelHostProps: WorkbenchBottomPanelHostProps;
}

export function WorkbenchEditorSlot({ area, panelHostProps }: WorkbenchEditorSlotProps) {
  const { terminalOwnerKey, workbench } = panelHostProps;
  const { agentWorkbench } = workbench;
  const drawerView = workbenchPanelPlacement(
    workbench.bottomPanelView,
    workbench.bottomPanelVisible,
  ).drawer;
  const reveal = useEditorSurfaceReveal(agentWorkbench.dispatch);
  useEditorDrawerReveal({ drawerView, ownerKey: terminalOwnerKey, reveal });
  return (
    <EditorPanelLayout
      area={area}
      message={workbench.message}
      renderDrawer={
        drawerView === null
          ? null
          : (frame) => (
              <WorkbenchEditorDrawerHost {...panelHostProps} frame={frame} view={drawerView} />
            )
      }
    />
  );
}
