import { useEffect, useMemo } from "react";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipActions } from "./AgentShipPanel";
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
    selectedThread !== null && agentShipStatusUnread(selectedThread)
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

  return useMemo<AgentShipActions>(
    () => ({
      onRefreshShipStatus: (threadId) => void refreshShipStatus(threadId),
      onCommit: (threadId, message) => void commitThreadChanges(threadId, message),
      onPush: (threadId) => void pushThreadBranch(threadId),
      onOpenCompareUrl: (threadId) => void openThreadCompareUrl(threadId),
      onIntegrate: (threadId, mode) => void integrateThreadBranch(threadId, mode),
      onRemoveWorktree: (threadId, options) => void removeThreadWorktree(threadId, options),
      onDiscardWorktree: (threadId) => void removeWorktree(threadId),
      onDismissFailure: (threadId) => resetThreadShip(threadId),
    }),
    [
      commitThreadChanges,
      integrateThreadBranch,
      openThreadCompareUrl,
      pushThreadBranch,
      refreshShipStatus,
      removeThreadWorktree,
      removeWorktree,
      resetThreadShip,
    ],
  );
}
