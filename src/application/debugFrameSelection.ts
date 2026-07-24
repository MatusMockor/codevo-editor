import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { DebugGateway, DebugScope } from "../domain/debug";
import { debuggerSessionId } from "../domain/debug";
import { initialDebuggerSnapshot, type DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface DebugFrameSelection {
  readonly frameId: number;
  readonly scopes: DebugScope[];
}

export interface DebugFrameSelectionContext {
  readonly activeSessionId: () => number | null;
  readonly currentRootRef: MutableRefObject<string | null>;
  readonly frameSelectionGenerationByRootRef: MutableRefObject<Record<string, number>>;
  readonly gateway: DebugGateway;
  readonly isWorkspaceTrusted: () => boolean;
  readonly mountedRef: MutableRefObject<boolean>;
  readonly pauseGenerationByRootRef: MutableRefObject<Record<string, number>>;
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
  if (!trustedWorkspace(context.isWorkspaceTrusted)) return;
  const root = context.currentRootRef.current;
  const sessionId = context.activeSessionId();
  if (!root || sessionId === null) return;
  const key = normalizedWorkspaceRootKey(root);
  const pauseGeneration = context.pauseGenerationByRootRef.current[key] ?? 0;
  const selectionGeneration = (context.frameSelectionGenerationByRootRef.current[key] ?? 0) + 1;
  context.frameSelectionGenerationByRootRef.current = {
    ...context.frameSelectionGenerationByRootRef.current,
    [key]: selectionGeneration,
  };
  if ((context.snapshotsRef.current[key] ?? initialDebuggerSnapshot()).state.kind !== "stopped") {
    return;
  }
  if (pauseGeneration <= 0) return;
  const scopes = await context.gateway.scopesAtPause({
    rootPath: root,
    sessionId,
    pauseGeneration,
    frameId,
  });
  if (
    !context.mountedRef.current ||
    !trustedWorkspace(context.isWorkspaceTrusted) ||
    !workspaceRootKeysEqual(root, context.currentRootRef.current) ||
    context.activeSessionId() !== sessionId ||
    (context.pauseGenerationByRootRef.current[key] ?? 0) !== pauseGeneration ||
    context.frameSelectionGenerationByRootRef.current[key] !== selectionGeneration
  ) {
    return;
  }
  const state = (context.snapshotsRef.current[key] ?? initialDebuggerSnapshot()).state;
  if (
    state.kind === "inactive" ||
    state.kind === "terminated" ||
    debuggerSessionId(state) !== sessionId
  ) {
    return;
  }
  context.setFrameSelectionByRoot((current) => ({
    ...current,
    [key]: { frameId, scopes },
  }));
}

function trustedWorkspace(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}
