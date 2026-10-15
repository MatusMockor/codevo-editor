import type { ReactNode } from "react";
import { workbenchPanelPlacement } from "../../domain/editorDrawer";
import type { WorkbenchBottomPanelHostProps } from "../WorkbenchBottomPanelHost";
import { EditorPanelLayout } from "./EditorPanelLayout";
import { WorkbenchEditorDrawerHost } from "./WorkbenchEditorDrawerHost";

export interface WorkbenchEditorSlotProps {
  readonly area: ReactNode;
  readonly panelHostProps: WorkbenchBottomPanelHostProps;
}

export function WorkbenchEditorSlot({ area, panelHostProps }: WorkbenchEditorSlotProps) {
  const { workbench } = panelHostProps;
  const drawerView =
    workbench.agentWorkbench.effectiveLayout === "agent"
      ? null
      : workbenchPanelPlacement(workbench.bottomPanelView, workbench.bottomPanelVisible).drawer;
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
