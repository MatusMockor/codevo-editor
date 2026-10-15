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

export type { ResponsivePanelRestore } from "../domain/agentWorkbenchResponsiveLayout";

export const WORKBENCH_FRAME_RIGHT_PANEL_VARIABLE = "--agent-right-panel-committed";
export const WORKBENCH_FRAME_BOTTOM_PANEL_VARIABLE = "--agent-bottom-panel-committed";
export const WORKBENCH_FRAME_RAIL_VARIABLE = "--agent-rail-committed";

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
  layout: Pick<AgentWorkbenchLayout, "rightPanel" | "openSurfaces">,
): AgentSurfaceHostPlacement {
  const hidden = layout.rightPanel !== "open";
  return { mounted: !hidden || layout.openSurfaces.length > 0, hidden };
}

export function rightPanelCoversThread(
  layout: Pick<AgentWorkbenchLayout, "rightPanel" | "rightPanelMaximized">,
): boolean {
  return layout.rightPanel === "open" && layout.rightPanelMaximized;
}

export function workbenchShellPlacement({
  bottomPanelVisible,
  effectiveLayout,
  layout,
  viewportWidth = Number.POSITIVE_INFINITY,
}: WorkbenchShellPlacementInput): WorkbenchShellPlacement {
  if (effectiveLayout === "editor-only") {
    return {
      layout: effectiveLayout,
      editorHidden: false,
      rightPanelHidden: true,
      surfacesMounted: false,
      rightPanelMaximized: true,
      responsiveMaximized: false,
      rightPanelOverlay: false,
      responsiveRestore: "none",
      rail: "collapsed",
      railWidth: DEFAULT_AGENT_RAIL_WIDTH,
      rightPanelWidth: 0,
      bottomPanelHeight: bottomPanelVisible ? layout.bottomPanelHeight : 0,
    };
  }

  const host = agentSurfaceHostPlacement(layout);
  const rightPanelHidden = host.hidden;
  const placement: WorkbenchShellPlacement = {
    layout: effectiveLayout,
    editorHidden: true,
    rightPanelHidden,
    surfacesMounted: host.mounted,
    rightPanelMaximized: rightPanelCoversThread(layout),
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
