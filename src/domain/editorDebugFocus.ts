import type { EditorDrawerView } from "./editorDrawer";

export type DebugSessionPhase = "idle" | "active";
export type EditorDebugFocusEffect = "none" | "maximize" | "restore";

export const EDITOR_DEBUG_FOCUS_OWNER_LIMIT = 16;

export interface EditorDebugFocusState {
  readonly ownerKey: string | null;
  readonly sessionId: number | null;
  readonly maximizedByDebug: boolean;
  readonly layoutTouched: boolean;
  readonly sessionsByOwner: ReadonlyMap<string, number>;
}

export type EditorDebugFocusEvent =
  | { readonly kind: "owner"; readonly ownerKey: string | null }
  | { readonly kind: "session"; readonly sessionId: number | null; readonly maximized: boolean }
  | { readonly kind: "layoutChanged" };

export interface EditorDebugFocusStep {
  readonly state: EditorDebugFocusState;
  readonly effect: EditorDebugFocusEffect;
}

export const initialEditorDebugFocusState: EditorDebugFocusState = Object.freeze({
  ownerKey: null,
  sessionId: null,
  maximizedByDebug: false,
  layoutTouched: false,
  sessionsByOwner: new Map<string, number>(),
});

export function editorDebugFocusReducer(
  state: EditorDebugFocusState,
  event: EditorDebugFocusEvent,
): EditorDebugFocusStep {
  switch (event.kind) {
    case "owner":
      return ownerChanged(state, event.ownerKey);
    case "layoutChanged":
      return { state: { ...state, layoutTouched: true }, effect: "none" };
    case "session":
      return sessionChanged(state, event.sessionId, event.maximized);
    default:
      return unsupportedEvent(event);
  }
}

export function debugViewsPlacement(input: {
  readonly maximized: boolean;
  readonly phase: DebugSessionPhase;
  readonly drawerView: EditorDrawerView | null;
}): "side" | "hidden" {
  if (!input.maximized) return "hidden";
  if (input.phase === "active") return "side";
  return input.drawerView === "debug" ? "side" : "hidden";
}

function ownerChanged(state: EditorDebugFocusState, ownerKey: string | null): EditorDebugFocusStep {
  if (state.ownerKey === ownerKey) return { state, effect: "none" };
  const sessionsByOwner = new Map(state.sessionsByOwner);
  rememberSession(sessionsByOwner, state.ownerKey, state.sessionId);
  const sessionId = ownerKey === null ? null : (sessionsByOwner.get(ownerKey) ?? null);
  if (ownerKey !== null) sessionsByOwner.delete(ownerKey);
  return {
    state: { ...initialEditorDebugFocusState, ownerKey, sessionId, sessionsByOwner },
    effect: "none",
  };
}

function rememberSession(
  sessionsByOwner: Map<string, number>,
  ownerKey: string | null,
  sessionId: number | null,
): void {
  if (ownerKey === null || sessionId === null) return;
  sessionsByOwner.delete(ownerKey);
  sessionsByOwner.set(ownerKey, sessionId);
  while (sessionsByOwner.size > EDITOR_DEBUG_FOCUS_OWNER_LIMIT) {
    const oldest = sessionsByOwner.keys().next().value;
    if (oldest === undefined) return;
    sessionsByOwner.delete(oldest);
  }
}

function sessionChanged(
  state: EditorDebugFocusState,
  sessionId: number | null,
  maximized: boolean,
): EditorDebugFocusStep {
  if (sessionId === null) return sessionEnded(state);
  if (state.sessionId === sessionId) return { state, effect: "none" };
  const started: EditorDebugFocusState = {
    ...state,
    sessionId,
    maximizedByDebug: !maximized,
    layoutTouched: false,
  };
  return { state: started, effect: maximized ? "none" : "maximize" };
}

function sessionEnded(state: EditorDebugFocusState): EditorDebugFocusStep {
  if (state.sessionId === null) return { state, effect: "none" };
  const restore = state.maximizedByDebug && !state.layoutTouched;
  return {
    state: {
      ...initialEditorDebugFocusState,
      ownerKey: state.ownerKey,
      sessionsByOwner: state.sessionsByOwner,
    },
    effect: restore ? "restore" : "none",
  };
}

function unsupportedEvent(event: never): never {
  throw new TypeError(`Unsupported editor debug focus event: ${JSON.stringify(event)}.`);
}
