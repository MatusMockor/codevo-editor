import { useEffect, useMemo } from "react";
import type { AgentThreadsSurface, AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentShipActions } from "./AgentShipPanel";
import { agentShipStatusUnread } from "./agentModePresentation";

export function useAgentShipActions(
  agents: AgentThreadsSurface,
  selectedThread: AgentThreadView | null,
): AgentShipActions {
  const unreadShipThreadId =
    selectedThread !== null && agentShipStatusUnread(selectedThread)
      ? selectedThread.thread.threadId
      : null;
  const refreshShipStatus = agents.refreshShipStatus;
  useEffect(() => {
    if (unreadShipThreadId === null) return;
    void refreshShipStatus(unreadShipThreadId);
  }, [refreshShipStatus, unreadShipThreadId]);

  return useMemo<AgentShipActions>(
    () => ({
      onRefreshShipStatus: (threadId) => void agents.refreshShipStatus(threadId),
      onCommit: (threadId, message) => void agents.commitThreadChanges(threadId, message),
      onPush: (threadId) => void agents.pushThreadBranch(threadId),
      onOpenCompareUrl: (threadId) => void agents.openThreadCompareUrl(threadId),
      onIntegrate: (threadId, mode) => void agents.integrateThreadBranch(threadId, mode),
      onRemoveWorktree: (threadId, options) => void agents.removeThreadWorktree(threadId, options),
      onDiscardWorktree: (threadId) => void agents.removeWorktree(threadId),
      onDismissFailure: (threadId) => agents.resetThreadShip(threadId),
    }),
    [agents],
  );
}
