import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DebugGateway, DebugScope } from "../domain/debug";
import { debuggerSessionId, isDebugScopeList } from "../domain/debug";
import { initialDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { DebugSessionOwner } from "./useDebugSessionEnd";

export interface DebugFrameSelection {
  readonly frameId: number;
  readonly loadState:
    | { readonly kind: "loading" }
    | { readonly kind: "ready" }
    | { readonly kind: "error"; readonly message: string };
  readonly scopes: DebugScope[];
}

export interface DebugFrameSelectionContext {
  readonly activeSessionId: () => number | null;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly currentWorkspaceEpochRef: MutableRefObject<{ readonly epoch: number }>;
  readonly currentWorkspaceIdRef: MutableRefObject<string | null>;
  readonly frameSelectionGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly frameSelectionByRootRef: MutableRefObject<Record<string, DebugFrameSelection | null>>;
  readonly gateway: DebugGateway;
  readonly isExactWorkspaceOwnerCurrent: (rootPath: string, workspaceId: string | null) => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pauseGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly sessionOwnersRef: MutableRefObject<Map<string, DebugSessionOwner>>;
  readonly setFrameSelectionByRoot: Dispatch<
    SetStateAction<Record<string, DebugFrameSelection | null>>
  >;
  readonly snapshotsRef: MutableRefObject<Record<string, DebuggerSessionSnapshot>>;
}

/** Loads scopes only while the exact stopped frame capture remains current. */
export async function selectDebugFrame(
  context: DebugFrameSelectionContext,
  frameId: number,
): Promise<void> {
  if (!context.mountedRef.current || !trustedWorkspace(context.isWorkspaceTrusted)) return;
  const root = context.currentRootRef.current;
  const sessionId = context.activeSessionId();
  if (!root || sessionId === null) return;
  const key = normalizedWorkspaceRootKey(root);
  const workspaceId = context.currentWorkspaceIdRef.current;
  const workspaceEpoch = context.currentWorkspaceEpochRef.current.epoch;
  const sessionOwner = context.sessionOwnersRef.current.get(key);
  const pauseGeneration = context.pauseGenerationByRootRef.current[key] ?? 0;
  const pauseState = (context.snapshotsRef.current[key] ?? initialDebuggerSnapshot()).state;
  if (
    pauseState.kind !== "stopped" ||
    !pauseState.frames.some((frame) => frame.frameId === frameId)
  ) {
    return;
  }
  const selectionGeneration = (context.frameSelectionGenerationByRootRef.current[key] ?? 0) + 1;
  context.frameSelectionGenerationByRootRef.current = {
    ...context.frameSelectionGenerationByRootRef.current,
    [key]: selectionGeneration,
  };
  if (
    pauseGeneration <= 0 ||
    sessionOwner?.sessionId !== sessionId ||
    sessionOwner.workspaceEpoch !== workspaceEpoch ||
    sessionOwner.workspaceId !== workspaceId ||
    context.currentWorkspaceEpochRef.current.epoch !== workspaceEpoch ||
    !workspaceOwnerIsCurrent(context, root, workspaceId)
  ) {
    return;
  }

  publishSelection(context, key, {
    frameId,
    loadState: { kind: "loading" },
    scopes: [],
  });

  let scopes: DebugScope[];
  try {
    const receivedScopes: unknown = await context.gateway.scopesAtPause({
      rootPath: root,
      sessionId,
      pauseGeneration,
      frameId,
    });
    if (!isDebugScopeList(receivedScopes)) {
      throw new Error("Invalid debug scopes response");
    }
    scopes = receivedScopes;
  } catch {
    if (
      selectionIsCurrent(context, {
        frameId,
        key,
        pauseGeneration,
        pauseState,
        root,
        selectionGeneration,
        sessionOwner,
        sessionId,
        workspaceEpoch,
        workspaceId,
      })
    ) {
      publishSelection(context, key, {
        frameId,
        loadState: {
          kind: "error",
          message: "Unable to load variables for the selected frame.",
        },
        scopes: [],
      });
    }
    return;
  }
  if (
    !selectionIsCurrent(context, {
      frameId,
      key,
      pauseGeneration,
      pauseState,
      root,
      selectionGeneration,
      sessionOwner,
      sessionId,
      workspaceEpoch,
      workspaceId,
    })
  ) {
    return;
  }
  publishSelection(context, key, {
    frameId,
    loadState: { kind: "ready" },
    scopes,
  });
}

interface DebugFrameSelectionCapture {
  readonly frameId: number;
  readonly key: string;
  readonly pauseGeneration: number;
  readonly pauseState: DebuggerSessionSnapshot["state"];
  readonly root: string;
  readonly selectionGeneration: number;
  readonly sessionOwner: DebugSessionOwner;
  readonly sessionId: number;
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

function selectionIsCurrent(
  context: DebugFrameSelectionContext,
  capture: DebugFrameSelectionCapture,
): boolean {
  if (
    !context.mountedRef.current ||
    !trustedWorkspace(context.isWorkspaceTrusted) ||
    !workspaceRootKeysEqual(capture.root, context.currentRootRef.current) ||
    context.currentWorkspaceEpochRef.current.epoch !== capture.workspaceEpoch ||
    context.currentWorkspaceIdRef.current !== capture.workspaceId ||
    !workspaceOwnerIsCurrent(context, capture.root, capture.workspaceId) ||
    context.activeSessionId() !== capture.sessionId ||
    context.sessionOwnersRef.current.get(capture.key) !== capture.sessionOwner ||
    capture.sessionOwner.workspaceEpoch !== capture.workspaceEpoch ||
    capture.sessionOwner.workspaceId !== capture.workspaceId ||
    (context.pauseGenerationByRootRef.current[capture.key] ?? 0) !== capture.pauseGeneration ||
    context.frameSelectionGenerationByRootRef.current[capture.key] !== capture.selectionGeneration
  ) {
    return false;
  }
  const state = (context.snapshotsRef.current[capture.key] ?? initialDebuggerSnapshot()).state;
  return (
    state === capture.pauseState &&
    state.kind === "stopped" &&
    debuggerSessionId(state) === capture.sessionId &&
    state.frames.some((frame) => frame.frameId === capture.frameId)
  );
}

function publishSelection(
  context: DebugFrameSelectionContext,
  key: string,
  selection: DebugFrameSelection,
): void {
  const next = {
    ...context.frameSelectionByRootRef.current,
    [key]: selection,
  };
  context.frameSelectionByRootRef.current = next;
  context.setFrameSelectionByRoot(next);
}

function workspaceOwnerIsCurrent(
  context: DebugFrameSelectionContext,
  rootPath: string,
  workspaceId: string | null,
): boolean {
  try {
    return context.isExactWorkspaceOwnerCurrent(rootPath, workspaceId);
  } catch {
    return false;
  }
}

function trustedWorkspace(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
