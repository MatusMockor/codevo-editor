import { useEffect, useMemo } from "react";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipActions } from "./AgentShipPanel";
import { isRemoteAgentSurfaceThread } from "./agentSurfacePolicy";
import { agentShipStatusUnread } from "./agentModePresentation";

export type AgentShipSurface = Pick<
  AgentThreadsSurface,
  | "refreshShipStatus"
  | "commitThreadChanges"
  | "pushThreadBranch"
  | "openThreadCompareUrl"
  | "integrateThreadBranch"
  | "removeThreadWorktree"
  | "removeWorktree"
  | "resetThreadShip"
>;

export interface AgentShipActionsOptions {
  readonly agents: AgentShipSurface;
  readonly selectedThread: AgentThreadView | null;
}

export function useAgentShipActions({
  agents,
  selectedThread,
}: AgentShipActionsOptions): AgentShipActions {
  const unreadShipThreadId =
    selectedThread !== null &&
    !isRemoteAgentSurfaceThread(selectedThread) &&
    agentShipStatusUnread(selectedThread)
      ? selectedThread.thread.threadId
      : null;
  const refreshShipStatus = agents.refreshShipStatus;
  const commitThreadChanges = agents.commitThreadChanges;
  const pushThreadBranch = agents.pushThreadBranch;
  const openThreadCompareUrl = agents.openThreadCompareUrl;
  const integrateThreadBranch = agents.integrateThreadBranch;
  const removeThreadWorktree = agents.removeThreadWorktree;
  const removeWorktree = agents.removeWorktree;
  const resetThreadShip = agents.resetThreadShip;
  useEffect(() => {
    if (unreadShipThreadId === null) return;
    void refreshShipStatus(unreadShipThreadId);
  }, [refreshShipStatus, unreadShipThreadId]);

  const blockedThreadId = isRemoteAgentSurfaceThread(selectedThread)
    ? selectedThread?.thread.threadId
    : null;
  return useMemo<AgentShipActions>(() => {
    const allowed = (threadId: string) =>
      threadId !== blockedThreadId && !threadId.startsWith("remote:");
    return {
      onRefreshShipStatus: (threadId) => allowed(threadId) && void refreshShipStatus(threadId),
      onCommit: (threadId, message) =>
        allowed(threadId) && void commitThreadChanges(threadId, message),
      onPush: (threadId) => allowed(threadId) && void pushThreadBranch(threadId),
      onOpenCompareUrl: (threadId) => allowed(threadId) && void openThreadCompareUrl(threadId),
      onIntegrate: (threadId, mode) =>
        allowed(threadId) && void integrateThreadBranch(threadId, mode),
      onRemoveWorktree: (threadId, options) =>
        allowed(threadId) && void removeThreadWorktree(threadId, options),
      onDiscardWorktree: (threadId) => allowed(threadId) && void removeWorktree(threadId),
      onDismissFailure: (threadId) => {
        if (allowed(threadId)) resetThreadShip(threadId);
      },
    };
  }, [
    blockedThreadId,
    commitThreadChanges,
    integrateThreadBranch,
    openThreadCompareUrl,
    pushThreadBranch,
    refreshShipStatus,
    removeThreadWorktree,
    removeWorktree,
    resetThreadShip,
  ]);
}
