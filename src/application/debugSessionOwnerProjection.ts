import { debuggerSessionId } from "../domain/debug";
import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import type { DebugPauseOwner } from "./debugSessionContracts";
import { inactiveSnapshot } from "./debugSessionDefaults";
import type { DebugSessionOwner } from "./useDebugSessionEnd";

interface DebugSessionOwnerProjectionRequest {
  readonly activePauseGeneration: number;
  readonly compoundStartOwned: boolean;
  readonly owner: DebugSessionOwner | undefined;
  readonly pendingStartOwned: boolean;
  readonly rootKey: string;
  readonly snapshot: DebuggerSessionSnapshot;
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

export interface DebugSessionOwnerProjection {
  readonly activeOwned: boolean;
  readonly attached: boolean;
  readonly foreignActive: boolean;
  readonly pauseOwned: boolean;
  readonly pauseOwner: DebugPauseOwner | null;
  readonly sessionId: number | null;
  readonly snapshot: DebuggerSessionSnapshot;
}

interface PendingDebugOwnerProjectionRequest {
  readonly activeStopOwner: PendingOwner | undefined;
  readonly compoundStartOwned: boolean;
  readonly pendingStartOwner: PendingOwner | undefined;
  readonly pendingStartStopOwner: PendingOwner | undefined;
  readonly stopPending: boolean;
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

interface PendingOwner {
  readonly workspaceEpoch: number;
  readonly workspaceId: string | null;
}

export function projectActiveFunctionBreakpointSession(
  rootPath: string,
  sessionId: number,
  adapterKind: "node" | "php" | null | undefined,
  owner: DebugSessionOwner | undefined,
  workspaceEpoch: number,
) {
  if (
    !adapterKind ||
    !owner ||
    owner.sessionId !== sessionId ||
    owner.workspaceEpoch !== workspaceEpoch
  ) {
    return null;
  }
  return {
    adapterKind,
    rootPath,
    sessionId,
    workspaceEpoch: owner.workspaceEpoch,
    workspaceId: owner.workspaceId,
  };
}

export function retainPendingDebugStopOwner(
  owners: Map<string, PendingOwner>,
  key: string,
  owner: PendingOwner,
): void {
  owners.set(key, {
    workspaceEpoch: owner.workspaceEpoch,
    workspaceId: owner.workspaceId,
  });
}

export function releasePendingDebugStopOwner(
  owners: Map<string, PendingOwner>,
  key: string,
  owner: PendingOwner,
): boolean {
  if (!debugOwnerEpochMatches(owners.get(key), owner.workspaceEpoch, owner.workspaceId)) {
    return false;
  }
  owners.delete(key);
  return true;
}

export function debugOwnerEpochMatches(
  owner:
    | {
        readonly workspaceEpoch: number;
        readonly workspaceId: string | null;
      }
    | null
    | undefined,
  workspaceEpoch: number,
  workspaceId: string | null,
): boolean {
  return owner?.workspaceEpoch === workspaceEpoch && owner.workspaceId === workspaceId;
}

export function debugSessionOwnerMatches(
  owner: DebugSessionOwner | undefined,
  sessionId: number | null,
  workspaceEpoch: number,
  workspaceId: string | null,
): boolean {
  return (
    owner?.sessionId === sessionId && debugOwnerEpochMatches(owner, workspaceEpoch, workspaceId)
  );
}

export function projectPendingDebugOwner({
  activeStopOwner,
  compoundStartOwned,
  pendingStartOwner,
  pendingStartStopOwner,
  stopPending,
  workspaceEpoch,
  workspaceId,
}: PendingDebugOwnerProjectionRequest) {
  const pendingStartOwned = debugOwnerEpochMatches(pendingStartOwner, workspaceEpoch, workspaceId);
  return {
    blockedByForeignStart:
      pendingStartOwner !== undefined && !pendingStartOwned && !compoundStartOwned,
    pendingStartOwned,
    stopPending:
      stopPending &&
      (debugOwnerEpochMatches(pendingStartStopOwner, workspaceEpoch, workspaceId) ||
        debugOwnerEpochMatches(activeStopOwner, workspaceEpoch, workspaceId)),
  };
}

export function projectDebugSessionOwner({
  activePauseGeneration,
  compoundStartOwned,
  owner,
  pendingStartOwned,
  rootKey,
  snapshot,
  workspaceEpoch,
  workspaceId,
}: DebugSessionOwnerProjectionRequest): DebugSessionOwnerProjection {
  const rawSessionId = debuggerSessionId(snapshot.state);
  const active =
    snapshot.state.kind === "starting" ||
    snapshot.state.kind === "running" ||
    snapshot.state.kind === "stopped";
  const ownerMatches =
    active && debugSessionOwnerMatches(owner, rawSessionId, workspaceEpoch, workspaceId);
  const activeOwned = active && (ownerMatches || pendingStartOwned || compoundStartOwned);
  const visibleSnapshot = !active || activeOwned ? snapshot : inactiveSnapshot;
  const pauseOwned = snapshot.state.kind === "stopped" && ownerMatches;
  const pauseOwner =
    pauseOwned && owner && activePauseGeneration > 0 && owner.workspaceId !== null
      ? {
          pauseGeneration: activePauseGeneration,
          rootKey,
          sessionId: owner.sessionId,
          workspaceOwnerKey: owner.workspaceId,
        }
      : null;

  return {
    activeOwned,
    attached: ownerMatches && owner?.targetKind === "node-attach",
    foreignActive: active && !activeOwned,
    pauseOwned,
    pauseOwner,
    sessionId: debuggerSessionId(visibleSnapshot.state),
    snapshot: visibleSnapshot,
  };
}
