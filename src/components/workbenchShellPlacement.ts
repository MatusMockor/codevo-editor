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
    | "rightPanel"
    | "openSurfaces"
    | "activeSurface"
    | "rightPanelMaximized"
    | "rightPanelWidth"
    | "bottomPanelHeight"
  >;
  readonly bottomPanelVisible: boolean;
}

export interface WorkbenchShellPlacement {
  readonly layout: AgentWorkbenchLayoutMode;
  readonly editorHidden: boolean;
  readonly rightPanelHidden: boolean;
  readonly surfacesMounted: boolean;
  readonly rightPanelMaximized: boolean;
  readonly rightPanelWidth: number;
  readonly bottomPanelHeight: number;
}

export interface AgentSurfaceHostPlacement {
  readonly mounted: boolean;
  readonly hidden: boolean;
}

export function agentSurfaceHostPlacement(
  layout: Pick<AgentWorkbenchLayout, "layout" | "rightPanel" | "openSurfaces">,
): AgentSurfaceHostPlacement {
  if (layout.layout !== "agent") return { mounted: false, hidden: true };
  const hidden = layout.rightPanel !== "open";
  return { mounted: !hidden || layout.openSurfaces.length > 0, hidden };
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
      rightPanelHidden: true,
      surfacesMounted: false,
      rightPanelMaximized: false,
      rightPanelWidth: 0,
      bottomPanelHeight: 0,
    };
  }

  const host = agentSurfaceHostPlacement({ ...layout, layout: effectiveLayout });
  const rightPanelHidden = host.hidden;

  return {
    layout: effectiveLayout,
    editorHidden: rightPanelHidden || layout.activeSurface !== "files",
    rightPanelHidden,
    surfacesMounted: host.mounted,
    rightPanelMaximized: !rightPanelHidden && layout.rightPanelMaximized,
    rightPanelWidth: rightPanelHidden ? 0 : layout.rightPanelWidth,
    bottomPanelHeight: bottomPanelVisible ? layout.bottomPanelHeight : 0,
  };
}
