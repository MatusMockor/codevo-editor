import {
  DEFAULT_AGENT_RAIL_WIDTH,
  MIN_AGENT_RIGHT_PANEL_WIDTH,
  type AgentRailState,
} from "./agentWorkbenchLayout";

export const AGENT_CENTER_MIN_WIDTH = 560;
export const AGENT_EXPANDED_RAIL_WIDTH = DEFAULT_AGENT_RAIL_WIDTH;
export const AGENT_COMPACT_RAIL_WIDTH = 248;
export const AGENT_COLLAPSED_RAIL_WIDTH = 48;
export const AGENT_COMPACT_RAIL_BREAKPOINT = 1180;
export const AGENT_HIDDEN_RAIL_BREAKPOINT = 720;
export const AGENT_OVERLAY_MAX_WIDTH = 420;
export const AGENT_OVERLAY_CENTER_PEEK = 160;

export type ResponsivePanelRestore = "none" | "collapseRail" | "closePanel";

export interface ResponsiveAgentPanelInput {
  readonly hidden: boolean;
  readonly maximized: boolean;
  readonly rail: AgentRailState;
  readonly railWidth?: number;
  readonly requestedWidth: number;
  readonly viewportWidth: number;
}

export interface ResponsiveAgentPanelPlacement {
  readonly overlay: boolean;
  readonly restore: ResponsivePanelRestore;
  readonly width: number;
}

export function responsiveAgentPanelPlacement({
  hidden,
  maximized,
  rail,
  railWidth: expandedRailWidth = AGENT_EXPANDED_RAIL_WIDTH,
  requestedWidth,
  viewportWidth,
}: ResponsiveAgentPanelInput): ResponsiveAgentPanelPlacement {
  const docked = { overlay: false, restore: "none" as const };
  if (hidden) return { ...docked, width: 0 };
  if (maximized || !Number.isFinite(viewportWidth)) {
    return { ...docked, width: requestedWidth };
  }

  const boundedViewportWidth = Math.max(0, Math.floor(viewportWidth));
  const railWidth = agentWorkbenchRailWidth(rail, boundedViewportWidth, expandedRailWidth);
  const availableWidth = boundedViewportWidth - railWidth - AGENT_CENTER_MIN_WIDTH;
  if (availableWidth < MIN_AGENT_RIGHT_PANEL_WIDTH) {
    return {
      overlay: true,
      restore: "none",
      width: Math.min(requestedWidth, agentOverlayPanelMaxWidth(boundedViewportWidth, railWidth)),
    };
  }

  return { ...docked, width: Math.min(requestedWidth, availableWidth) };
}

export function agentOverlayPanelMaxWidth(viewportWidth: number, railWidth: number): number {
  const contentWidth = Math.max(0, viewportWidth - railWidth);
  return Math.min(
    contentWidth,
    AGENT_OVERLAY_MAX_WIDTH,
    Math.max(MIN_AGENT_RIGHT_PANEL_WIDTH, contentWidth - AGENT_OVERLAY_CENTER_PEEK),
  );
}

export function agentWorkbenchRailWidth(
  rail: AgentRailState,
  viewportWidth: number,
  expandedWidth: number = AGENT_EXPANDED_RAIL_WIDTH,
): number {
  if (viewportWidth <= AGENT_HIDDEN_RAIL_BREAKPOINT) return 0;
  if (rail === "collapsed") return AGENT_COLLAPSED_RAIL_WIDTH;
  if (viewportWidth <= AGENT_COMPACT_RAIL_BREAKPOINT) {
    return Math.min(expandedWidth, AGENT_COMPACT_RAIL_WIDTH);
  }
  return expandedWidth;
}
