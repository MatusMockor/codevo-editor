export const AGENT_SURFACE_KINDS = ["files", "diff", "terminal"] as const;
export type AgentSurfaceKind = (typeof AGENT_SURFACE_KINDS)[number];

export const AGENT_WORKBENCH_LAYOUT_MODES = ["agent", "editor-expanded"] as const;
export type AgentWorkbenchLayoutMode = (typeof AGENT_WORKBENCH_LAYOUT_MODES)[number];

export const MIN_AGENT_RIGHT_PANEL_WIDTH = 360;
export const MAX_AGENT_RIGHT_PANEL_WIDTH = 1200;
export const DEFAULT_AGENT_RIGHT_PANEL_WIDTH = 540;

export const MIN_AGENT_BOTTOM_PANEL_HEIGHT = 120;
export const MAX_AGENT_BOTTOM_PANEL_HEIGHT = 900;
export const DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT = 280;

export const DEFAULT_AGENT_SURFACE_KIND: AgentSurfaceKind = "files";

export const AGENT_RIGHT_PANEL_STATES = ["open", "closed"] as const;
export type AgentRightPanelState = (typeof AGENT_RIGHT_PANEL_STATES)[number];

export interface AgentWorkbenchLayout {
  readonly layout: AgentWorkbenchLayoutMode;
  readonly rightPanel: AgentRightPanelState;
  readonly rightSurface: AgentSurfaceKind | null;
  readonly lastSurface: AgentSurfaceKind;
  readonly bottomPanel: boolean;
  readonly rightPanelWidth: number;
  readonly bottomPanelHeight: number;
}

export interface AgentWorkbenchLayoutPersisted {
  readonly layout: AgentWorkbenchLayoutMode;
  readonly rightPanel: AgentRightPanelState;
  readonly rightSurface: AgentSurfaceKind | null;
  readonly bottomPanel: boolean;
  readonly rightPanelWidth: number;
  readonly bottomPanelHeight: number;
}

export type AgentWorkbenchLayoutAction =
  | { readonly kind: "openSurface"; readonly surface: AgentSurfaceKind }
  | { readonly kind: "closeSurface" }
  | { readonly kind: "showRightPanel" }
  | { readonly kind: "toggleRightPanel" }
  | { readonly kind: "toggleBottomPanel" }
  | { readonly kind: "showBottomPanel" }
  | { readonly kind: "hideBottomPanel" }
  | { readonly kind: "expandEditor" }
  | { readonly kind: "collapseEditor" }
  | { readonly kind: "toggleEditorExpanded" }
  | { readonly kind: "resizeRightPanel"; readonly width: number }
  | { readonly kind: "resizeBottomPanel"; readonly height: number };

export const initialAgentWorkbenchLayout: AgentWorkbenchLayout = {
  layout: "agent",
  rightPanel: "closed",
  rightSurface: null,
  lastSurface: DEFAULT_AGENT_SURFACE_KIND,
  bottomPanel: false,
  rightPanelWidth: DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  bottomPanelHeight: DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT,
};

export function isAgentSurfaceKind(value: unknown): value is AgentSurfaceKind {
  return (AGENT_SURFACE_KINDS as ReadonlyArray<string>).includes(value as string);
}

export function isAgentRightPanelState(value: unknown): value is AgentRightPanelState {
  return (AGENT_RIGHT_PANEL_STATES as ReadonlyArray<string>).includes(value as string);
}

export function isAgentWorkbenchLayoutMode(value: unknown): value is AgentWorkbenchLayoutMode {
  return (AGENT_WORKBENCH_LAYOUT_MODES as ReadonlyArray<string>).includes(value as string);
}

export function clampAgentRightPanelWidth(width: number): number {
  return clamp(
    width,
    MIN_AGENT_RIGHT_PANEL_WIDTH,
    MAX_AGENT_RIGHT_PANEL_WIDTH,
    DEFAULT_AGENT_RIGHT_PANEL_WIDTH,
  );
}

export function clampAgentBottomPanelHeight(height: number): number {
  return clamp(
    height,
    MIN_AGENT_BOTTOM_PANEL_HEIGHT,
    MAX_AGENT_BOTTOM_PANEL_HEIGHT,
    DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT,
  );
}

export function agentWorkbenchLayoutReducer(
  state: AgentWorkbenchLayout,
  action: AgentWorkbenchLayoutAction,
): AgentWorkbenchLayout {
  switch (action.kind) {
    case "openSurface":
      return openSurface(state, action.surface);
    case "closeSurface":
      return closeSurface(state);
    case "showRightPanel":
      return showRightPanel(state);
    case "toggleRightPanel":
      return toggleRightPanel(state);
    case "toggleBottomPanel":
      return { ...state, bottomPanel: !state.bottomPanel };
    case "showBottomPanel":
      return state.bottomPanel ? state : { ...state, bottomPanel: true };
    case "hideBottomPanel":
      return state.bottomPanel ? { ...state, bottomPanel: false } : state;
    case "expandEditor":
      return expandEditor(state);
    case "collapseEditor":
      return collapseEditor(state);
    case "toggleEditorExpanded":
      return state.layout === "editor-expanded" ? collapseEditor(state) : expandEditor(state);
    case "resizeRightPanel":
      return resizeRightPanel(state, action.width);
    case "resizeBottomPanel":
      return resizeBottomPanel(state, action.height);
    default:
      return unsupportedAgentWorkbenchLayoutAction(action);
  }
}

export type AgentSurfaceBlockedPredicate = (surface: AgentSurfaceKind) => boolean;

export function rightPanelToggleAction(
  state: AgentWorkbenchLayout,
  isSurfaceBlocked: AgentSurfaceBlockedPredicate,
): AgentWorkbenchLayoutAction {
  if (state.layout === "editor-expanded") return collapseEditorAction(state, isSurfaceBlocked);
  if (state.rightPanel === "open") return { kind: "closeSurface" };
  if (isSurfaceBlocked(state.lastSurface)) return { kind: "showRightPanel" };
  return { kind: "toggleRightPanel" };
}

export function editorExpandToggleAction(
  state: AgentWorkbenchLayout,
  isSurfaceBlocked: AgentSurfaceBlockedPredicate,
): AgentWorkbenchLayoutAction {
  if (state.layout === "agent") return { kind: "expandEditor" };
  return collapseEditorAction(state, isSurfaceBlocked);
}

export function collapseEditorAction(
  state: AgentWorkbenchLayout,
  isSurfaceBlocked: AgentSurfaceBlockedPredicate,
): AgentWorkbenchLayoutAction {
  if (state.layout === "editor-expanded" && isSurfaceBlocked(state.lastSurface)) {
    return { kind: "showRightPanel" };
  }
  return { kind: "collapseEditor" };
}

export function parseAgentWorkbenchLayout(value: unknown): AgentWorkbenchLayout {
  if (!isRecord(value)) {
    return initialAgentWorkbenchLayout;
  }

  const layout = isAgentWorkbenchLayoutMode(value.layout)
    ? value.layout
    : initialAgentWorkbenchLayout.layout;
  const surface = isAgentSurfaceKind(value.rightSurface) ? value.rightSurface : null;
  const rightSurface = layout === "editor-expanded" ? null : surface;

  return {
    layout,
    rightPanel: parseRightPanel(value.rightPanel, layout, rightSurface),
    rightSurface,
    lastSurface: surface ?? DEFAULT_AGENT_SURFACE_KIND,
    bottomPanel:
      typeof value.bottomPanel === "boolean"
        ? value.bottomPanel
        : initialAgentWorkbenchLayout.bottomPanel,
    rightPanelWidth: parseSize(value.rightPanelWidth, clampAgentRightPanelWidth),
    bottomPanelHeight: parseSize(value.bottomPanelHeight, clampAgentBottomPanelHeight),
  };
}

export function serializeAgentWorkbenchLayout(
  state: AgentWorkbenchLayout,
): AgentWorkbenchLayoutPersisted {
  return {
    layout: state.layout,
    rightPanel: state.rightPanel,
    rightSurface: state.rightSurface,
    bottomPanel: state.bottomPanel,
    rightPanelWidth: state.rightPanelWidth,
    bottomPanelHeight: state.bottomPanelHeight,
  };
}

export function agentWorkbenchLayoutsEqual(
  left: AgentWorkbenchLayout,
  right: AgentWorkbenchLayout,
): boolean {
  return left.lastSurface === right.lastSurface && agentWorkbenchLayoutSnapshotsEqual(left, right);
}

export function agentWorkbenchLayoutSnapshotsEqual(
  left: AgentWorkbenchLayoutPersisted,
  right: AgentWorkbenchLayoutPersisted,
): boolean {
  return (
    left.layout === right.layout &&
    left.rightPanel === right.rightPanel &&
    left.rightSurface === right.rightSurface &&
    left.bottomPanel === right.bottomPanel &&
    left.rightPanelWidth === right.rightPanelWidth &&
    left.bottomPanelHeight === right.bottomPanelHeight
  );
}

function openSurface(state: AgentWorkbenchLayout, surface: AgentSurfaceKind): AgentWorkbenchLayout {
  if (state.layout === "agent" && state.rightPanel === "open" && state.rightSurface === surface) {
    return state;
  }

  return {
    ...state,
    layout: "agent",
    rightPanel: "open",
    rightSurface: surface,
    lastSurface: surface,
  };
}

function closeSurface(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.rightPanel === "closed" && state.rightSurface === null) {
    return state;
  }

  return { ...state, rightPanel: "closed", rightSurface: null };
}

function showRightPanel(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.layout === "agent" && state.rightPanel === "open") {
    return state;
  }

  return { ...state, layout: "agent", rightPanel: "open", rightSurface: null };
}

function toggleRightPanel(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.layout === "editor-expanded") {
    return collapseEditor(state);
  }

  if (state.rightPanel === "open") {
    return { ...state, rightPanel: "closed", rightSurface: null };
  }

  return { ...state, rightPanel: "open", rightSurface: state.lastSurface };
}

function expandEditor(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.layout === "editor-expanded") {
    return state;
  }

  return {
    ...state,
    layout: "editor-expanded",
    rightPanel: "closed",
    rightSurface: null,
    lastSurface: state.rightSurface ?? state.lastSurface,
  };
}

function collapseEditor(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.layout === "agent") {
    return state;
  }

  return { ...state, layout: "agent", rightPanel: "open", rightSurface: state.lastSurface };
}

function resizeRightPanel(state: AgentWorkbenchLayout, width: number): AgentWorkbenchLayout {
  const rightPanelWidth = clampAgentRightPanelWidth(width);
  return rightPanelWidth === state.rightPanelWidth ? state : { ...state, rightPanelWidth };
}

function resizeBottomPanel(state: AgentWorkbenchLayout, height: number): AgentWorkbenchLayout {
  const bottomPanelHeight = clampAgentBottomPanelHeight(height);
  return bottomPanelHeight === state.bottomPanelHeight ? state : { ...state, bottomPanelHeight };
}

function parseRightPanel(
  value: unknown,
  layout: AgentWorkbenchLayoutMode,
  rightSurface: AgentSurfaceKind | null,
): AgentRightPanelState {
  if (layout === "editor-expanded") return "closed";
  if (rightSurface !== null) return "open";
  return isAgentRightPanelState(value) ? value : "closed";
}

function parseSize(value: unknown, clampSize: (size: number) => number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return clampSize(Number.NaN);
  }

  return clampSize(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return Math.round(value);
}

function unsupportedAgentWorkbenchLayoutAction(action: never): never {
  throw new TypeError(`Unsupported agent workbench layout action: ${JSON.stringify(action)}.`);
}
