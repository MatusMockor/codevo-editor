import type {
  AgentWorkbenchLayout,
  AgentWorkbenchLayoutMode,
} from "../domain/agentWorkbenchLayout";

export const WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE = "--agent-right-panel-committed";
export const WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE = "--agent-bottom-panel-committed";

export interface WorkbenchShellPlacementInput {
  readonly effectiveLayout: AgentWorkbenchLayoutMode;
  readonly layout: Pick<
    AgentWorkbenchLayout,
    "rightSurface" | "rightPanelWidth" | "bottomPanelHeight"
  >;
  readonly bottomPanelVisible: boolean;
}

export interface WorkbenchShellPlacement {
  readonly layout: AgentWorkbenchLayoutMode;
  readonly editorHidden: boolean;
  readonly rightPanelWidth: number;
  readonly bottomPanelHeight: number;
}

export type WorkbenchFrameTreeState = "visible" | "hidden";

export function workbenchFrameTreeState(
  placement: Pick<WorkbenchShellPlacement, "layout" | "editorHidden">,
  treeReportedVisible: boolean,
): WorkbenchFrameTreeState {
  if (placement.layout !== "agent") return "hidden";
  if (placement.editorHidden) return "hidden";
  return treeReportedVisible ? "visible" : "hidden";
}

export function workbenchShellPlacement({
  bottomPanelVisible,
  effectiveLayout,
  layout,
}: WorkbenchShellPlacementInput): WorkbenchShellPlacement {
  if (effectiveLayout === "editor-expanded") {
    return {
      layout: effectiveLayout,
      editorHidden: false,
      rightPanelWidth: 0,
      bottomPanelHeight: 0,
    };
  }

  return {
    layout: effectiveLayout,
    editorHidden: layout.rightSurface !== "files",
    rightPanelWidth: layout.rightSurface === null ? 0 : layout.rightPanelWidth,
    bottomPanelHeight: bottomPanelVisible ? layout.bottomPanelHeight : 0,
  };
}
