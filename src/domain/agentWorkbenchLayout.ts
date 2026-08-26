export const AGENT_SURFACE_KINDS = ["files", "diff", "terminal"] as const;
export type AgentSurfaceKind = (typeof AGENT_SURFACE_KINDS)[number];

export const MAX_AGENT_OPEN_SURFACES = AGENT_SURFACE_KINDS.length;

export const AGENT_WORKBENCH_LAYOUT_MODES = ["agent", "editor-expanded"] as const;
export type AgentWorkbenchLayoutMode = (typeof AGENT_WORKBENCH_LAYOUT_MODES)[number];

export const MIN_AGENT_RIGHT_PANEL_WIDTH = 360;
export const MAX_AGENT_RIGHT_PANEL_WIDTH = 1200;
export const DEFAULT_AGENT_RIGHT_PANEL_WIDTH = 540;

export const MIN_AGENT_BOTTOM_PANEL_HEIGHT = 120;
export const MAX_AGENT_BOTTOM_PANEL_HEIGHT = 900;
export const DEFAULT_AGENT_BOTTOM_PANEL_HEIGHT = 280;

export const AGENT_RIGHT_PANEL_STATES = ["open", "closed"] as const;
export type AgentRightPanelState = (typeof AGENT_RIGHT_PANEL_STATES)[number];

export interface AgentWorkbenchLayout {
  readonly layout: AgentWorkbenchLayoutMode;
  readonly rightPanel: AgentRightPanelState;
  readonly openSurfaces: ReadonlyArray<AgentSurfaceKind>;
  readonly activeSurface: AgentSurfaceKind | null;
  readonly rightPanelMaximized: boolean;
  readonly bottomPanel: boolean;
  readonly rightPanelWidth: number;
  readonly bottomPanelHeight: number;
}

export type AgentWorkbenchLayoutPersisted = AgentWorkbenchLayout;

export type AgentWorkbenchLayoutAction =
  | { readonly kind: "openSurface"; readonly surface: AgentSurfaceKind }
  | { readonly kind: "activateSurface"; readonly surface: AgentSurfaceKind }
  | { readonly kind: "closeSurfaceTab"; readonly surface: AgentSurfaceKind }
  | { readonly kind: "showSurfaceChooser" }
  | { readonly kind: "toggleRightPanel" }
  | { readonly kind: "toggleMaximized" }
  | { readonly kind: "toggleBottomPanel" }
  | { readonly kind: "showBottomPanel" }
  | { readonly kind: "hideBottomPanel" }
  | { readonly kind: "expandEditor" }
  | { readonly kind: "collapseEditor" }
  | { readonly kind: "toggleEditorExpanded" }
  | { readonly kind: "resizeRightPanel"; readonly width: number }
  | { readonly kind: "resizeBottomPanel"; readonly height: number };

const NO_SURFACES: ReadonlyArray<AgentSurfaceKind> = Object.freeze([]);

const CLOSED_RIGHT_PANEL = {
  rightPanel: "closed",
  rightPanelMaximized: false,
} as const satisfies Partial<AgentWorkbenchLayout>;

export const initialAgentWorkbenchLayout: AgentWorkbenchLayout = {
  layout: "agent",
  ...CLOSED_RIGHT_PANEL,
  openSurfaces: NO_SURFACES,
  activeSurface: null,
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
    case "activateSurface":
      return activateSurface(state, action.surface);
    case "closeSurfaceTab":
      return closeSurfaceTab(state, action.surface);
    case "showSurfaceChooser":
      return showSurfaceChooser(state);
    case "toggleRightPanel":
      return toggleRightPanel(state);
    case "toggleMaximized":
      return toggleMaximized(state);
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

export function parseAgentWorkbenchLayout(value: unknown): AgentWorkbenchLayout {
  if (!isRecord(value)) {
    return initialAgentWorkbenchLayout;
  }

  const layout = isAgentWorkbenchLayoutMode(value.layout)
    ? value.layout
    : initialAgentWorkbenchLayout.layout;
  const openSurfaces = parseOpenSurfaces(value);
  const activeSurface = parseActiveSurface(value, openSurfaces);
  const rightPanel =
    layout === "editor-expanded" ? "closed" : parseRightPanel(value.rightPanel, openSurfaces);
  const rightPanelMaximized =
    value.rightPanelMaximized === true && rightPanel === "open" && activeSurface !== null;

  return {
    layout,
    rightPanel,
    openSurfaces,
    activeSurface,
    rightPanelMaximized,
    ...parseIndependentFields(value),
  };
}

export function serializeAgentWorkbenchLayout(
  state: AgentWorkbenchLayout,
): AgentWorkbenchLayoutPersisted {
  return {
    layout: state.layout,
    rightPanel: state.rightPanel,
    openSurfaces: state.openSurfaces,
    activeSurface: state.activeSurface,
    rightPanelMaximized: state.rightPanelMaximized,
    bottomPanel: state.bottomPanel,
    rightPanelWidth: state.rightPanelWidth,
    bottomPanelHeight: state.bottomPanelHeight,
  };
}

export function agentWorkbenchLayoutsEqual(
  left: AgentWorkbenchLayout,
  right: AgentWorkbenchLayout,
): boolean {
  return agentWorkbenchLayoutSnapshotsEqual(left, right);
}

export function agentWorkbenchLayoutSnapshotsEqual(
  left: AgentWorkbenchLayoutPersisted,
  right: AgentWorkbenchLayoutPersisted,
): boolean {
  return (
    left.layout === right.layout &&
    left.rightPanel === right.rightPanel &&
    surfacesEqual(left.openSurfaces, right.openSurfaces) &&
    left.activeSurface === right.activeSurface &&
    left.rightPanelMaximized === right.rightPanelMaximized &&
    left.bottomPanel === right.bottomPanel &&
    left.rightPanelWidth === right.rightPanelWidth &&
    left.bottomPanelHeight === right.bottomPanelHeight
  );
}

function openSurface(state: AgentWorkbenchLayout, surface: AgentSurfaceKind): AgentWorkbenchLayout {
  const alreadyOpen = state.openSurfaces.includes(surface);
  if (state.layout === "agent" && state.rightPanel === "open" && alreadyOpen) {
    return state.activeSurface === surface ? state : { ...state, activeSurface: surface };
  }

  return {
    ...state,
    layout: "agent",
    rightPanel: "open",
    openSurfaces: alreadyOpen ? state.openSurfaces : [...state.openSurfaces, surface],
    activeSurface: surface,
  };
}

function activateSurface(
  state: AgentWorkbenchLayout,
  surface: AgentSurfaceKind,
): AgentWorkbenchLayout {
  if (state.activeSurface === surface) return state;
  if (!state.openSurfaces.includes(surface)) return state;
  return { ...state, activeSurface: surface };
}

function closeSurfaceTab(
  state: AgentWorkbenchLayout,
  surface: AgentSurfaceKind,
): AgentWorkbenchLayout {
  const index = state.openSurfaces.indexOf(surface);
  if (index < 0) return state;

  const openSurfaces = state.openSurfaces.filter((candidate) => candidate !== surface);
  const rightPanelMaximized = openSurfaces.length === 0 ? false : state.rightPanelMaximized;
  if (state.activeSurface !== surface) return { ...state, openSurfaces, rightPanelMaximized };

  const neighbour = openSurfaces[index] ?? openSurfaces[index - 1] ?? null;
  return { ...state, openSurfaces, activeSurface: neighbour, rightPanelMaximized };
}

function showSurfaceChooser(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  const shown =
    state.layout === "agent" && state.rightPanel === "open" && state.activeSurface === null;
  if (shown && !state.rightPanelMaximized) return state;

  return {
    ...state,
    layout: "agent",
    rightPanel: "open",
    activeSurface: null,
    rightPanelMaximized: false,
  };
}

function openRightPanel(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  const activeSurface = state.activeSurface ?? state.openSurfaces[0] ?? null;
  const unchanged =
    state.layout === "agent" &&
    state.rightPanel === "open" &&
    state.activeSurface === activeSurface;
  if (unchanged) return state;
  return { ...state, layout: "agent", rightPanel: "open", activeSurface };
}

function toggleRightPanel(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.layout === "editor-expanded") return collapseEditor(state);
  if (state.rightPanel === "open") return { ...state, ...CLOSED_RIGHT_PANEL };
  return openRightPanel(state);
}

function toggleMaximized(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  const opened = openRightPanel(state);
  if (opened.activeSurface === null) return state;
  if (state.layout === "agent" && state.rightPanel === "open") {
    return { ...opened, rightPanelMaximized: !state.rightPanelMaximized };
  }

  return { ...opened, rightPanelMaximized: true };
}

function expandEditor(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.layout === "editor-expanded") return state;
  return { ...state, layout: "editor-expanded", ...CLOSED_RIGHT_PANEL };
}

function collapseEditor(state: AgentWorkbenchLayout): AgentWorkbenchLayout {
  if (state.layout === "agent") return state;
  return openRightPanel(state);
}

function resizeRightPanel(state: AgentWorkbenchLayout, width: number): AgentWorkbenchLayout {
  const rightPanelWidth = clampAgentRightPanelWidth(width);
  return rightPanelWidth === state.rightPanelWidth ? state : { ...state, rightPanelWidth };
}

function resizeBottomPanel(state: AgentWorkbenchLayout, height: number): AgentWorkbenchLayout {
  const bottomPanelHeight = clampAgentBottomPanelHeight(height);
  return bottomPanelHeight === state.bottomPanelHeight ? state : { ...state, bottomPanelHeight };
}

function parseIndependentFields(
  value: Record<string, unknown>,
): Pick<AgentWorkbenchLayout, "bottomPanel" | "rightPanelWidth" | "bottomPanelHeight"> {
  return {
    bottomPanel:
      typeof value.bottomPanel === "boolean"
        ? value.bottomPanel
        : initialAgentWorkbenchLayout.bottomPanel,
    rightPanelWidth: parseSize(value.rightPanelWidth, clampAgentRightPanelWidth),
    bottomPanelHeight: parseSize(value.bottomPanelHeight, clampAgentBottomPanelHeight),
  };
}

function parseOpenSurfaces(value: Record<string, unknown>): ReadonlyArray<AgentSurfaceKind> {
  if (value.openSurfaces === undefined) {
    return isAgentSurfaceKind(value.rightSurface) ? [value.rightSurface] : NO_SURFACES;
  }
  if (!Array.isArray(value.openSurfaces)) return NO_SURFACES;

  const surfaces: AgentSurfaceKind[] = [];
  for (const candidate of value.openSurfaces) {
    if (surfaces.length >= MAX_AGENT_OPEN_SURFACES) break;
    if (!isAgentSurfaceKind(candidate) || surfaces.includes(candidate)) continue;
    surfaces.push(candidate);
  }
  return surfaces.length === 0 ? NO_SURFACES : surfaces;
}

function parseActiveSurface(
  value: Record<string, unknown>,
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
): AgentSurfaceKind | null {
  const candidate = value.openSurfaces === undefined ? value.rightSurface : value.activeSurface;
  if (!isAgentSurfaceKind(candidate)) return null;
  return openSurfaces.includes(candidate) ? candidate : null;
}

function parseRightPanel(
  value: unknown,
  openSurfaces: ReadonlyArray<AgentSurfaceKind>,
): AgentRightPanelState {
  if (isAgentRightPanelState(value)) return value;
  return openSurfaces.length > 0 ? "open" : "closed";
}

function parseSize(value: unknown, clampSize: (size: number) => number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return clampSize(Number.NaN);
  }

  return clampSize(value);
}

function surfacesEqual(
  left: ReadonlyArray<AgentSurfaceKind>,
  right: ReadonlyArray<AgentSurfaceKind>,
): boolean {
  return left.length === right.length && left.every((surface, index) => surface === right[index]);
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
