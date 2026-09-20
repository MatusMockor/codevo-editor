import {
  DEFAULT_AGENT_RAIL_WIDTH,
  type AgentRailState,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutMode,
} from "../domain/agentWorkbenchLayout";
import {
  responsiveAgentPanelPlacement,
  type ResponsivePanelRestore,
} from "../domain/agentWorkbenchResponsiveLayout";
import {
  LOCAL_AGENT_SURFACE_ACTIVATION,
  agentSurfaceEditorSlot,
} from "../domain/agentSurfaceActivation";

export type { ResponsivePanelRestore } from "../domain/agentWorkbenchResponsiveLayout";

export const WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE = "--agent-right-panel-committed";
export const WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE = "--agent-bottom-panel-committed";
export const WORKBENCH_FRAME_RAIL_VARIABLE = "--agent-rail-committed";

export const WORKBENCH_FRAME_EDITOR_SLOT_ATTRIBUTE = "data-editor-slot";
export const WORKBENCH_FRAME_EDITOR_YIELD_SELECTOR =
  '.workbench-frame[data-layout="agent"]:has(> [data-slot="surface"] .agent-surface[data-editor-slot="none"])';

export interface WorkbenchShellPlacementInput {
  readonly effectiveLayout: AgentWorkbenchLayoutMode;
  readonly layout: Pick<
    AgentWorkbenchLayout,
    | "rightPanel"
    | "openSurfaces"
    | "activeSurface"
    | "rightPanelMaximized"
    | "rail"
    | "railWidth"
    | "rightPanelWidth"
    | "bottomPanelHeight"
  >;
  readonly bottomPanelVisible: boolean;
  readonly viewportWidth?: number;
}

export interface WorkbenchShellPlacement {
  readonly layout: AgentWorkbenchLayoutMode;
  readonly editorHidden: boolean;
  readonly rightPanelHidden: boolean;
  readonly surfacesMounted: boolean;
  readonly rightPanelMaximized: boolean;
  readonly responsiveMaximized: boolean;
  readonly rightPanelOverlay: boolean;
  readonly responsiveRestore: ResponsivePanelRestore;
  readonly rail: AgentRailState;
  readonly railWidth: number;
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
  viewportWidth = Number.POSITIVE_INFINITY,
}: WorkbenchShellPlacementInput): WorkbenchShellPlacement {
  if (effectiveLayout === "editor-expanded") {
    return {
      layout: effectiveLayout,
      editorHidden: false,
      rightPanelHidden: true,
      surfacesMounted: false,
      rightPanelMaximized: false,
      responsiveMaximized: false,
      rightPanelOverlay: false,
      responsiveRestore: "none",
      rail: "expanded",
      railWidth: DEFAULT_AGENT_RAIL_WIDTH,
      rightPanelWidth: 0,
      bottomPanelHeight: 0,
    };
  }

  const host = agentSurfaceHostPlacement({ ...layout, layout: effectiveLayout });
  const rightPanelHidden = host.hidden;
  const placement: WorkbenchShellPlacement = {
    layout: effectiveLayout,
    editorHidden:
      rightPanelHidden ||
      agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, layout.activeSurface) === "none",
    rightPanelHidden,
    surfacesMounted: host.mounted,
    rightPanelMaximized: !rightPanelHidden && layout.rightPanelMaximized,
    responsiveMaximized: false,
    rightPanelOverlay: false,
    responsiveRestore: "none",
    rail: layout.rail,
    railWidth: layout.railWidth,
    rightPanelWidth: rightPanelHidden ? 0 : layout.rightPanelWidth,
    bottomPanelHeight: bottomPanelVisible ? layout.bottomPanelHeight : 0,
  };
  return responsiveWorkbenchShellPlacement(placement, viewportWidth);
}

export function responsiveWorkbenchShellPlacement(
  placement: WorkbenchShellPlacement,
  viewportWidth: number,
): WorkbenchShellPlacement {
  if (placement.layout !== "agent") return placement;
  const responsive = responsiveAgentPanelPlacement({
    hidden: placement.rightPanelHidden,
    maximized: placement.rightPanelMaximized,
    rail: placement.rail,
    railWidth: placement.railWidth,
    requestedWidth: placement.rightPanelWidth,
    viewportWidth,
  });
  return {
    ...placement,
    rightPanelMaximized: placement.rightPanelMaximized,
    responsiveMaximized: false,
    rightPanelOverlay: responsive.overlay,
    responsiveRestore: responsive.restore,
    rightPanelWidth: responsive.width,
  };
}
