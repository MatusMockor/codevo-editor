import type { AgentRailState } from "./agentWorkbenchLayout";

export const AGENT_CENTER_MIN_WIDTH = 360;
export const AGENT_EXPANDED_RAIL_WIDTH = 272;
export const AGENT_COMPACT_RAIL_WIDTH = 248;
export const AGENT_COLLAPSED_RAIL_WIDTH = 48;
export const AGENT_COMPACT_RAIL_BREAKPOINT = 1180;
export const AGENT_RESPONSIVE_MAXIMIZE_BREAKPOINT = 720;

export type ResponsivePanelRestore = "none" | "collapseRail" | "closePanel";

export interface ResponsiveAgentPanelInput {
  readonly hidden: boolean;
  readonly maximized: boolean;
  readonly rail: AgentRailState;
  readonly requestedWidth: number;
  readonly viewportWidth: number;
}

export interface ResponsiveAgentPanelPlacement {
  readonly maximized: boolean;
  readonly restore: ResponsivePanelRestore;
  readonly width: number;
}

export function responsiveAgentPanelPlacement({
  hidden,
  maximized,
  rail,
  requestedWidth,
  viewportWidth,
}: ResponsiveAgentPanelInput): ResponsiveAgentPanelPlacement {
  if (hidden) return { maximized: false, restore: "none", width: 0 };
  if (!Number.isFinite(viewportWidth)) {
    return { maximized: false, restore: "none", width: requestedWidth };
  }

  const boundedViewportWidth = Math.max(0, Math.floor(viewportWidth));
  if (boundedViewportWidth <= AGENT_RESPONSIVE_MAXIMIZE_BREAKPOINT) {
    return { maximized: true, restore: "closePanel", width: requestedWidth };
  }

  const railWidth = agentWorkbenchRailWidth(rail, boundedViewportWidth);
  const availableWidth = boundedViewportWidth - railWidth - AGENT_CENTER_MIN_WIDTH;
  if (availableWidth < AGENT_CENTER_MIN_WIDTH) {
    const collapsedAvailableWidth =
      boundedViewportWidth - AGENT_COLLAPSED_RAIL_WIDTH - AGENT_CENTER_MIN_WIDTH;
    const restore =
      rail === "expanded" && collapsedAvailableWidth >= AGENT_CENTER_MIN_WIDTH
        ? "collapseRail"
        : "closePanel";
    return { maximized: true, restore, width: requestedWidth };
  }

  if (maximized) return { maximized: false, restore: "none", width: requestedWidth };

  return {
    maximized: false,
    restore: "none",
    width: Math.min(requestedWidth, availableWidth),
  };
}

export function agentWorkbenchRailWidth(rail: AgentRailState, viewportWidth: number): number {
  if (rail === "collapsed") return AGENT_COLLAPSED_RAIL_WIDTH;
  if (viewportWidth <= AGENT_COMPACT_RAIL_BREAKPOINT) return AGENT_COMPACT_RAIL_WIDTH;
  return AGENT_EXPANDED_RAIL_WIDTH;
}
